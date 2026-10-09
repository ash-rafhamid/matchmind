"""Measure how well the tracking agrees with the events.

For every pass we check the passer is at the ball when it is struck and the
receiver is at the ball when it arrives; for every carry that the ball stays
at the dribbler's feet; and that nobody runs faster than a human can.
"""

from __future__ import annotations

import statistics
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from matchmind import store  # noqa: E402
from matchmind.engine.tracking import HZ, _pass_flight, build_tracking  # noqa: E402


def check(match_id: str) -> None:
    pkg = store.load(match_id)
    meta, events = pkg["meta"], pkg["events"]
    home, away = store.LEAGUE[meta["teams"]["home"]["id"]], store.LEAGUE[meta["teams"]["away"]["id"]]
    t0 = time.perf_counter()
    tr = build_tracking(events, home, away, meta["duration_s"], seed=meta["seed"])
    built = time.perf_counter() - t0
    col = {p: i for i, p in enumerate(tr.player_ids)}

    def gap(pid: str, t: float) -> float:
        f = min(tr.frames - 1, int(round(t * HZ)))
        p = tr.xy[f, col[pid]]
        return float(np.hypot(*(p - tr.ball[f])))

    strike, arrive, carry = [], [], []
    for e in events:
        if e["type"] == "pass" and "end_x" in e and e.get("player") in col:
            strike.append(gap(e["player"], e["ts"] + e["dur"] - _pass_flight(e)))
            if e.get("outcome") == "complete" and e.get("receiver") in col:
                arrive.append(gap(e["receiver"], e["ts"] + e["dur"]))
        elif e["type"] == "carry" and e.get("outcome") == "success" and e.get("player") in col:
            carry.append(gap(e["player"], e["ts"] + e["dur"] / 2))

    speed = np.linalg.norm(np.diff(tr.xy, axis=0), axis=2) * HZ
    valid = speed[~np.isnan(speed)]
    pct = lambda a, q: float(np.percentile(a, q))  # noqa: E731
    print(f"{match_id}: built in {built:.1f}s")
    for name, a in (("passer at strike", strike), ("receiver at arrival", arrive), ("dribbler mid-carry", carry)):
        a = np.array(a)
        print(f"  {name:<22} median {np.median(a):.2f} m | 95% {pct(a, 95):.2f} m | within 1.5 m: "
              f"{100 * np.mean(a < 1.5):.1f}%")
    print(f"  speed: 99th pct {pct(valid, 99):.1f} m/s | >10 m/s {100 * np.mean(valid > 10):.3f}% of frames | "
          f"max {valid.max():.1f} m/s")
    phys = [v for v in tr.physical().values() if v["minutes"] > 85]
    print("  full-match players: " + " | ".join(
        f"{k} {statistics.mean(v[k] for v in phys):.1f}" for k in ("distance_km", "top_speed_kmh", "sprints")))


if __name__ == "__main__":
    for mid in sys.argv[1:] or [m["id"] for m in store.list_matches()]:
        check(mid)
