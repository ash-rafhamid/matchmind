"""Deterministic match analytics computed from the event stream.

Everything the AI crew says about numbers comes from here (or from the MCP
tools that wrap it), which is what makes the verifier possible: a claim is
supported only if it matches a value this module produced.
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict

from ..engine.pitch import PITCH_LENGTH, PITCH_WIDTH, in_box

SIDES = ("home", "away")
DEFENSIVE_ACTIONS = {"tackle", "interception", "foul"}


def own_frame(e: dict, key_x: str = "x", key_y: str = "y") -> tuple[float, float]:
    """Event location in the acting team's attacking frame."""
    x, y = e[key_x], e[key_y]
    return (x, y) if e["team"] == "home" else (PITCH_LENGTH - x, PITCH_WIDTH - y)


def channel(y_own: float) -> str:
    if y_own < PITCH_WIDTH / 3:
        return "left"
    if y_own > 2 * PITCH_WIDTH / 3:
        return "right"
    return "centre"


def _pct(a: float, b: float) -> float:
    return round(100 * a / b, 1) if b else 0.0


def team_stats(events: list[dict], side: str, t0: float = 0.0, t1: float = math.inf) -> dict:
    ev = [e for e in events if t0 <= e["ts"] < t1]
    mine = [e for e in ev if e["team"] == side]
    theirs = [e for e in ev if e["team"] != side]
    passes = [e for e in mine if e["type"] == "pass"]
    completed = [e for e in passes if e.get("outcome") == "complete"]
    shots = [e for e in mine if e["type"] == "shot"]
    on_ball = sum(e["dur"] for e in ev if e["type"] in ("pass", "carry") and e["team"] == side)
    on_ball_all = sum(e["dur"] for e in ev if e["type"] in ("pass", "carry"))

    # PPDA: opponent passes in their own 60% / our defensive actions in that zone.
    opp_passes_deep = sum(1 for e in theirs if e["type"] == "pass" and own_frame(e)[0] < 0.6 * PITCH_LENGTH)
    def_actions_high = sum(
        1 for e in mine if e["type"] in DEFENSIVE_ACTIONS and own_frame(e)[0] > 0.4 * PITCH_LENGTH
    )
    final_third = [e for e in completed if own_frame(e, "end_x", "end_y")[0] > 70]
    opp_final_third = sum(
        1 for e in theirs if e["type"] == "pass" and e.get("outcome") == "complete"
        and own_frame(e, "end_x", "end_y")[0] > 70
    )
    box_touches = sum(
        1 for e in mine if e["type"] in ("pass", "carry") and e.get("outcome") in ("complete", "success")
        and in_box(*own_frame(e, "end_x", "end_y"))
    )
    cards = Counter(e.get("outcome") for e in mine if e["type"] == "card")
    entries = Counter(channel(own_frame(e, "end_x", "end_y")[1]) for e in mine if "final_third_entry" in e["tags"])
    total_entries = sum(entries.values())

    return {
        "goals": sum(e.get("outcome") == "goal" for e in shots),
        "xg": round(sum(e["xg"] for e in shots), 2),
        "shots": len(shots),
        "shots_on_target": sum(e.get("outcome") in ("goal", "saved") for e in shots),
        "big_chances": sum("big_chance" in e["tags"] for e in shots),
        "possession_pct": _pct(on_ball, on_ball_all),
        "passes": len(passes),
        "pass_accuracy_pct": _pct(len(completed), len(passes)),
        "progressive_passes": sum("progressive" in e["tags"] for e in completed),
        "final_third_passes": len(final_third),
        "field_tilt_pct": _pct(len(final_third), len(final_third) + opp_final_third),
        "box_touches": box_touches,
        "ppda": round(opp_passes_deep / def_actions_high, 1) if def_actions_high else None,
        "high_turnovers": sum("high_turnover" in e["tags"] for e in mine),
        "counter_attack_shots": sum("counter" in e["tags"] for e in shots),
        "set_piece_xg": round(sum(e["xg"] for e in shots if "set_piece" in e["tags"]), 2),
        "corners": sum(e.get("set_piece") == "corner" for e in passes),
        "fouls": sum(e["type"] == "foul" for e in mine),
        "yellow_cards": cards["yellow"] + cards["second_yellow"],
        "red_cards": cards["red"] + cards["second_yellow"],
        "offsides": sum(e["type"] == "offside" for e in mine),
        "tackles_won": sum(e["type"] == "tackle" for e in mine),
        "interceptions": sum(e["type"] == "interception" for e in mine),
        "pressures": sum(e["type"] == "pressure" for e in mine),
        "attack_channels_pct": {k: _pct(entries[k], total_entries) for k in ("left", "centre", "right")},
    }


def player_stats(events: list[dict], physical: dict[str, dict] | None = None) -> dict[str, dict]:
    stats: dict[str, dict] = defaultdict(lambda: defaultdict(float))
    by_id = {e["id"]: e for e in events}
    for e in events:
        pid = e.get("player")
        if not pid:
            continue
        s = stats[pid]
        t = e["type"]
        if t == "pass":
            s["passes"] += 1
            if e.get("outcome") == "complete":
                s["passes_completed"] += 1
                if "progressive" in e["tags"]:
                    s["progressive_passes"] += 1
            if "key_pass" in e["tags"]:
                s["key_passes"] += 1
            if "assist" in e["tags"]:
                s["assists"] += 1
        elif t == "carry":
            s["carries"] += 1
            if e.get("outcome") == "success" and "progressive" in e["tags"]:
                s["progressive_carries"] += 1
        elif t == "shot":
            s["shots"] += 1
            s["xg"] += e["xg"]
            if e.get("outcome") == "goal":
                s["goals"] += 1
            if e.get("outcome") in ("goal", "saved"):
                s["shots_on_target"] += 1
            assist = by_id.get(e.get("related"))
            if assist and assist.get("player"):
                stats[assist["player"]]["xa"] += e["xg"]
        elif t in ("tackle", "interception", "block", "clearance", "pressure", "save", "foul"):
            s[{"tackle": "tackles", "interception": "interceptions", "block": "blocks", "clearance": "clearances",
               "pressure": "pressures", "save": "saves", "foul": "fouls"}[t]] += 1
        elif t == "card":
            s["yellow_cards" if e.get("outcome") == "yellow" else "red_cards"] += 1

    out = {}
    for pid, s in stats.items():
        row = {k: (round(v, 2) if isinstance(v, float) and not v.is_integer() else int(v)) for k, v in s.items()}
        if row.get("passes"):
            row["pass_accuracy_pct"] = _pct(row.get("passes_completed", 0), row["passes"])
        row["rating"] = _rating(row)
        if physical and pid in physical:
            row.update(physical[pid])
        out[pid] = row
    for pid, phys in (physical or {}).items():
        if pid not in out and phys.get("minutes", 0) > 0:
            out[pid] = {**phys, "rating": 6.0}
    return out


def _rating(s: dict) -> float:
    r = 6.0
    r += 0.9 * s.get("goals", 0) + 0.6 * s.get("assists", 0)
    r += 0.6 * s.get("xg", 0) + 0.5 * s.get("xa", 0) + 0.08 * s.get("key_passes", 0)
    r += 0.008 * s.get("progressive_passes", 0) + 0.015 * s.get("progressive_carries", 0)
    r += 0.04 * (s.get("tackles", 0) + s.get("interceptions", 0)) + 0.03 * s.get("blocks", 0)
    r += 0.15 * s.get("saves", 0)
    r -= 0.3 * s.get("yellow_cards", 0) + 1.5 * s.get("red_cards", 0) + 0.04 * s.get("fouls", 0)
    if s.get("passes", 0) >= 20:
        r += (s.get("pass_accuracy_pct", 80) - 80) / 40
    return round(max(3.0, min(10.0, r)), 1)


def momentum(events: list[dict], end_ts: float, window_min: float = 5.0) -> list[dict]:
    """Per-minute threat for each team and a smoothed momentum in [-1, 1] (+ = home)."""
    n = int(end_ts // 60) + 1
    threat = {s: [0.0] * n for s in SIDES}
    for e in events:
        m = min(int(e["ts"] // 60), n - 1)
        if e["type"] in ("pass", "carry") and e.get("outcome") in ("complete", "success"):
            threat[e["team"]][m] += max(e.get("xt", 0.0), 0.0)
        elif e["type"] == "shot":
            threat[e["team"]][m] += 0.5 * e["xg"]
    half = window_min / 2
    out = []
    for m in range(n):
        lo, hi = max(0, int(m - half)), min(n, int(m + half) + 1)
        h = sum(threat["home"][lo:hi])
        a = sum(threat["away"][lo:hi])
        out.append({
            "minute": m,
            "home": round(threat["home"][m], 4),
            "away": round(threat["away"][m], 4),
            "momentum": round((h - a) / (h + a), 3) if h + a > 0 else 0.0,
        })
    return out


def xg_timeline(events: list[dict]) -> list[dict]:
    totals = {s: 0.0 for s in SIDES}
    out = []
    for e in events:
        if e["type"] == "shot":
            totals[e["team"]] += e["xg"]
            out.append({"ts": e["ts"], "clock": e["clock"], "team": e["team"], "xg": e["xg"],
                        "outcome": e["outcome"], "home_cum": round(totals["home"], 2),
                        "away_cum": round(totals["away"], 2), "event_id": e["id"]})
    return out


def pass_network(events: list[dict], side: str, min_passes: int = 4) -> dict:
    loc: dict[str, list[tuple[float, float]]] = defaultdict(list)
    links: Counter = Counter()
    for e in events:
        if e["team"] != side or e["type"] != "pass" or e.get("set_piece"):
            continue
        loc[e["player"]].append((e["x"], e["y"]))
        if e.get("outcome") == "complete" and e.get("receiver"):
            links[(e["player"], e["receiver"])] += 1
    nodes = [{"player": p, "x": round(sum(x for x, _ in v) / len(v), 1), "y": round(sum(y for _, y in v) / len(v), 1),
              "passes": len(v)} for p, v in loc.items() if len(v) >= 5]
    known = {n["player"] for n in nodes}
    edges = [{"from": a, "to": b, "count": c} for (a, b), c in links.most_common() if c >= min_passes
             and a in known and b in known]
    return {"nodes": nodes, "edges": edges}


def possession_chain(events: list[dict], event_id: int) -> list[dict]:
    """All events of the possession that led to `event_id`, plus how the ball was won."""
    idx = next(i for i, e in enumerate(events) if e["id"] == event_id)
    target = events[idx]
    chain = [e for e in events[: idx + 1] if e["chain"] == target["chain"] and e["team"] == target["team"]
             and e["type"] not in ("pressure",)]
    start = chain[0] if chain else target
    # how was possession won? look at the event right before the chain started
    before = [e for e in events[: events.index(start)] if e["type"] in ("interception", "tackle", "save", "block",
                                                                       "clearance", "foul", "shot", "pass")]
    origin = before[-1] if before else None
    return ([origin] if origin else []) + chain


def describe_chain(chain: list[dict], names: dict[str, str]) -> dict:
    """Compact, verifiable summary of a possession chain."""
    if not chain:
        return {}
    body = [e for e in chain if e["type"] in ("pass", "carry", "shot")]
    origin = chain[0] if chain[0] not in body else None
    team = body[-1]["team"] if body else chain[-1]["team"]
    won_by = None
    if origin and origin["team"] == team and origin["type"] in ("interception", "tackle", "save", "block"):
        won_by = {"type": origin["type"], "player": names.get(origin.get("player", ""), origin.get("player")),
                  "high_turnover": "high_turnover" in origin["tags"], "event_id": origin["id"]}
    restart = next((e.get("set_piece") for e in body if e.get("set_piece")), None)
    final = body[-1] if body else None
    if final and final["type"] == "shot" and final.get("situation") in ("penalty", "free_kick", "corner"):
        restart = final["situation"]
    passes = [e for e in body if e["type"] == "pass" and e.get("outcome") == "complete"]
    seconds = round(body[-1]["ts"] + body[-1]["dur"] - body[0]["ts"], 1) if body else 0.0
    players = []
    for e in body:
        n = names.get(e.get("player", ""))
        if n and (not players or players[-1] != n):
            players.append(n)
    return {
        "team": team,
        "passes": len(passes),
        "duration_s": seconds,
        "started_from": restart or ("regain" if won_by else "open play"),
        "won_by": won_by,
        "players_involved": players,
        "event_ids": [e["id"] for e in chain],
        "start_x_own": round(own_frame(body[0])[0], 1) if body else None,
    }
