"""Template narration used when no language model is configured.

It is deliberately plain, but it is built only from the fact packet, so it
always passes the verifier and the app stays fully usable offline.
"""

from __future__ import annotations


def _chance_words(xg: float) -> str:
    if xg >= 0.5:
        return "a gilt-edged chance"
    if xg >= 0.3:
        return "a big chance"
    if xg >= 0.12:
        return "a decent chance"
    return "a long shot"


def _build_up(f: dict) -> str:
    b = f.get("build_up") or {}
    if b.get("started_from") == "penalty":
        return "It came from the penalty spot."
    won = b.get("won_by")
    if won:
        where = "high up the pitch" if won.get("high_turnover") else "in their own half"
        article = "an" if won["type"][0] in "aeiou" else "a"
        start = (f"It started when {won['player']} won the ball with {article} {won['type']} {where} "
                 f"[#{won['event_id']}]")
    elif b.get("started_from") not in (None, "open play"):
        start = f"It came from a {str(b['started_from']).replace('_', ' ')}"
    else:
        start = "It came from open play"
    passes = b.get("passes", 0)
    secs = b.get("duration_s", 0)
    return f"{start}, {passes} passes in {secs} seconds."


def narrate_moment(packet: dict, persona: str) -> str:
    m = packet["moment"]
    f = m["facts"]
    kind = m["type"]
    clock = m["clock"]
    team = m["team_name"]
    ids = packet["evidence_ids"]
    last = ids[-1] if ids else None
    tag = f" [#{last}]" if last else ""

    if kind == "goal":
        score = " - ".join(f"{t} {s}" for t, s in packet["score_after_this_moment"].items())
        how = f"a {f['body_part']}" if f.get("body_part") == "head" else "a finish"
        assist = f", set up by {f['assist_by']}" if f.get("assist_by") else ""
        base = f"{clock} GOAL for {team}! {f['shooter']} scores with {how} from {f['distance_m']} m{assist}{tag}."
        if f.get("situation") == "penalty":
            base = f"{clock} GOAL for {team}! {f['shooter']} converts the penalty{tag}."
        if persona == "kid":
            return f"{clock} GOAL! {f['shooter']} scores for {team}{tag}! It's now {score}."
        if persona == "analyst":
            return (f"{base} The chance was worth {f['xg']} xG. {_build_up(f)} Score: {score}.")
        if persona == "coach":
            return (f"{base} {_build_up(f)} Coaching point: the move worked because it reached a shooting position "
                    f"worth {f['xg']} xG before the defence could reset.")
        if persona == "audio":
            return (f"{clock}. {team} attack the goal. {f['shooter']} shoots from {f['distance_m']} metres{tag} - "
                    f"and scores. {score}.")
        return f"{base} {_build_up(f)} It's {score}."

    if kind in ("big_chance", "save"):
        verb = "saved" if f["outcome"] == "saved" else "missed" if f["outcome"] == "off_target" else "blocked"
        keeper = f" by {f['keeper']}" if f.get("keeper") else ""
        if persona == "kid":
            return f"{clock} So close! {f['shooter']} nearly scored for {team}{tag}."
        if persona == "audio":
            return f"{clock}. {f['shooter']} shoots from {f['distance_m']} metres{tag}. {verb.capitalize()}{keeper}."
        return (f"{clock} {f['shooter']} had {_chance_words(f['xg'])} for {team} ({f['xg']} xG) but it was "
                f"{verb}{keeper}{tag}. {_build_up(f)}")

    if kind == "red_card":
        return f"{clock} Red card for {f['player']}{tag}. {team} are down to ten men."

    if kind == "tactical_change":
        before, after = f["team_before"], f["team_after"]
        line = (f"{clock} {team} change approach: {f['label']}{tag}. In the {f['window_minutes']} minutes before, "
                f"they had {before['xg']} xG and {before['possession_pct']}% possession; in the "
                f"{f['window_minutes']} minutes after, {after['xg']} xG and {after['possession_pct']}%.")
        if persona == "kid":
            return f"{clock} The {team} coach changes the plan{tag}! {f['label']}."
        return line

    if kind == "momentum":
        return (f"{clock} {team} are on top: {f['shots_in_window']} shots worth {f['xg_in_window']} xG and "
                f"{f['final_third_entries_in_window']} final-third entries around this period{tag}.")

    return f"{clock} {m['title']}{tag}."


def narrate_whatif(r: dict, persona: str) -> str:
    tested = ", ".join(f"{k.replace('_', ' ')} {v}" for k, v in r["tactics_tested"].items())
    a, b = r["as_played"], r["with_change"]
    lo, hi = r["expected_points_delta_95ci"]
    verdict = {"helps": "the change helps", "hurts": "the change hurts",
               "no clear effect": "there is no clear effect"}[r["verdict"]]
    if persona == "kid":
        return (f"We replayed the rest of the match {r['runs']} times! With the new plan ({tested}), "
                f"{r['team']} won {b['win_pct']}% of the time instead of {a['win_pct']}%.")
    minute = int(r["from_minute"]) if float(r["from_minute"]).is_integer() else r["from_minute"]
    return (f"Changing {r['team']} to {tested} from minute {minute}: across {r['runs']} simulations of the "
            f"rest of the match, the win chance moves from {a['win_pct']}% to {b['win_pct']}% and expected points "
            f"from {a['expected_points']} to {b['expected_points']}. Their xG for the remaining time goes from "
            f"{a['xg_for_rest_of_match']} to {b['xg_for_rest_of_match']}, and xG against from "
            f"{a['xg_against_rest_of_match']} to {b['xg_against_rest_of_match']}. The 95% interval for the change in "
            f"expected points is {lo} to {hi}, so {verdict}.")


def recap(packet: dict) -> dict:
    teams = list(packet["final_score"])
    h, a = teams
    sh, sa = packet["final_score"][h], packet["final_score"][a]
    winner = h if sh > sa else a if sa > sh else None
    headline = f"{h} {sh}-{sa} {a}" if not winner else f"{winner} win {max(sh, sa)}-{min(sh, sa)}"
    stats = packet["team_stats"]
    scorers = ", ".join(f"{g['scorer']} {g['clock']} [#{g['event_id']}]" for g in packet["goals"]) or "no goals"
    pom = packet["player_of_the_match"]
    body = (
        f"{h} {sh}-{sa} {a}. Goals: {scorers}. "
        f"xG finished {stats[h]['xg']} to {stats[a]['xg']}, with {stats[h]['shots']} shots to {stats[a]['shots']}. "
        f"{h} had {stats[h]['possession_pct']}% of the ball. "
        f"Player of the match: {pom['name']} ({pom['team']}), rated {pom['rating']}."
    )
    social = [f"FT: {h} {sh}-{sa} {a}. xG {stats[h]['xg']}-{stats[a]['xg']}. Player of the match: {pom['name']}."]
    return {"headline": headline, "article": body, "social": social}
