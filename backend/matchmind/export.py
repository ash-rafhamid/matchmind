"""Downloadable dataset for one synthetic match, with a data card."""

from __future__ import annotations

import csv
import io
import json
import zipfile
from functools import lru_cache

import numpy as np

from . import store

EVENT_COLUMNS = ["id", "ts", "period", "minute", "clock", "team", "type", "player", "receiver", "x", "y", "end_x",
                 "end_y", "dur", "outcome", "pass_type", "set_piece", "situation", "body_part", "xg", "xt", "chain",
                 "related", "tags"]

DATA_CARD = """# MatchMind synthetic match - data card

Match: {title} (id `{id}`, seed {seed}) - final score {score}
Competition: {competition}. Every club, player and event is synthetic; free to use for any purpose.

## Files
| File | Content |
|---|---|
| `events.csv` / `events.json` | {n_events} events: passes, carries, shots, tackles, interceptions, pressures, fouls, cards, set pieces, substitutions, tactical changes |
| `tracking_10hz.npz` | 10 Hz positions: `xy` (frames x players x 2, int16 decimetres, -1 = not on the pitch), `ball` (frames x 2), `ball_z` (ball height, dm), `on_ball` (column of the player in control, -1 in flight), `player_ids`, `teams` |
| `tracking_2hz.csv` | The same tracking down-sampled to 2 Hz in metres, one row per frame |
| `meta.json` | Teams, tactical DNA, squads with attributes, lineups, period lengths |
| `analytics.json` | Team and player stats, momentum, xG timeline, pass networks, detected key moments |

## Conventions
- Pitch 105 x 68 m. Absolute frame: the home team attacks towards x = 105 for the whole match; y = 0 is the top
  touchline as drawn.
- `ts` is seconds of play since kick-off (both halves, no interval). `clock` is the broadcast clock (e.g. 45+2').
- `xg`: expected goals from a distance/angle logistic model with header, big-chance, counter and pressure terms.
- `xt`: expected-threat added by a pass or carry.
- `chain`: possession id. `related`: linked event (assist for a shot, foul for a card, shot for a save).
- `tags` include progressive, final_third_entry, key_pass, assist, big_chance, high_turnover, counter_start, header,
  set_piece, penalty.

## How it was generated
An event-level simulator walks the ball through the match; action probabilities depend on pitch location, opponent
pressure, both teams' tactical dials (press, tempo, directness, width, line height, counter) and player attributes.
A choreographer then plays the events out physically at 10 Hz: the carrier moves with the ball, passes are struck at
real speeds and aimed where the receiver will be, defenders press, intercept and tackle the real ball, and every player
runs with speed and acceleration limits. Event positions are rewritten from that motion, so events and tracking agree. Averages over 400 simulated matches are calibrated to top-flight football (per team:
~13.7 shots, 1.6 xG, 80% pass accuracy, 11 fouls, 5 corners; ~10-11 km and 27-32 km/h top speed per player).
"""


@lru_cache(maxsize=4)
def build_export(match_id: str) -> bytes:
    pkg = store.load(match_id)
    meta, events = pkg["meta"], pkg["events"]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("DATA_CARD.md", DATA_CARD.format(
            title=meta["title"], id=meta["id"], seed=meta["seed"], competition=meta["competition"],
            score=f"{meta['score']['home']}-{meta['score']['away']}", n_events=len(events)))
        for name in ("meta", "events", "analytics"):
            z.writestr(f"{name}.json", json.dumps(pkg[name], ensure_ascii=False))
        z.writestr("events.csv", _events_csv(events))
        folder = store.DATA_DIR / match_id
        if (folder / "tracking.npz").exists():
            z.write(folder / "tracking.npz", "tracking_10hz.npz")
            z.writestr("tracking_2hz.csv", _tracking_csv(match_id))
    return buf.getvalue()


def _events_csv(events: list[dict]) -> str:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(EVENT_COLUMNS)
    for e in events:
        w.writerow([";".join(e[c]) if c == "tags" else e.get(c, "") for c in EVENT_COLUMNS])
    return out.getvalue()


def _tracking_csv(match_id: str) -> str:
    tr = store.load_tracking(match_id)
    xy = tr["xy"][::5].astype(np.float32) / 10
    ball = tr["ball"][::5].astype(np.float32) / 10
    xy[xy < 0] = np.nan
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["ts", "ball_x", "ball_y"] + [f"{p}_{axis}" for p in tr["player_ids"] for axis in ("x", "y")])
    for f in range(ball.shape[0]):
        row = [f"{f * 0.5:.1f}", f"{ball[f, 0]:.1f}", f"{ball[f, 1]:.1f}"]
        row += ["" if np.isnan(v) else f"{v:.1f}" for v in xy[f].reshape(-1)]
        w.writerow(row)
    return out.getvalue()
