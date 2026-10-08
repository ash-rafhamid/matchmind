"""Simulate many matches and compare headline stats with real top-flight averages."""

from __future__ import annotations

import itertools
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from matchmind.engine.league import build_league  # noqa: E402
from matchmind.engine.sim import MatchSimulator  # noqa: E402

REAL = {
    "passes": "~450-550", "pass_pct": "~80-86%", "shots": "~12-13", "on_target": "~4.5",
    "xg": "~1.3-1.5", "goals": "~1.4", "fouls": "~10-11", "yellows": "~1.8", "corners": "~5",
    "offsides": "~2", "minutes": "~96-98",
}


def main(n: int = 200) -> None:
    league = build_league()
    pairs = list(itertools.permutations(league.values(), 2))
    per_team: dict[str, list[float]] = {k: [] for k in REAL}
    t0 = time.perf_counter()
    for i in range(n):
        home, away = pairs[i % len(pairs)]
        sim = MatchSimulator(home, away, seed=1000 + i).run()
        ev = sim.events
        for side in ("home", "away"):
            mine = [e for e in ev if e["team"] == side]
            passes = [e for e in mine if e["type"] == "pass"]
            shots = [e for e in mine if e["type"] == "shot"]
            cards = Counter(e.get("outcome") for e in mine if e["type"] == "card")
            per_team["passes"].append(len(passes))
            per_team["pass_pct"].append(100 * sum(e["outcome"] == "complete" for e in passes) / max(1, len(passes)))
            per_team["shots"].append(len(shots))
            per_team["on_target"].append(sum(e["outcome"] in ("goal", "saved") for e in shots))
            per_team["xg"].append(sum(e["xg"] for e in shots))
            per_team["goals"].append(sum(e["outcome"] == "goal" for e in shots))
            per_team["fouls"].append(sum(e["type"] == "foul" for e in mine))
            per_team["yellows"].append(cards["yellow"] + cards["second_yellow"])
            per_team["corners"].append(sum(e.get("set_piece") == "corner" for e in passes))
            per_team["offsides"].append(sum(e["type"] == "offside" for e in mine))
        per_team["minutes"].append((sim.period_len[1] + sim.period_len[2]) / 60)
    dt = time.perf_counter() - t0
    print(f"{n} matches in {dt:.1f}s ({1000 * dt / n:.0f} ms/match)\n")
    print(f"{'stat (per team)':<16}{'sim mean':>10}{'sd':>8}   real")
    for k, vals in per_team.items():
        print(f"{k:<16}{statistics.mean(vals):>10.2f}{statistics.pstdev(vals):>8.2f}   {REAL[k]}")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 200)
