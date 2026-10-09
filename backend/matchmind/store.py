"""Generate, save and load complete match packages.

A package is everything the app and the agents need for one match:
  meta.json       teams, lineups, tactical DNA, result
  events.json     the full event stream (absolute frame)
  analytics.json  team/player stats, momentum, xG timeline, pass networks, moments
  tracking.npz    10 Hz positions as int16 decimetres (-1 = off the pitch), ball height (dm), ball owner column
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict
from functools import lru_cache
from pathlib import Path

import numpy as np

from .analytics.moments import detect_moments
from .analytics.stats import momentum, pass_network, player_stats, team_stats, xg_timeline
from .engine.league import Team, build_league
from .engine.sim import MatchSimulator, TacticalChange
from .engine.choreo import choreograph
from .engine.tracking import HZ, Tracking

DATA_DIR = Path(os.environ.get("MATCHMIND_DATA", Path(__file__).resolve().parents[1] / "data" / "matches"))
LEAGUE = build_league()
# Every player in the league: the verifier flags any of them named without support.
LEAGUE_ROSTER = {p.id: p.name for t in LEAGUE.values() for p in t.players}


def match_id(home: str, away: str, seed: int) -> str:
    return f"{home}-{away}-{seed}".lower()


def simulate(home: str, away: str, seed: int, script: list[TacticalChange] | None = None) -> MatchSimulator:
    return MatchSimulator(LEAGUE[home], LEAGUE[away], seed=seed, script=script).run()


def build_meta(sim: MatchSimulator, home: Team, away: Team, mid: str, title: str | None = None) -> dict:
    teams = {}
    for side, team in (("home", home), ("away", away)):
        d = team.to_dict()
        d["starters"] = [p.id for p in team.starters]
        d["bench"] = [p.id for p in team.bench]
        teams[side] = d
    names = {p.id: p.name for t in (home, away) for p in t.players}
    return {
        "id": mid,
        "title": title or f"{home.name} vs {away.name}",
        "seed": sim.seed,
        "teams": teams,
        "player_names": names,
        "score": {"home": sim.sides["home"].goals, "away": sim.sides["away"].goals},
        "period_lengths_s": {str(k): round(v, 1) for k, v in sim.period_len.items()},
        "duration_s": round(sim.ts, 1),
        "tracking_hz": HZ,
        "competition": "Northbridge League (synthetic)",
    }


def build_analytics(events: list[dict], meta: dict, tracking: Tracking | None) -> dict:
    end = meta["duration_s"]
    half = meta["period_lengths_s"]["1"]
    physical = tracking.physical() if tracking is not None else None
    return {
        "team_stats": {
            "full": {s: team_stats(events, s) for s in ("home", "away")},
            "first_half": {s: team_stats(events, s, 0, half) for s in ("home", "away")},
            "second_half": {s: team_stats(events, s, half, end + 1) for s in ("home", "away")},
        },
        "player_stats": player_stats(events, physical),
        "momentum": momentum(events, end),
        "xg_timeline": xg_timeline(events),
        "pass_networks": {s: pass_network(events, s) for s in ("home", "away")},
        "moments": detect_moments(events, meta),
    }


def generate(home: str, away: str, seed: int, script: list[TacticalChange] | None = None,
             title: str | None = None, save: bool = True, with_tracking: bool = True) -> dict:
    sim = simulate(home, away, seed, script)
    mid = match_id(home, away, seed) + ("-s" if script else "")
    meta = build_meta(sim, LEAGUE[home], LEAGUE[away], mid, title)
    if script:
        meta["script"] = [asdict(c) for c in script]
    tracking = choreograph(sim.events, LEAGUE[home], LEAGUE[away], sim.ts, seed=seed) if with_tracking else None
    analytics = build_analytics(sim.events, meta, tracking)
    pkg = {"meta": meta, "events": sim.events, "analytics": analytics}
    if save:
        folder = DATA_DIR / mid
        folder.mkdir(parents=True, exist_ok=True)
        for name in ("meta", "events", "analytics"):
            (folder / f"{name}.json").write_text(json.dumps(pkg[name], separators=(",", ":")), encoding="utf-8")
        if tracking is not None:
            xy = np.where(np.isnan(tracking.xy), -1, np.round(tracking.xy * 10)).astype(np.int16)
            ball = np.round(tracking.ball * 10).astype(np.int16)
            ball_z = np.round(tracking.ball_z * 10).astype(np.int16)
            np.savez_compressed(folder / "tracking.npz", xy=xy, ball=ball, ball_z=ball_z,
                                on_ball=tracking.on_ball.astype(np.int8), player_ids=np.array(tracking.player_ids),
                                teams=np.array(tracking.teams))
    return pkg


def drama_score(events: list[dict]) -> float:
    """How watchable is this match? Rewards goals, lead changes, late drama and comebacks."""
    goals = [e for e in events if e["type"] == "goal"]
    if not goals:
        return 0.0
    score = 1.2 * min(len(goals), 6)
    lead = 0
    biggest_deficit = {"home": 0, "away": 0}
    changes = 0
    for g in goals:
        s = g["score"]
        new_lead = (s["home"] > s["away"]) - (s["home"] < s["away"])
        if new_lead != lead and lead != 0:
            changes += 1
        lead = new_lead
        biggest_deficit["home"] = max(biggest_deficit["home"], s["away"] - s["home"])
        biggest_deficit["away"] = max(biggest_deficit["away"], s["home"] - s["away"])
        if g["minute"] >= 80:
            score += 1.5
    final = goals[-1]["score"]
    for side, other in (("home", "away"), ("away", "home")):
        if biggest_deficit[side] >= 1 and final[side] >= final[other]:
            score += 3.0 * biggest_deficit[side]  # came back
    score += 1.0 * changes
    score += 1.5 * sum(1 for e in events if e["type"] == "card" and e.get("outcome") in ("red", "second_yellow"))
    score += 0.8 * sum(1 for e in events if e["type"] == "tactical_change")
    if abs(final["home"] - final["away"]) >= 4:
        score -= 3.0
    return round(score, 2)


# ------------------------------------------------------------------ loading

def list_matches() -> list[dict]:
    out = []
    if not DATA_DIR.exists():
        return out
    for folder in sorted(DATA_DIR.iterdir()):
        meta_file = folder / "meta.json"
        if meta_file.exists():
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
            out.append({k: meta[k] for k in ("id", "title", "score", "competition")} | {
                "home": {k: meta["teams"]["home"][k] for k in ("id", "name", "short", "primary", "secondary")},
                "away": {k: meta["teams"]["away"][k] for k in ("id", "name", "short", "primary", "secondary")},
                "featured": meta.get("featured", False), "blurb": meta.get("blurb"),
            })
    out.sort(key=lambda m: (not m["featured"], m["title"]))
    return out


@lru_cache(maxsize=16)
def load(mid: str) -> dict:
    folder = DATA_DIR / mid
    if not (folder / "meta.json").exists():
        raise KeyError(mid)
    return {name: json.loads((folder / f"{name}.json").read_text(encoding="utf-8"))
            for name in ("meta", "events", "analytics")}


@lru_cache(maxsize=4)
def load_tracking(mid: str) -> dict:
    data = np.load(DATA_DIR / mid / "tracking.npz")
    n = data["ball"].shape[0]
    return {"xy": data["xy"], "ball": data["ball"],
            "ball_z": data["ball_z"] if "ball_z" in data else np.zeros(n, dtype=np.int16),
            "on_ball": data["on_ball"] if "on_ball" in data else np.full(n, -1, dtype=np.int8),
            "player_ids": [str(p) for p in data["player_ids"]], "teams": [str(t) for t in data["teams"]]}
