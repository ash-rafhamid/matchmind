"""Play-by-play commentary lines from the event script, for the commentator's voice.

Short, broadcast-style calls ("Okafor shoots... saved by Osei!") with a priority, so the player can pick
what to say when two things happen at once. Every line is built from the events and the team sheets only,
so nothing here can be wrong about the match. Templates are translated once, offline (scripts/translate_commentary.py).
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from .engine.pitch import PITCH_LENGTH

TEMPLATES: dict[str, list[str]] = {
    "kickoff_first": ["And we're under way!", "Kick-off, and here we go!"],
    "kickoff_second": ["The second half is under way."],
    "kickoff_restart": ["{team} get us going again."],
    "pass_box": ["{player} finds {receiver} in the box!", "Into the box, {receiver}!"],
    "cross": ["{player} whips in a cross!", "Cross from {player}!"],
    "through": ["{player} slides {receiver} through!", "Lovely ball from {player}!"],
    "long": ["Long ball forward from {player}.", "{player} goes long."],
    "final_third": ["{player} plays it into {receiver}.", "{receiver} picks it up in the final third."],
    "pass": ["{player}.", "{player} to {receiver}.", "{receiver}.", "Now {receiver}."],
    "carry": ["{player} drives forward!", "{player} on the run!", "{player} carries it on."],
    "corner": ["{player} to take the corner.", "Corner, {team}."],
    "free_kick": ["{player} stands over the free kick.", "Free kick, {team}."],
    "shot": ["{player} shoots!", "{player} has a go!", "{player}, can he score?"],
    "goal": ["GOAL! {player}! {home} {home_score}, {away} {away_score}!", "It's in! {player} scores! {home} {home_score}, {away} {away_score}!"],
    "saved": ["Saved by {keeper}!", "Good stop from {keeper}!", "{keeper} keeps it out!"],
    "off_target": ["Just wide!", "Off target.", "Over the bar!"],
    "blocked": ["Blocked!", "Charged down!"],
    "tackle": ["Great tackle by {player}!", "{player} wins it back!"],
    "interception": ["{player} cuts it out.", "Intercepted by {player}."],
    "clearance": ["{player} clears.", "Cleared by {player}."],
    "foul": ["Foul by {player} on {victim}.", "{victim} is brought down by {player}."],
    "yellow": ["Yellow card for {player}."],
    "red": ["Red card! {player} is sent off!"],
    "offside": ["Offside, {player}.", "The flag is up for offside."],
    "substitution": ["Change for {team}: {on} comes on for {off}."],
    "tactics": ["{team} are changing their approach."],
    "half_time": ["That's half-time. {home} {home_score}, {away} {away_score}."],
    "full_time": ["Full-time! It finishes {home} {home_score}, {away} {away_score}."],
}

# how much a call matters: 4 must be said (and may interrupt), 0 only fills a silence
PRIORITY = {"goal": 4, "red": 4, "half_time": 4, "full_time": 4, "shot": 3, "saved": 3, "off_target": 3, "blocked": 3,
            "foul": 3, "yellow": 3, "pass_box": 2, "cross": 2, "through": 2, "corner": 2, "free_kick": 2, "tackle": 2,
            "substitution": 2, "offside": 2, "kickoff_first": 3, "kickoff_second": 3, "kickoff_restart": 1, "carry": 1,
            "long": 1, "final_third": 1, "interception": 1, "clearance": 1, "tactics": 1, "pass": 0}
EXCITED = {"goal", "red", "shot", "saved", "pass_box", "through", "cross"}

I18N = Path(__file__).with_name("commentary_i18n.json")


@lru_cache(maxsize=1)
def _translations() -> dict[str, dict[str, list[str]]]:
    return json.loads(I18N.read_text(encoding="utf-8")) if I18N.exists() else {}


def templates(lang: str) -> dict[str, list[str]]:
    if lang == "en":
        return TEMPLATES
    tr = _translations().get(lang, {})
    return {k: tr.get(k) or v for k, v in TEMPLATES.items()}


def _surname(name: str) -> str:
    return name.split(" ")[-1] if name else name


def build_lines(pkg: dict, lang: str = "en") -> list[dict]:
    """Every call the commentator could make, in time order: {id, ts, text, prio, excited}."""
    meta = pkg["meta"]
    names = meta["player_names"]
    teams = meta["teams"]
    T = templates(lang)
    out: list[dict] = []
    score = {"home": 0, "away": 0}
    periods: set[int] = set()
    events = pkg["events"]

    def name(pid: str | None) -> str:
        return _surname(names.get(pid or "", "")) if pid else ""

    def say(e: dict, kind: str, ts: float, suffix: str = "", **kw: str) -> None:
        variants = T[kind]
        text = variants[e["id"] % len(variants)]
        fields = {"home": teams["home"]["name"], "away": teams["away"]["name"],
                  "home_score": str(score["home"]), "away_score": str(score["away"]),
                  "team": teams[e["team"]]["name"] if e.get("team") in teams else "", **kw}
        try:
            text = text.format(**fields)
        except (KeyError, IndexError):
            text = TEMPLATES[kind][0].format(**fields)
        out.append({"id": f"{e['id']}{suffix}", "ts": round(ts, 2), "text": text, "prio": PRIORITY[kind], "excited": kind in EXCITED})

    for e in events:
        typ = e["type"]
        p = name(e.get("player"))
        attack_x = e.get("end_x", e.get("x", 0.0))
        if e.get("team") == "away":
            attack_x = PITCH_LENGTH - attack_x
        if typ == "pass":
            sp = e.get("set_piece")
            r = name(e.get("receiver"))
            if sp == "kickoff":
                period = int(e.get("period", 1))
                say(e, "kickoff_restart" if period in periods else "kickoff_first" if period == 1 else "kickoff_second", e["ts"])
                periods.add(period)
            elif sp == "corner":
                say(e, "corner", e["ts"] - 1.5, player=p)
            elif sp == "free_kick":
                say(e, "free_kick", e["ts"] - 2.5, player=p)
            elif sp:
                continue
            elif e.get("pass_type") == "cross":
                say(e, "cross", e["ts"] + 0.3, player=p)
            elif e.get("pass_type") == "through" and r:
                say(e, "through", e["ts"] + 0.3, player=p, receiver=r)
            elif r and e.get("outcome") == "complete" and attack_x > 88:
                say(e, "pass_box", e["ts"] + 0.4, player=p, receiver=r)
            elif e.get("pass_type") == "long":
                say(e, "long", e["ts"] + 0.3, player=p)
            elif r and e.get("outcome") == "complete" and attack_x > 70:
                say(e, "final_third", e["ts"] + 0.5, player=p, receiver=r)
            elif r and e.get("outcome") == "complete":
                say(e, "pass", e["ts"] + e.get("dur", 0.5), player=p, receiver=r)
        elif typ == "carry":
            length = abs(e.get("end_x", e["x"]) - e["x"]) + abs(e.get("end_y", e["y"]) - e["y"])
            if length > 10:
                say(e, "carry", e["ts"] + 0.3, player=p)
        elif typ == "shot":
            say(e, "shot", e["ts"] - 0.2, player=p)
            out_ = e.get("outcome")
            if out_ == "off_target":
                say(e, "off_target", e["ts"] + e.get("dur", 1.0), suffix="b")
            elif out_ == "goal":
                score[e["team"]] += 1
                say(e, "goal", e["ts"] + e.get("dur", 1.0), suffix="g", player=p)
        elif typ == "save":
            say(e, "saved", e["ts"], keeper=p)
        elif typ == "block":
            say(e, "blocked", e["ts"])
        elif typ == "tackle" and e.get("outcome") == "won":
            say(e, "tackle", e["ts"] + 0.2, player=p)
        elif typ == "interception":
            say(e, "interception", e["ts"] + 0.2, player=p)
        elif typ == "clearance":
            say(e, "clearance", e["ts"] + 0.2, player=p)
        elif typ == "foul":
            say(e, "foul", e["ts"] + 0.8, player=p, victim=name(e.get("victim")))
        elif typ == "card":
            red = e.get("outcome") in ("red", "second_yellow")
            say(e, "red" if red else "yellow", e["ts"] + 1.0, player=p)
        elif typ == "offside":
            say(e, "offside", e["ts"] + 0.5, player=p)
        elif typ == "substitution":
            say(e, "substitution", e["ts"] + 1.0, on=name(e.get("player_on")), off=name(e.get("player_off")))
        elif typ == "tactical_change":
            say(e, "tactics", e["ts"] + 1.0)
        elif typ == "period_end":
            say(e, "half_time" if e.get("period") == 1 else "full_time", e["ts"] + 0.8)
    out.sort(key=lambda x: x["ts"])
    return out
