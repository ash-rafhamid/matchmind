"""Live match feed: replays a match in (accelerated) real time as Server-Sent Events.

The stream is what a studio graphics system or a streaming overlay would
subscribe to: a clock tick, notable match events as they happen, each key
moment the instant it occurs, and the crew's verified story for that moment
as soon as the agents have written it (it arrives a few seconds later, the way
a human analyst's take would).
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable

from . import store

FEED_TYPES = {"goal", "card", "substitution", "tactical_change", "period_start", "period_end", "save"}


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, separators=(',', ':'))}\n\n"


def clock_label(ts: float, first_half: float) -> str:
    if ts < first_half:
        m = int(ts // 60)
        return f"45+{m - 44}'" if m >= 45 else f"{m + 1}'"
    m = int((ts - first_half) // 60)
    return f"90+{m - 44}'" if m >= 45 else f"{m + 46}'"


def _event_card(e: dict, names: dict[str, str], teams: dict[str, str]) -> dict:
    card = {"id": e["id"], "ts": e["ts"], "clock": e["clock"], "type": e["type"], "team": e["team"],
            "team_name": teams[e["team"]]}
    if e.get("player"):
        card["player"] = names.get(e["player"])
    for k in ("outcome", "note", "xg"):
        if e.get(k) is not None:
            card[k] = e[k]
    if e["type"] == "substitution":
        card["on"] = names.get(e["player_on"])
        card["off"] = names.get(e["player_off"])
    if e["type"] == "goal":
        card["score"] = e["score"]
    return card


async def live_feed(
    match_id: str,
    speed: float,
    start: float,
    story: Callable[[dict], Awaitable[dict]],
    disconnected: Callable[[], Awaitable[bool]],
) -> AsyncIterator[str]:
    pkg = store.load(match_id)
    meta, events = pkg["meta"], pkg["events"]
    names = meta["player_names"]
    teams = {s: meta["teams"][s]["name"] for s in ("home", "away")}
    first_half = meta["period_lengths_s"]["1"]
    duration = meta["duration_s"]
    moments = [m for m in pkg["analytics"]["moments"] if m["ts"] >= start]
    feed = [e for e in events if e["type"] in FEED_TYPES and e["ts"] >= start]
    score = {"home": 0, "away": 0}
    for e in events:
        if e["type"] == "goal" and e["ts"] < start:
            score = e["score"]

    yield sse("meta", {"match": meta["id"], "teams": {s: {k: meta["teams"][s][k] for k in
                                                       ("name", "short", "primary", "secondary")} for s in teams},
                       "duration_s": duration, "speed": speed, "start": start})
    stories: asyncio.Queue = asyncio.Queue()
    tasks: set[asyncio.Task] = set()

    async def write_story(m: dict) -> None:
        try:
            result = await story(m)
            await stories.put(sse("story", {"moment_id": m["id"], **result}))
        except Exception as exc:  # a failed story must not end the broadcast
            await stories.put(sse("story_error", {"moment_id": m["id"], "error": type(exc).__name__}))

    loop = asyncio.get_running_loop()
    wall0 = loop.time()
    t = start
    last_tick = -1
    try:
        while t < duration + 1:
            if await disconnected():
                return
            t = min(duration, start + (loop.time() - wall0) * speed)
            while feed and feed[0]["ts"] <= t:
                e = feed.pop(0)
                if e["type"] == "goal":
                    score = e["score"]
                yield sse("event", _event_card(e, names, teams))
            while moments and moments[0]["ts"] <= t:
                m = moments.pop(0)
                yield sse("moment", {k: m[k] for k in ("id", "type", "ts", "clock", "team", "team_name", "title",
                                                       "importance", "evidence")})
                task = asyncio.create_task(write_story(m))
                tasks.add(task)
                task.add_done_callback(tasks.discard)
            while not stories.empty():
                yield stories.get_nowait()
            if int(t) != last_tick:
                last_tick = int(t)
                yield sse("clock", {"ts": round(t, 1), "clock": clock_label(t, first_half), "score": score})
            if t >= duration and not tasks and stories.empty():
                break
            await asyncio.sleep(0.25)
        yield sse("end", {"score": score})
    finally:
        for task in tasks:
            task.cancel()
