"""MatchMind web API: match data, tracking, the AI crew, what-if lab and scenario lab."""

from __future__ import annotations

import contextlib
import json
import os
import random
import time
from collections import defaultdict, deque
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from . import cache, store  # noqa: E402
from .ai.crew import Crew, Job  # noqa: E402
from .ai.llm import make_client  # noqa: E402
from .ai.packets import moment_packet, recap_packet  # noqa: E402
from .ai.personas import LANGUAGES, PERSONAS  # noqa: E402
from .engine.formations import FORMATIONS  # noqa: E402
from .engine.sim import TacticalChange  # noqa: E402
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


@app.get("/api/matches/{match_id}")
def match(match_id: str) -> dict:
    pkg = _load(match_id)
    return {"meta": pkg["meta"], "analytics": pkg["analytics"], "events": pkg["events"]}


@app.get("/api/matches/{match_id}/tracking")
def tracking(match_id: str, start: float = 0.0, seconds: float = 60.0, hz: int = 10) -> dict:
    _load(match_id)
    try:
        tr = store.load_tracking(match_id)
    except FileNotFoundError:
        raise HTTPException(404, "this match has no tracking data") from None
    native = 10
    step = max(1, native // max(1, min(hz, native)))
    f0 = max(0, int(start * native))
    f1 = min(tr["ball"].shape[0], int((start + min(seconds, 300)) * native))
    xy = tr["xy"][f0:f1:step]
    ball = tr["ball"][f0:f1:step]
    return {"hz": native // step, "start": f0 / native, "frames": int(ball.shape[0]),
            "players": tr["player_ids"], "teams": tr["teams"],
            "xy": xy.reshape(-1).tolist(), "ball": ball.reshape(-1).tolist(), "scale": 10}


@app.get("/api/matches/{match_id}/moments/{moment_id}/story")
async def moment_story(match_id: str, moment_id: str, request: Request, persona: str = "fan",
                       lang: str = "en") -> dict:
    _check_audience(persona, lang)
    pkg = _load(match_id)
    moment = next((m for m in pkg["analytics"]["moments"] if m["id"] == moment_id), None)
    if moment is None:
        raise HTTPException(404, f"no moment {moment_id}")
    key = _key("moment", match_id, moment_id, persona, lang)
    if cached := _cache_get(key):
        return cached | {"cached": True}
    if CREW.ai_enabled:
        AI_LIMIT.check(_client_key(request))
    job = Job("moment", moment_packet(pkg, moment), persona, lang, store.LEAGUE_ROSTER)
    out = _result_dict(await CREW.run_job(job))
    if out["mode"] == "ai" or not CREW.ai_enabled:
        _cache_put(key, out)
    return out


@app.get("/api/matches/{match_id}/recap")
async def recap(match_id: str, request: Request, persona: str = "fan", lang: str = "en") -> dict:
    _check_audience(persona, lang)
    pkg = _load(match_id)
    key = _key("recap", match_id, persona, lang)
    if cached := _cache_get(key):
        return cached | {"cached": True}
    if CREW.ai_enabled:
        AI_LIMIT.check(_client_key(request))
    job = Job("recap", recap_packet(pkg), persona, lang, store.LEAGUE_ROSTER)
    out = _result_dict(await CREW.run_job(job))
    if out["mode"] == "ai" or not CREW.ai_enabled:
        _cache_put(key, out)
    return out


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
        key = _key("whatif", match_id, json.dumps(body.model_dump(), sort_keys=True))
        cached = _cache_get(key)
        if cached is None:
            if CREW.ai_enabled:
                AI_LIMIT.check(_client_key(request))
            cached = _result_dict(await CREW.run_job(Job("whatif", result, body.persona, body.lang,
                                                         store.LEAGUE_ROSTER)))
            if cached["mode"] == "ai" or not CREW.ai_enabled:
                _cache_put(key, cached)
        out["explanation"] = cached
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
