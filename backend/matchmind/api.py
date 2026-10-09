"""MatchMind web API: match data, tracking, the AI crew, what-if lab and scenario lab."""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import random
import time
from collections import defaultdict, deque
from pathlib import Path

import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from . import cache, commentary, store, voice  # noqa: E402
from .ai.crew import Crew, Job  # noqa: E402
from .ai.llm import make_client  # noqa: E402
from .ai.packets import moment_packet, recap_packet  # noqa: E402
from .ai.personas import LANGUAGES, PERSONAS  # noqa: E402
from .engine.formations import FORMATIONS  # noqa: E402
from .engine.sim import TacticalChange  # noqa: E402
from .export import build_export  # noqa: E402
from .live import live_feed  # noqa: E402
from .mcp_server import mcp  # noqa: E402
from .whatif import DIALS, run_what_if  # noqa: E402

FRONTEND = Path(os.environ.get("MATCHMIND_FRONTEND", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
MODEL = make_client()


def _mcp_tool():
    url = os.environ.get("MATCHMIND_MCP_URL")
    if not url or MODEL.client is None:
        return None
    from agent_framework import MCPStreamableHTTPTool

    return MCPStreamableHTTPTool(name="matchmind", url=url, description="MatchMind match-data MCP server")


CREW = Crew(MODEL.client, _mcp_tool())


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    async with mcp.session_manager.run():
        yield


app = FastAPI(title="MatchMind", version="1.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.middleware("http")
async def cache_headers(request: Request, call_next):
    """Hashed assets never change; match data and tracking never change once simulated."""
    response = await call_next(request)
    path = request.url.path
    if response.status_code == 200 and "cache-control" not in response.headers:
        if path.startswith("/assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif request.method == "GET" and path.startswith("/api/matches/") and (
            path.endswith("/tracking") and request.query_params.get("v")
        ):
            response.headers["Cache-Control"] = "public, max-age=86400"
        elif path in ("/", "/index.html"):
            response.headers["Cache-Control"] = "no-cache"
    return response
app.mount("/mcp", mcp.streamable_http_app())


# ------------------------------------------------------------------ helpers

class RateLimiter:
    """Small per-client budget for model-backed endpoints, to protect free credits."""

    def __init__(self, limit: int, window_s: float) -> None:
        self.limit, self.window = limit, window_s
        self.hits: dict[str, deque] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            raise HTTPException(429, "The crew needs a breather - try again in a few minutes.")
        q.append(now)


AI_LIMIT = RateLimiter(int(os.environ.get("AI_REQUESTS_PER_10_MIN", "40")), 600)


def _client_key(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return (fwd.split(",")[0] if fwd else request.client.host if request.client else "anon").strip()


def _cache_get(key: str) -> dict | None:
    return cache.get(key)


def _cache_put(key: str, value: dict) -> None:
    cache.put(key, value)


def _key(*parts: object) -> str:
    return cache.make_key(MODEL.provider, MODEL.model, *parts)


def _load(match_id: str) -> dict:
    try:
        return store.load(match_id)
    except KeyError:
        raise HTTPException(404, f"no match {match_id}") from None


def _check_audience(persona: str, lang: str) -> None:
    if persona not in PERSONAS:
        raise HTTPException(400, f"persona must be one of {list(PERSONAS)}")
    if lang not in LANGUAGES:
        raise HTTPException(400, f"lang must be one of {list(LANGUAGES)}")


def _result_dict(result) -> dict:
    return {"text": result.text, "data": result.data, "verdict": result.verdict, "trace": result.trace,
            "mode": result.mode}


# ---------------------------------------------------------------- endpoints

@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "ai": {"provider": MODEL.provider, "model": MODEL.model, "enabled": MODEL.available},
            "matches": len(store.list_matches())}


@app.get("/api/options")
def options() -> dict:
    return {
        "personas": {k: v["label"] for k, v in PERSONAS.items()},
        "languages": LANGUAGES,
        "formations": sorted(FORMATIONS),
        "dials": list(DIALS),
        "teams": {t.id: {"name": t.name, "short": t.short, "primary": t.primary, "secondary": t.secondary,
                         "formation": t.dna.formation, "traits": t.dna.describe()} for t in store.LEAGUE.values()},
    }


@app.get("/api/matches")
def matches() -> list[dict]:
    return store.list_matches()


def _version(match_id: str) -> str:
    """Changes whenever the match is regenerated; tracking URLs carry it so caches never serve stale data."""
    return str(int((store.DATA_DIR / match_id / "events.json").stat().st_mtime))


@app.get("/api/matches/{match_id}")
def match(match_id: str, request: Request) -> Response:
    pkg = _load(match_id)
    version = _version(match_id)
    etag = f'"{match_id}-{version}"'
    headers = {"ETag": etag, "Cache-Control": "no-cache"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    body = {"meta": {**pkg["meta"], "version": version}, "analytics": pkg["analytics"], "events": pkg["events"]}
    return Response(json.dumps(body, ensure_ascii=False, separators=(",", ":")), media_type="application/json", headers=headers)


@app.get("/api/matches/{match_id}/tracking")
def tracking(match_id: str, start: float = 0.0, seconds: float = 60.0, hz: int = 10, enc: str = "") -> dict:
    _load(match_id)
    try:
        tr = store.load_tracking(match_id)
    except FileNotFoundError:
        raise HTTPException(404, "this match has no tracking data") from None
    native = 10
    step = max(1, native // max(1, min(hz, native)))
    f0 = max(0, int(start * native))
    f1 = min(tr["ball"].shape[0], int((start + min(seconds, 300)) * native))
    xy = tr["xy"][f0:f1:step].astype(np.int32)
    ball = tr["ball"][f0:f1:step].astype(np.int32)
    ball_z = tr["ball_z"][f0:f1:step].astype(np.int32)
    out = {"hz": native // step, "start": f0 / native, "frames": int(ball.shape[0]),
           "players": tr["player_ids"], "teams": tr["teams"], "on_ball": tr["on_ball"][f0:f1:step].tolist(), "scale": 10}
    if enc == "delta" and ball.shape[0] > 0:
        # frame-to-frame differences are tiny integers, which compress several times better
        out["enc"] = "delta"
        xy = np.concatenate([xy[:1], np.diff(xy, axis=0)])
        ball = np.concatenate([ball[:1], np.diff(ball, axis=0)])
        ball_z = np.concatenate([ball_z[:1], np.diff(ball_z)])
    out.update(xy=xy.reshape(-1).tolist(), ball=ball.reshape(-1).tolist(), ball_z=ball_z.tolist())
    # animation cues (kicks, tackles, slides, falls, dives) that start inside this window
    c = tr["cues"]
    t0, t1 = f0 / native, f1 / native
    inside = c[(c[:, 0] >= t0) & (c[:, 0] < t1)] if len(c) else c
    out["cues"] = [[round(float(t), 2), int(j), int(k)] for t, j, k in inside]
    return out


_inflight: dict[str, asyncio.Task] = {}


async def _cached_job(key: str, make_job, client_key: str | None) -> dict:
    """Serve from cache, join an identical in-flight job, or run the crew once and cache verified AI output."""
    if cached := _cache_get(key):
        return cached | {"cached": True}
    if key in _inflight:
        return await asyncio.shield(_inflight[key])
    if CREW.ai_enabled and client_key:
        AI_LIMIT.check(client_key)

    async def run() -> dict:
        out = _result_dict(await CREW.run_job(make_job()))
        if out["mode"] == "ai" or not CREW.ai_enabled:
            _cache_put(key, out)
        return out

    task = asyncio.create_task(run())
    _inflight[key] = task
    task.add_done_callback(lambda _: _inflight.pop(key, None))
    return await asyncio.shield(task)


def _moment_or_404(pkg: dict, moment_id: str) -> dict:
    moment = next((m for m in pkg["analytics"]["moments"] if m["id"] == moment_id), None)
    if moment is None:
        raise HTTPException(404, f"no moment {moment_id}")
    return moment


async def _moment_story(pkg: dict, moment: dict, persona: str, lang: str, client_key: str | None) -> dict:
    packet = moment_packet(pkg, moment)
    key = _key("moment", pkg["meta"]["id"], moment["id"], persona, lang, cache.facts_digest(packet))
    return await _cached_job(key, lambda: Job("moment", packet, persona, lang, store.LEAGUE_ROSTER), client_key)


@app.get("/api/matches/{match_id}/moments/{moment_id}/story")
async def moment_story(match_id: str, moment_id: str, request: Request, persona: str = "fan",
                       lang: str = "en") -> dict:
    _check_audience(persona, lang)
    pkg = _load(match_id)
    return await _moment_story(pkg, _moment_or_404(pkg, moment_id), persona, lang, _client_key(request))


# ------------------------------------------------------------------ the commentator's voice

TTS_LIMIT = RateLimiter(int(os.environ.get("VOICE_REQUESTS_PER_10_MIN", "900")), 600)
_lines_cache: dict[tuple[str, str, str], list[dict]] = {}


def _lines(match_id: str, lang: str) -> list[dict]:
    key = (match_id, lang, _version(match_id))
    if key not in _lines_cache:
        _lines_cache[key] = commentary.build_lines(_load(match_id), lang)
    return _lines_cache[key]


async def _audio(text: str, lang: str, mood: str, request: Request) -> Response:
    if not voice.available():
        raise HTTPException(503, "no voice configured")
    TTS_LIMIT.check(_client_key(request))
    try:
        data = await voice.speak(text, lang, mood)
    except Exception as exc:  # network or auth trouble: the page falls back to the browser's voice
        raise HTTPException(502, "the commentator's voice is unavailable") from exc
    return Response(data, media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/matches/{match_id}/commentary")
def commentary_lines(match_id: str, lang: str = "en") -> dict:
    """Every play-by-play call the commentator could make, built from the events only."""
    _check_audience("fan", lang)
    return {"voice": voice.available(), "lines": _lines(match_id, lang)}


@app.get("/api/matches/{match_id}/commentary/{line_id}.mp3")
async def commentary_audio(match_id: str, line_id: str, request: Request, lang: str = "en") -> Response:
    _check_audience("fan", lang)
    line = next((x for x in _lines(match_id, lang) if x["id"] == line_id), None)
    if line is None:
        raise HTTPException(404, f"no line {line_id}")
    return await _audio(line["text"], lang, "excited" if line["excited"] else "call", request)


@app.get("/api/matches/{match_id}/moments/{moment_id}/voice.mp3")
async def moment_voice(match_id: str, moment_id: str, request: Request, persona: str = "fan", lang: str = "en") -> Response:
    """The crew's verified take on a moment, read out (the opening sentences)."""
    _check_audience(persona, lang)
    pkg = _load(match_id)
    story = await _moment_story(pkg, _moment_or_404(pkg, moment_id), persona, lang, _client_key(request))
    return await _audio(voice.first_sentences(story["text"]), lang, "story", request)


@app.get("/api/matches/{match_id}/recap")
async def recap(match_id: str, request: Request, persona: str = "fan", lang: str = "en") -> dict:
    _check_audience(persona, lang)
    pkg = _load(match_id)
    packet = recap_packet(pkg)
    key = _key("recap", match_id, persona, lang, cache.facts_digest(packet))
    return await _cached_job(key, lambda: Job("recap", packet, persona, lang, store.LEAGUE_ROSTER), _client_key(request))


@app.get("/api/matches/{match_id}/live")
async def live(match_id: str, request: Request, persona: str = "fan", lang: str = "en", speed: float = 8.0,
               start: float = 0.0) -> StreamingResponse:
    """Server-Sent Events feed of the match in accelerated real time, with crew stories as moments happen."""
    _check_audience(persona, lang)
    pkg = _load(match_id)
    if CREW.ai_enabled:
        AI_LIMIT.check(_client_key(request))
    speed = max(1.0, min(speed, 60.0))

    async def story(moment: dict) -> dict:
        out = await _moment_story(pkg, moment, persona, lang, None)
        return {k: out[k] for k in ("text", "verdict", "mode")} | {"agents": [t["agent"] for t in out["trace"]]}

    stream = live_feed(match_id, speed, max(0.0, start), story, request.is_disconnected)
    return StreamingResponse(stream, media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/matches/{match_id}/export.zip")
def export(match_id: str) -> Response:
    """The full synthetic dataset for one match: events, tracking, analytics and a data card."""
    _load(match_id)
    return Response(build_export(match_id), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="matchmind-{match_id}.zip"'})


class AskBody(BaseModel):
    question: str = Field(min_length=3, max_length=400)
    persona: str = "fan"
    lang: str = "en"


@app.post("/api/matches/{match_id}/ask")
async def ask(match_id: str, body: AskBody, request: Request) -> dict:
    _check_audience(body.persona, body.lang)
    _load(match_id)
    if CREW.ai_enabled:
        AI_LIMIT.check(_client_key(request))
    return await CREW.ask(match_id, body.question, body.persona, body.lang, store.LEAGUE_ROSTER)


class WhatIfBody(BaseModel):
    team: str = Field(pattern="^(home|away)$")
    from_minute: float = Field(ge=1, le=95)
    changes: dict[str, float | str]
    runs: int = Field(default=200, ge=50, le=400)
    persona: str = "fan"
    lang: str = "en"
    explain: bool = True


@app.post("/api/matches/{match_id}/whatif")
async def whatif(match_id: str, body: WhatIfBody, request: Request) -> dict:
    _check_audience(body.persona, body.lang)
    pkg = _load(match_id)
    try:
        result = await run_in_threadpool(run_what_if, pkg["meta"], body.team, body.from_minute, body.changes,
                                         body.runs)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    out: dict = {"result": result}
    if body.explain:
        key = _key("whatif", match_id, _version(match_id), json.dumps(body.model_dump(), sort_keys=True))
        out["explanation"] = await _cached_job(
            key, lambda: Job("whatif", result, body.persona, body.lang, store.LEAGUE_ROSTER), _client_key(request))
    return out


class ScriptItem(BaseModel):
    minute: float = Field(ge=1, le=90)
    side: str = Field(pattern="^(home|away)$")
    changes: dict[str, float | str]
    label: str = Field(default="Tactical switch", max_length=80)


class ScenarioBody(BaseModel):
    home: str
    away: str
    seed: int | None = None
    script: list[ScriptItem] = []


_scenario_times: deque = deque(maxlen=50)


@app.post("/api/scenarios")
async def scenario(body: ScenarioBody) -> dict:
    if body.home not in store.LEAGUE or body.away not in store.LEAGUE or body.home == body.away:
        raise HTTPException(400, "pick two different teams")
    now = time.monotonic()
    if sum(1 for t in _scenario_times if now - t < 60) >= 6:
        raise HTTPException(429, "Scenario lab is busy - try again in a minute.")
    _scenario_times.append(now)
    seed = body.seed if body.seed is not None else random.randint(1, 1_000_000)
    script = []
    for item in body.script:
        for k, v in item.changes.items():
            if k not in DIALS and not (k == "formation" and v in FORMATIONS):
                raise HTTPException(400, f"bad tactical change {k}={v}")
        script.append(TacticalChange(item.minute, item.side, dict(item.changes), item.label))
    pkg = await run_in_threadpool(store.generate, body.home, body.away, seed, script or None)
    _prune_user_matches(keep=30)
    return {"id": pkg["meta"]["id"], "score": pkg["meta"]["score"], "title": pkg["meta"]["title"]}


def _prune_user_matches(keep: int) -> None:
    folders = [f for f in store.DATA_DIR.iterdir() if f.is_dir() and not _is_featured(f)]
    folders.sort(key=lambda f: f.stat().st_mtime, reverse=True)
    for old in folders[keep:]:
        for child in old.iterdir():
            child.unlink()
        old.rmdir()
        store.load.cache_clear()
        store.load_tracking.cache_clear()


def _is_featured(folder: Path) -> bool:
    try:
        return json.loads((folder / "meta.json").read_text(encoding="utf-8")).get("featured", False)
    except (OSError, ValueError):
        return False


# ------------------------------------------------------------------ frontend

if FRONTEND.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        target = FRONTEND / path
        if path and target.is_file():
            return FileResponse(target)
        return FileResponse(FRONTEND / "index.html")
