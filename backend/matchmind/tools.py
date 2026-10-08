"""Match-data tools shared by the MCP server and the agents.

Every result is also appended to a request-scoped evidence log, which the
fact-checker uses as the "allowed facts" for a free-form answer.
"""

from __future__ import annotations

import contextvars
import json
from typing import Annotated, Any

from . import store
from .ai.packets import _event_line, moment_packet
from .analytics.stats import describe_chain, possession_chain, team_stats
from .whatif import run_what_if

_evidence: contextvars.ContextVar[list | None] = contextvars.ContextVar("evidence", default=None)


def start_evidence_log() -> list:
    log: list = []
    _evidence.set(log)
    return log


def _record(name: str, result: Any) -> Any:
    log = _evidence.get()
    if log is not None:
        log.append({"tool": name, "result": result})
    return result


def _side(meta: dict, team: str) -> str:
    t = team.strip().lower()
    for side in ("home", "away"):
        info = meta["teams"][side]
        if t in (side, info["id"].lower(), info["name"].lower(), info["short"].lower()) or t in info["name"].lower():
            return side
    raise ValueError(f"unknown team '{team}'. Use '{meta['teams']['home']['name']}' or '{meta['teams']['away']['name']}'")


def _player_id(meta: dict, name: str) -> str:
    n = name.strip().lower()
    for pid, full in meta["player_names"].items():
        if n == full.lower() or n == pid.lower():
            return pid
    matches = [pid for pid, full in meta["player_names"].items() if n in full.lower()]
    if len(matches) == 1:
        return matches[0]
    raise ValueError(f"player '{name}' not found or ambiguous" + (f": {[meta['player_names'][m] for m in matches]}"
                                                                  if matches else ""))


def match_overview(match_id: Annotated[str, "Match id"]) -> dict:
    """Teams, tactical styles, final score, goalscorers and the list of key moments."""
    pkg = store.load(match_id)
    meta, an = pkg["meta"], pkg["analytics"]
    teams = {s: meta["teams"][s]["name"] for s in ("home", "away")}
    result = {
        "match_id": match_id,
        "teams": {teams[s]: {"formation": meta["teams"][s]["dna"]["formation"], "style": meta["teams"][s]["traits"],
                             "coach": meta["teams"][s]["coach"]} for s in ("home", "away")},
        "final_score": {teams["home"]: meta["score"]["home"], teams["away"]: meta["score"]["away"]},
        "goals": [{"clock": m["clock"], "team": m["team_name"], "scorer": m["facts"]["shooter"],
                   "event_id": m["evidence"][-1]} for m in an["moments"] if m["type"] == "goal"],
        "moments": [{"id": m["id"], "clock": m["clock"], "type": m["type"], "title": m["title"]}
                    for m in an["moments"]],
    }
    return _record("match_overview", result)


def get_moment(match_id: Annotated[str, "Match id"], moment_id: Annotated[str, "Moment id such as m3"]) -> dict:
    """Full fact packet for one key moment: facts, build-up events with ids, recent team stats."""
    pkg = store.load(match_id)
    m = next((m for m in pkg["analytics"]["moments"] if m["id"] == moment_id), None)
    if m is None:
        raise ValueError(f"no moment {moment_id}")
    return _record("get_moment", moment_packet(pkg, m))


def get_team_stats(
    match_id: Annotated[str, "Match id"],
    team: Annotated[str, "Team name, or 'home' / 'away'"],
    from_minute: Annotated[float, "Start minute (0 = kick-off)"] = 0,
    to_minute: Annotated[float, "End minute (use 120 for full time)"] = 120,
) -> dict:
    """Team statistics (xG, shots, possession, PPDA, field tilt, pressing, set pieces...) for a minute window."""
    pkg = store.load(match_id)
    side = _side(pkg["meta"], team)
    stats = team_stats(pkg["events"], side, from_minute * 60, to_minute * 60)
    result = {"team": pkg["meta"]["teams"][side]["name"], "from_minute": from_minute, "to_minute": to_minute, **stats}
    return _record("get_team_stats", result)


def get_player_stats(match_id: Annotated[str, "Match id"], player: Annotated[str, "Player name"]) -> dict:
    """One player's match: passing, shooting, xG/xA, defending, rating, distance, top speed, sprints."""
    pkg = store.load(match_id)
    meta = pkg["meta"]
    pid = _player_id(meta, player)
    side = "home" if pid in meta["teams"]["home"]["starters"] + meta["teams"]["home"]["bench"] else "away"
    role = next((p["role"] for p in meta["teams"][side]["players"] if p["id"] == pid), None)
    result = {"player": meta["player_names"][pid], "team": meta["teams"][side]["name"], "position": role,
              **pkg["analytics"]["player_stats"].get(pid, {"minutes": 0})}
    return _record("get_player_stats", result)


def top_players(
    match_id: Annotated[str, "Match id"],
    metric: Annotated[str, "rating, xg, xa, key_passes, progressive_passes, tackles, interceptions, distance_km, "
                           "top_speed_kmh, sprints, saves"] = "rating",
    limit: Annotated[int, "How many players"] = 5,
) -> dict:
    """Leaderboard of players in this match for a metric."""
    pkg = store.load(match_id)
    meta = pkg["meta"]
    rows = []
    for pid, s in pkg["analytics"]["player_stats"].items():
        if metric in s:
            side = "home" if pid in meta["teams"]["home"]["starters"] + meta["teams"]["home"]["bench"] else "away"
            rows.append({"player": meta["player_names"][pid], "team": meta["teams"][side]["name"], metric: s[metric]})
    rows.sort(key=lambda r: -r[metric])
    return _record("top_players", {"metric": metric, "players": rows[: max(1, min(limit, 11))]})


def find_events(
    match_id: Annotated[str, "Match id"],
    event_type: Annotated[str, "shot, pass, carry, tackle, interception, foul, card, save, substitution, "
                               "tactical_change"] = "shot",
    team: Annotated[str | None, "Optional team name"] = None,
    player: Annotated[str | None, "Optional player name"] = None,
    from_minute: Annotated[float, "Start minute"] = 0,
    to_minute: Annotated[float, "End minute"] = 120,
    limit: Annotated[int, "Max events"] = 25,
) -> dict:
    """Search the event stream. Each event comes back with its id, clock, player and outcome."""
    pkg = store.load(match_id)
    meta = pkg["meta"]
    names = meta["player_names"]
    teams = {s: meta["teams"][s]["name"] for s in ("home", "away")}
    side = _side(meta, team) if team else None
    pid = _player_id(meta, player) if player else None
    out = []
    for e in pkg["events"]:
        if e["type"] != event_type or not (from_minute * 60 <= e["ts"] <= to_minute * 60):
            continue
        if side and e["team"] != side:
            continue
        if pid and pid not in (e.get("player"), e.get("receiver"), e.get("player_on"), e.get("player_off")):
            continue
        line = _event_line(e, names, teams)
        if e["type"] in ("tactical_change", "substitution"):
            line.update({k: e[k] for k in ("note", "changes") if k in e})
            if e["type"] == "substitution":
                line.update({"on": names.get(e["player_on"]), "off": names.get(e["player_off"])})
        out.append(line)
    return _record("find_events", {"count": len(out), "events": out[:limit]})


def explain_possession(match_id: Annotated[str, "Match id"], event_id: Annotated[int, "Event id"]) -> dict:
    """How a possession unfolded up to an event: how the ball was won, passes, players, duration."""
    pkg = store.load(match_id)
    names = pkg["meta"]["player_names"]
    teams = {s: pkg["meta"]["teams"][s]["name"] for s in ("home", "away")}
    chain = possession_chain(pkg["events"], event_id)
    summary = describe_chain(chain, names)
    summary["team"] = teams.get(summary.get("team"), summary.get("team"))
    summary["events"] = [_event_line(e, names, teams) for e in chain]
    return _record("explain_possession", summary)


def momentum_phases(match_id: Annotated[str, "Match id"]) -> dict:
    """Which team was on top in each 5-minute phase, from threat created (xT + xG)."""
    pkg = store.load(match_id)
    teams = {s: pkg["meta"]["teams"][s]["name"] for s in ("home", "away")}
    mom = pkg["analytics"]["momentum"]
    phases = []
    for start in range(0, len(mom), 5):
        rows = mom[start:start + 5]
        h, a = sum(r["home"] for r in rows), sum(r["away"] for r in rows)
        lead = teams["home"] if h > a * 1.3 else teams["away"] if a > h * 1.3 else "even"
        phases.append({"minutes": f"{start}-{start + len(rows)}", "on_top": lead,
                       "threat_home": round(h, 2), "threat_away": round(a, 2)})
    return _record("momentum_phases", {"teams": teams, "phases": phases})


def simulate_what_if(
    match_id: Annotated[str, "Match id"],
    team: Annotated[str, "Team that changes tactics"],
    from_minute: Annotated[float, "Minute the change is made"],
    changes: Annotated[str, 'JSON object of tactical dials 0..1 and/or formation, e.g. {"press": 0.9, '
                            '"formation": "3-4-3"}. Dials: press, tempo, directness, width, line_height, counter.'],
    runs: Annotated[int, "Number of simulations (50-400)"] = 200,
) -> dict:
    """Re-simulate the rest of the match many times with and without a tactical change and compare outcomes."""
    pkg = store.load(match_id)
    side = _side(pkg["meta"], team)
    parsed = json.loads(changes) if isinstance(changes, str) else changes
    result = run_what_if(pkg["meta"], side, from_minute, parsed, runs=max(50, min(int(runs), 400)))
    return _record("simulate_what_if", result)


ALL_TOOLS = [match_overview, get_moment, get_team_stats, get_player_stats, top_players, find_events,
             explain_possession, momentum_phases, simulate_what_if]
