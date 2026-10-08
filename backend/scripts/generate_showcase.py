"""Pick the most watchable seed for each featured fixture and save full packages.

Event-only simulation is fast (~40 ms), so we scan hundreds of seeds per
fixture, rank them by drama, then build tracking + analytics for the winners.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from matchmind import store  # noqa: E402

FIXTURES = [
    ("RED", "IRO", "Press vs. block", "Redmond's relentless high press meets Ironvale's deep block and lightning counters."),
    ("HAR", "SEA", "Possession vs. intensity", "Harbour City's patient passing tested by Seabrook's aggressive 3-4-3."),
    ("KIN", "WES", "Wings vs. long balls", "Kingsmoor's wide crossing game against Westport's direct route one."),
]
# Seeds picked by a 400-seed drama search; `--fixed` rebuilds exactly these (used in the Docker build).
PICKED = {("RED", "IRO"): 189, ("HAR", "SEA"): 91, ("KIN", "WES"): 133}


def best_seed(home: str, away: str, tries: int) -> tuple[int, float]:
    best = (0, -1.0)
    for seed in range(tries):
        sim = store.simulate(home, away, seed)
        total = sim.sides["home"].goals + sim.sides["away"].goals
        if not 2 <= total <= 6:
            continue
        d = store.drama_score(sim.events)
        if d > best[1]:
            best = (seed, d)
    return best


def main(tries: int = 400, fixed: bool = False) -> None:
    for home, away, tag, blurb in FIXTURES:
        t0 = time.perf_counter()
        if fixed:
            seed = PICKED[(home, away)]
            drama = store.drama_score(store.simulate(home, away, seed).events)
        else:
            seed, drama = best_seed(home, away, tries)
        pkg = store.generate(home, away, seed)
        meta = pkg["meta"]
        meta.update(featured=True, tag=tag, blurb=blurb, drama=drama)
        (store.DATA_DIR / meta["id"] / "meta.json").write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")
        moments = pkg["analytics"]["moments"]
        print(f"{meta['title']}: seed {seed} drama {drama} score {meta['score']} "
              f"moments {len(moments)} ({time.perf_counter() - t0:.1f}s)")
        for m in moments:
            print(f"   {m['clock']:>7} {m['type']:<15} {m['title']}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--fixed"]
    main(int(args[0]) if args else 400, fixed="--fixed" in sys.argv)
