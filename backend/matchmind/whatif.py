"""Counterfactual simulation: "what if this team had changed X at minute M?"

The match is replayed deterministically to minute M, then forked many times.
Each fork plays the rest of the match twice - once as it was, once with the
tactical change - using the *same* random stream for both (common random
numbers), so the difference reflects the tactics rather than luck.
"""

from __future__ import annotations

import math
import statistics
import time
from collections import Counter

from .engine.formations import FORMATIONS
from .engine.sim import MatchSimulator, TacticalChange
from .store import LEAGUE

DIALS = ("press", "tempo", "directness", "width", "line_height", "counter")


def _points(mine: int, theirs: int) -> int:
    return 3 if mine > theirs else 1 if mine == theirs else 0


def validate_changes(changes: dict) -> dict:
    clean: dict = {}
    for k, v in changes.items():
        if k in DIALS:
            clean[k] = max(0.0, min(1.0, float(v)))
        elif k == "formation":
            if v not in FORMATIONS:
                raise ValueError(f"unknown formation {v}; choose from {sorted(FORMATIONS)}")
            clean[k] = v
        else:
            raise ValueError(f"unknown tactical setting {k}; choose from {DIALS + ('formation',)}")
    if not clean:
        raise ValueError("no tactical change given")
    return clean


def run_what_if(meta: dict, side: str, from_minute: float, changes: dict, runs: int = 200) -> dict:
    t0 = time.perf_counter()
    changes = validate_changes(changes)
    home, away = meta["teams"]["home"]["id"], meta["teams"]["away"]["id"]
    script = [TacticalChange(**c) for c in meta.get("script", [])]
    base = MatchSimulator(LEAGUE[home], LEAGUE[away], seed=meta["seed"], script=script)
    base.run(until_minute=from_minute)
    if base.finished:
        raise ValueError("that minute is after the final whistle")
    other = "away" if side == "home" else "home"
    score_now = {"home": base.sides["home"].goals, "away": base.sides["away"].goals}
    dna_now = {k: getattr(base.sides[side].dna, k) for k in DIALS} | {"formation": base.sides[side].dna.formation}
    # Both variants: the changing side's coach sticks to the plan being tested.
    base.sides[side].coach_mode = "locked"

    results: dict[str, list[tuple[int, int, float, float]]] = {"as_played": [], "with_change": []}
    for i in range(runs):
        for variant in results:
            sim = base.fork(seed=50_000 + i)
            if variant == "with_change":
                sim._apply_tactics(side, changes, "what-if", source="what-if")
            x0 = (sim.sides[side].xg, sim.sides[other].xg)
            sim.run()
            results[variant].append((
                sim.sides[side].goals, sim.sides[other].goals,
                sim.sides[side].xg - x0[0], sim.sides[other].xg - x0[1],
            ))

    summary = {v: _summarise(rows) for v, rows in results.items()}
    paired = [_points(a[0], a[1]) - _points(b[0], b[1]) for a, b in zip(results["with_change"], results["as_played"])]
    mean = statistics.mean(paired)
    se = statistics.pstdev(paired) / math.sqrt(len(paired)) if len(paired) > 1 else 0.0
    return {
        "team": meta["teams"][side]["name"],
        "side": side,
        "from_minute": from_minute,
        "score_at_minute": {meta["teams"]["home"]["name"]: score_now["home"],
                            meta["teams"]["away"]["name"]: score_now["away"]},
        "tactics_before": {k: (round(v, 2) if isinstance(v, float) else v) for k, v in dna_now.items()},
        "tactics_tested": changes,
        "runs": runs,
        "as_played": summary["as_played"],
        "with_change": summary["with_change"],
        "expected_points_delta": round(mean, 2),
        "expected_points_delta_95ci": [round(mean - 1.96 * se, 2), round(mean + 1.96 * se, 2)],
        "verdict": _verdict(mean, se),
        "method": "paired Monte Carlo with common random numbers",
        "seconds": round(time.perf_counter() - t0, 1),
    }


def _summarise(rows: list[tuple[int, int, float, float]]) -> dict:
    n = len(rows)
    wins = sum(a > b for a, b, *_ in rows)
    draws = sum(a == b for a, b, *_ in rows)
    finals = Counter(f"{a}-{b}" for a, b, *_ in rows).most_common(4)
    return {
        "win_pct": round(100 * wins / n, 1),
        "draw_pct": round(100 * draws / n, 1),
        "loss_pct": round(100 * (n - wins - draws) / n, 1),
        "expected_points": round(statistics.mean(_points(a, b) for a, b, *_ in rows), 2),
        "xg_for_rest_of_match": round(statistics.mean(r[2] for r in rows), 2),
        "xg_against_rest_of_match": round(statistics.mean(r[3] for r in rows), 2),
        "most_likely_finals": [{"score": s, "pct": round(100 * c / n, 1)} for s, c in finals],
    }


def _verdict(mean: float, se: float) -> str:
    if abs(mean) < 1.96 * se or abs(mean) < 0.05:
        return "no clear effect"
    return "helps" if mean > 0 else "hurts"
