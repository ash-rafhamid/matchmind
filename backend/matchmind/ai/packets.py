"""Fact packets: the only information the crew is allowed to talk about."""

from __future__ import annotations

from ..analytics.stats import team_stats

EVENT_WORDS = {
    "pass": "pass", "carry": "carry", "shot": "shot", "interception": "interception", "tackle": "tackle won",
    "save": "save", "block": "block", "clearance": "clearance", "foul": "foul", "card": "card",
}


def _event_line(e: dict, names: dict[str, str], teams: dict[str, str]) -> dict:
    line = {
        "id": e["id"],
        "clock": e["clock"],
        "team": teams[e["team"]],
        "action": EVENT_WORDS.get(e["type"], e["type"]),
        "player": names.get(e.get("player") or "", None),
    }
    for k in ("outcome", "pass_type", "set_piece", "xg", "body_part"):
        if e.get(k) is not None:
            line[k] = e[k]
    if e.get("receiver"):
        line["to"] = names.get(e["receiver"])
    tags = [t for t in e["tags"] if t in ("high_turnover", "counter_start", "key_pass", "assist", "big_chance",
                                         "progressive", "final_third_entry", "header", "penalty")]
    if tags:
        line["tags"] = tags
    return line


def _teams(meta: dict) -> dict[str, str]:
    return {s: meta["teams"][s]["name"] for s in ("home", "away")}


def _dna(meta: dict, side: str) -> dict:
    t = meta["teams"][side]
    return {"team": t["name"], "formation": t["dna"]["formation"], "style": t["traits"], "coach": t["coach"]}


def moment_packet(pkg: dict, moment: dict) -> dict:
    meta, events = pkg["meta"], pkg["events"]
    names = meta["player_names"]
    teams = _teams(meta)
    evidence = set(moment["evidence"])
    chain = [_event_line(e, names, teams) for e in events if e["id"] in evidence]
    t = moment["ts"]
    side = moment["team"]
    other = "away" if side == "home" else "home"
    recent = {teams[s]: _compact(team_stats(events, s, max(0.0, t - 600), t + 1)) for s in (side, other)}
    goals_so_far = [e for e in events if e["type"] == "goal" and e["ts"] <= t + 1]
    score = goals_so_far[-1]["score"] if goals_so_far else {"home": 0, "away": 0}
    return {
        "match": f"{teams['home']} vs {teams['away']}",
        "competition": meta["competition"],
        "moment": {k: moment[k] for k in ("type", "clock", "title", "team_name", "players", "facts")},
        "score_now": {teams["home"]: score["home"], teams["away"]: score["away"]},
        "team_styles": [_dna(meta, "home"), _dna(meta, "away")],
        "last_10_minutes": recent,
        "event_trail": chain,
        "evidence_ids": sorted(evidence),
    }


def recap_packet(pkg: dict) -> dict:
    meta, events, an = pkg["meta"], pkg["events"], pkg["analytics"]
    names = meta["player_names"]
    teams = _teams(meta)
    goals = []
    for e in events:
        if e["type"] == "shot" and e.get("outcome") == "goal":
            goals.append({"clock": e["clock"], "team": teams[e["team"]], "scorer": names.get(e["player"]),
                          "xg": e["xg"], "event_id": e["id"],
                          "penalty": "penalty" in e["tags"], "header": "header" in e["tags"]})
    ratings = sorted(((pid, s) for pid, s in an["player_stats"].items() if s.get("minutes", 90) >= 30),
                     key=lambda kv: -kv[1]["rating"])
    pom_id, pom = ratings[0]
    key = [m for m in an["moments"] if m["type"] in ("goal", "red_card", "tactical_change", "big_chance")]
    return {
        "match": f"{teams['home']} vs {teams['away']}",
        "competition": meta["competition"],
        "final_score": {teams["home"]: meta["score"]["home"], teams["away"]: meta["score"]["away"]},
        "goals": goals,
        "team_stats": {teams[s]: _compact(an["team_stats"]["full"][s]) for s in ("home", "away")},
        "first_half": {teams[s]: _compact(an["team_stats"]["first_half"][s]) for s in ("home", "away")},
        "second_half": {teams[s]: _compact(an["team_stats"]["second_half"][s]) for s in ("home", "away")},
        "team_styles": [_dna(meta, "home"), _dna(meta, "away")],
        "player_of_the_match": {"name": names.get(pom_id), "team": teams[_side_of(pom_id, meta)],
                                **{k: v for k, v in pom.items() if k in ("rating", "goals", "assists", "xg", "xa",
                                   "key_passes", "tackles", "interceptions", "distance_km", "saves")}},
        "key_moments": [{"clock": m["clock"], "type": m["type"], "title": m["title"], "facts": _slim(m["facts"]),
                         "evidence": m["evidence"][-3:]} for m in key],
        "evidence_ids": sorted({g["event_id"] for g in goals} | {i for m in key for i in m["evidence"][-3:]}),
    }


def _side_of(pid: str, meta: dict) -> str:
    return "home" if pid in meta["teams"]["home"]["starters"] + meta["teams"]["home"]["bench"] else "away"


def _compact(stats: dict) -> dict:
    keep = ("goals", "xg", "shots", "shots_on_target", "big_chances", "possession_pct", "pass_accuracy_pct",
            "field_tilt_pct", "ppda", "high_turnovers", "box_touches", "corners")
    return {k: stats[k] for k in keep if k in stats}


def _slim(facts: dict) -> dict:
    out = {k: v for k, v in facts.items() if k not in ("build_up",)}
    if "build_up" in facts:
        b = facts["build_up"]
        out["build_up"] = {k: b.get(k) for k in ("passes", "duration_s", "started_from", "players_involved")}
    return out
