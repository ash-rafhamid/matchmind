"""How real does the motion look? Numbers for passes, carries, running and spacing."""

from __future__ import annotations

import copy
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from matchmind import store  # noqa: E402
from matchmind.engine.choreo import choreograph  # noqa: E402
from matchmind.engine.tracking import HZ  # noqa: E402


def check(match_id: str) -> None:
    pkg = store.load(match_id)
    meta = pkg["meta"]
    events = copy.deepcopy(pkg["events"])
    home, away = store.LEAGUE[meta["teams"]["home"]["id"]], store.LEAGUE[meta["teams"]["away"]["id"]]
    t0 = time.perf_counter()
    tr = choreograph(events, home, away, meta["duration_s"], seed=meta["seed"])
    took = time.perf_counter() - t0
    n = tr.frames
    # ball speed while in flight (owner -1 and moving)
    bv = np.hypot(*np.diff(tr.ball, axis=0).T) * HZ
    flying = (tr.on_ball[:-1] < 0) & (bv > 3)
    # receivers: distance from the ball when they take control
    take = np.nonzero((tr.on_ball[1:] >= 0) & (tr.on_ball[1:] != tr.on_ball[:-1]))[0] + 1
    gaps = [float(np.hypot(*(tr.xy[f, tr.on_ball[f]] - tr.ball[f]))) for f in take if not np.isnan(tr.xy[f, tr.on_ball[f]]).any()]
    # how long the player on the ball stands still
    sp = np.hypot(*np.diff(tr.xy, axis=0).transpose(2, 0, 1)) * HZ
    own = tr.on_ball[:-1]
    carrier_speed = np.array([sp[f, own[f]] for f in range(n - 1) if own[f] >= 0 and not np.isnan(sp[f, own[f]])])
    # spacing between players on the pitch
    close = 0
    total = 0
    for f in range(0, n, 50):
        q = tr.xy[f][~np.isnan(tr.xy[f, :, 0])]
        d = np.hypot(*(q[:, None] - q[None]).transpose(2, 0, 1))
        close += int(((d < 0.8) & (d > 0)).sum() // 2)
        total += len(q)
    allsp = sp[~np.isnan(sp)]
    print(f"{match_id}: {took:.1f}s")
    print(f"  ball in flight: median {np.median(bv[flying]):.1f} m/s, 90% {np.percentile(bv[flying], 90):.1f} m/s")
    print(f"  receiver/winner to ball when taking control: median {np.median(gaps):.2f} m, 95% {np.percentile(gaps, 95):.2f} m")
    print(f"  player on the ball standing still (<0.5 m/s): {100 * np.mean(carrier_speed < 0.5):.0f}% of the time, median speed {np.median(carrier_speed):.1f} m/s")
    print(f"  all players: walking/standing {100 * np.mean(allsp < 2):.0f}% | jogging {100 * np.mean((allsp >= 2) & (allsp < 5.5)):.0f}% | running/sprinting {100 * np.mean(allsp >= 5.5):.0f}% | >10 m/s {100 * np.mean(allsp > 10):.2f}%")
    print(f"  players overlapping (<0.8 m apart): {close} pairs in {n // 50} sampled frames")
    phys = [v for v in tr.physical().values() if v["minutes"] > 85]
    print("  per player: " + " | ".join(f"{k} {np.mean([v[k] for v in phys]):.1f}" for k in ("distance_km", "top_speed_kmh", "sprints")))


if __name__ == "__main__":
    for mid in sys.argv[1:] or ["red-iro-189"]:
        check(mid)
