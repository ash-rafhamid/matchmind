"""Find the moments worth talking about, each with its supporting evidence.

A moment is a small, fully verifiable fact packet: what happened, when, who
was involved, the numbers behind it, and the event ids that prove it. The AI
crew narrates moments; it never invents them.
"""

from __future__ import annotations

from .stats import describe_chain, momentum, possession_chain, team_stats


def _score_after(events: list[dict], ts: float) -> dict:
    goals = [e for e in events if e["type"] == "goal" and e["ts"] <= ts]
    return goals[-1]["score"] if goals else {"home": 0, "away": 0}


def _game_state(score: dict, side: str) -> str:
    mine, theirs = score[side], score["away" if side == "home" else "home"]
    if mine > theirs:
        return "leading"
    if mine < theirs:
        return "trailing"
    return "level"


def detect_moments(events: list[dict], meta: dict) -> list[dict]:
    names = meta["player_names"]
    team_name = {s: meta["teams"][s]["name"] for s in ("home", "away")}
    by_id = {e["id"]: e for e in events}
    moments: list[dict] = []

    def add(kind: str, e: dict, importance: float, title: str, facts: dict, evidence: list[int],
            players: list[str]) -> None:
        moments.append({
            "id": f"m{len(moments) + 1}",
            "type": kind,
            "ts": e["ts"],
            "clock": e["clock"],
            "minute": e["minute"],
            "team": e["team"],
            "team_name": team_name[e["team"]],
            "title": title,
            "importance": round(importance, 2),
            "players": [p for p in players if p],
            "facts": facts,
            "evidence": evidence,
        })

    for e in events:
        if e["type"] == "shot":
            shooter = names.get(e["player"], e["player"])
            assist = by_id.get(e.get("related"))
            assister = names.get(assist["player"]) if assist and assist.get("player") else None
            chain = describe_chain(possession_chain(events, e["id"]), names)
            facts = {
                "shooter": shooter,
                "xg": e["xg"],
                "outcome": e["outcome"],
                "body_part": e.get("body_part"),
                "situation": e.get("situation"),
                "distance_m": round(((105 - _own_x(e)) ** 2 + (34 - _own_y(e)) ** 2) ** 0.5, 1),
                "assist_by": assister,
                "assist_type": assist.get("pass_type") if assist else None,
                "build_up": chain,
            }
            if e["outcome"] == "goal":
                # the goal event itself (a moment after the shot, when the ball crosses the line) carries the score
                goal = next((g for g in events if g["type"] == "goal" and g["team"] == e["team"] and e["ts"] - 0.01 <= g["ts"] <= e["ts"] + 6), None)
                score = dict(goal["score"]) if goal else _score_after(events, e["ts"] + 6)
                before = dict(score)
                before[e["team"]] -= 1
                other = "away" if e["team"] == "home" else "home"
                facts["score_before"] = before
                facts["score_after"] = score
                facts["state_before"] = _game_state(before, e["team"])
                facts["state_after"] = _game_state(score, e["team"])
                effect = {("trailing", "level"): "equaliser", ("level", "leading"): "puts them ahead",
                          ("trailing", "trailing"): "pulls one back", ("leading", "leading"): "extends the lead"}
                facts["what_the_goal_did"] = (f"{effect.get((facts['state_before'], facts['state_after']), 'goal')}: "
                                              f"{team_name[e['team']]} {score[e['team']]}-{score[other]} {team_name[other]}")
                imp = 1.0 if facts["state_before"] != "leading" else 0.85
                if e["minute"] >= 80:
                    imp += 0.1
                kind = "goal"
                title = f"GOAL - {shooter} ({team_name[e['team']]})"
                if "penalty" in e["tags"]:
                    title += " from the spot"
                add(kind, e, imp, title, facts, chain.get("event_ids", []) + [e["id"]], [shooter, assister])
            elif e["xg"] >= 0.3:
                keeper_save = e["outcome"] == "saved"
                title = f"Big chance {'saved' if keeper_save else 'missed'} - {shooter}"
                add("big_chance", e, 0.55 + e["xg"] * 0.3, title, facts, chain.get("event_ids", []) + [e["id"]],
                    [shooter, assister])
            elif e["outcome"] == "saved" and e["xg"] >= 0.15:
                save = next((x for x in events if x["type"] == "save" and x.get("related") == e["id"]), None)
                keeper = names.get(save["player"]) if save else None
                facts["keeper"] = keeper
                add("save", e, 0.45, f"Fine save by {keeper}", facts,
                    chain.get("event_ids", []) + [e["id"]] + ([save["id"]] if save else []), [shooter, keeper])
        elif e["type"] == "card" and e.get("outcome") in ("red", "second_yellow"):
            p = names.get(e["player"])
            add("red_card", e, 0.9, f"Red card - {p}", {"player": p, "card": e["outcome"],
                "score_at_time": _score_after(events, e["ts"])}, [e["id"], e.get("related")], [p])
        elif e["type"] == "tactical_change":
            add("tactical_change", e, 0.6, f"{team_name[e['team']]} change approach",
                tactical_impact(events, e), [e["id"]], [])

    moments.extend(_momentum_swings(events, meta))
    moments.sort(key=lambda m: m["ts"])
    for i, m in enumerate(moments):
        m["id"] = f"m{i + 1}"
    return moments


def _own_x(e: dict) -> float:
    return e["x"] if e["team"] == "home" else 105 - e["x"]


def _own_y(e: dict) -> float:
    return e["y"] if e["team"] == "home" else 68 - e["y"]


def tactical_impact(events: list[dict], change: dict, window_s: float = 900.0) -> dict:
    """Compare the changing team's numbers in the 15 minutes before and after."""
    side = change["team"]
    t = change["ts"]
    end = max(e["ts"] for e in events)
    after_window = min(window_s, end - t)
    keys = ("xg", "shots", "possession_pct", "field_tilt_pct", "ppda", "high_turnovers", "box_touches")
    before = team_stats(events, side, t - after_window, t)
    after = team_stats(events, side, t, t + after_window)
    opp = "away" if side == "home" else "home"
    opp_before = team_stats(events, opp, t - after_window, t)
    opp_after = team_stats(events, opp, t, t + after_window)
    return {
        "label": change.get("note"),
        "source": change.get("source"),
        "changes": change.get("changes"),
        "before_values": change.get("before"),
        "window_minutes": round(after_window / 60, 1),
        "team_before": {k: before[k] for k in keys},
        "team_after": {k: after[k] for k in keys},
        "opponent_xg_before": opp_before["xg"],
        "opponent_xg_after": opp_after["xg"],
        "score_at_change": _score_after(events, t),
    }


def _momentum_swings(events: list[dict], meta: dict) -> list[dict]:
    end_ts = max(e["ts"] for e in events)
    mom = momentum(events, end_ts, window_min=8)
    out = []
    last_side = None
    last_minute = -99
    for row in mom:
        m = row["momentum"]
        side = "home" if m > 0.45 else "away" if m < -0.45 else None
        if side and side != last_side and row["minute"] - last_minute >= 10 and 5 <= row["minute"] <= end_ts / 60 - 3:
            team = meta["teams"][side]["name"]
            ts = row["minute"] * 60.0
            # pin the swing to the nearest real event so it has a clock and evidence
            anchor = min((e for e in events if e["type"] in ("pass", "carry", "shot")), key=lambda e: abs(e["ts"] - ts))
            window = [e for e in events if ts - 240 <= e["ts"] <= ts + 240 and e["team"] == side]
            shots = [e for e in window if e["type"] == "shot"]
            out.append({
                "id": "",
                "type": "momentum",
                "ts": anchor["ts"],
                "clock": anchor["clock"],
                "minute": anchor["minute"],
                "team": side,
                "team_name": team,
                "title": f"{team} take control",
                "importance": round(0.3 + 0.2 * abs(m), 2),
                "players": [],
                "facts": {
                    "momentum_index": m,
                    "window_minutes": 8,
                    "shots_in_window": len(shots),
                    "xg_in_window": round(sum(e["xg"] for e in shots), 2),
                    "final_third_entries_in_window": sum("final_third_entry" in e["tags"] for e in window),
                },
                "evidence": [e["id"] for e in shots] or [anchor["id"]],
            })
            last_side, last_minute = side, row["minute"]
        elif side is None and abs(m) < 0.15:
            last_side = None
    return out
