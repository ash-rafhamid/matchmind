"""10 Hz player and ball tracking reconstructed from the event stream.

The ball follows the event keyframes. Every player chases a target from the
team-shape model (in or out of possession, shifted by the ball), the event
actor is pinned to the ball, receivers run onto passes and the nearest
defenders press. Velocities are limited by each player's pace and a maximum
acceleration, so speeds and distances behave like real tracking data.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .formations import FORMATIONS, shape_target
from .league import Team
from .pitch import PITCH_LENGTH, PITCH_WIDTH, flip

HZ = 10
DT = 1.0 / HZ
BALL_EVENTS = {"pass", "carry", "shot", "clearance"}
REGAIN_EVENTS = {"interception", "tackle", "save", "block", "clearance"}


@dataclass
class Tracking:
    """Positions in the absolute frame. NaN = player not on the pitch."""

    player_ids: list[str]
    teams: list[str]  # "home"/"away" per player column
    xy: np.ndarray  # (frames, players, 2) float32
    ball: np.ndarray  # (frames, 2) float32
    on_ball: np.ndarray  # (frames,) int32 column of the player controlling the ball, -1 if none
    vmax: np.ndarray  # (players,) top running speed in m/s

    @property
    def frames(self) -> int:
        return self.ball.shape[0]

    def physical(self) -> dict[str, dict[str, float]]:
        """Distance covered, top speed and sprint counts per player."""
        out: dict[str, dict[str, float]] = {}
        step = np.linalg.norm(np.diff(self.xy, axis=0), axis=2)  # (frames-1, players)
        step = np.minimum(step, self.vmax[None, :] / HZ)  # catch-up bursts are capped at running speed
        speed = step * HZ
        for j, pid in enumerate(self.player_ids):
            s = speed[:, j]
            valid = ~np.isnan(s)
            if not valid.any():
                continue
            # frames where the player is gathering the ball are not counted as sprinting
            sv = np.where(valid & (self.on_ball[1:] != j), s, 0.0)
            # smooth over 1 s before counting sprints so jitter is not a sprint
            smooth = np.convolve(sv, np.ones(HZ) / HZ, mode="same")
            starts = _count_efforts(smooth, start_above=7.0, end_below=5.5, min_frames=HZ)
            out[pid] = {
                "distance_km": round(float(np.sum(step[:, j][valid])) / 1000, 2),
                "top_speed_kmh": round(float(np.max(smooth)) * 3.6, 1),
                "sprints": starts,
                "high_intensity_m": round(float(np.sum(step[:, j][valid & (smooth > 5.5)])), 0),
                "minutes": round(float(valid.sum()) / HZ / 60, 1),
            }
        return out


def _ball_keyframes(events: list[dict]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    t, x, y = [], [], []
    for e in events:
        if e["type"] in ("period_start", "period_end", "tactical_change", "substitution", "card", "goal",
                         "offside", "pressure", "foul"):
            continue
        t.append(e["ts"])
        x.append(e["x"])
        y.append(e["y"])
        if e["type"] in BALL_EVENTS and "end_x" in e:
            t.append(e["ts"] + max(e["dur"], 0.2))
            x.append(e["end_x"])
            y.append(e["end_y"])
    order = np.argsort(np.array(t), kind="stable")
    return np.array(t)[order], np.array(x)[order], np.array(y)[order]


def build_tracking(events: list[dict], home: Team, away: Team, end_ts: float, seed: int = 0) -> Tracking:
    rng = np.random.default_rng(seed)
    teams = {"home": home, "away": away}
    ids: list[str] = []
    sides: list[str] = []
    pace: list[float] = []
    for side, team in teams.items():
        for p in team.players:
            ids.append(p.id)
            sides.append(side)
            pace.append(p.pace)
    col = {pid: i for i, pid in enumerate(ids)}
    n_frames = int(end_ts * HZ) + 1
    n = len(ids)

    # Slot assignment per side, updated by substitutions, red cards and formation changes.
    slots: dict[str, dict[str, tuple[str, float, float]]] = {}
    dna = {side: {"width": t.dna.width, "line_height": t.dna.line_height} for side, t in teams.items()}
    for side, team in teams.items():
        layout = FORMATIONS[team.dna.formation]
        slots[side] = {p.id: (role, bx, by) for p, (role, bx, by) in zip(team.starters, layout)}

    tk, bxk, byk = _ball_keyframes(events)
    frame_t = np.arange(n_frames) * DT
    ball = np.stack([np.interp(frame_t, tk, bxk), np.interp(frame_t, tk, byk)], axis=1).astype(np.float32)

    # Per-frame possession and the player pinned to the ball.
    poss = np.empty(n_frames, dtype=object)
    poss[:] = "home"
    actor = np.full(n_frames, -1, dtype=np.int32)
    run_to = {}  # frame index -> (player col, x, y) for receivers running onto passes
    timeline = sorted(events, key=lambda e: e["ts"])
    current = "home"
    for i, e in enumerate(timeline):
        nxt = timeline[i + 1]["ts"] if i + 1 < len(timeline) else end_ts
        f0 = int(e["ts"] * HZ)
        f1 = min(int(nxt * HZ) + 1, n_frames)
        if e["type"] in BALL_EVENTS or e["type"] in REGAIN_EVENTS:
            current = e["team"]
        poss[f0:f1] = current
        if e.get("player") in col and e["type"] in BALL_EVENTS | {"interception", "tackle", "save"}:
            fa = min(int((e["ts"] + max(e.get("dur", 0), 0.3)) * HZ), n_frames)
            actor[f0:fa] = col[e["player"]]
        if e["type"] == "pass" and e.get("receiver") in col and e.get("outcome") == "complete":
            fe = min(int((e["ts"] + e["dur"]) * HZ), n_frames - 1)
            for f in range(f0, fe + 1):
                run_to[f] = (col[e["receiver"]], e["end_x"], e["end_y"])
            actor[fe:f1] = col[e["receiver"]]

    changes = sorted((e for e in events if e["type"] in ("substitution", "card", "tactical_change")),
                     key=lambda e: e["ts"])
    ci = 0

    xy = np.full((n_frames, n, 2), np.nan, dtype=np.float32)
    pos = np.full((n, 2), np.nan)
    vel = np.zeros((n, 2))
    vmax = 6.2 + 3.2 * np.array(pace) / 100
    jitter = np.zeros((n, 2))
    seen = np.array(ball[0], dtype=float)  # where players *think* the ball is: a lagged copy

    for f in range(n_frames):
        t = f * DT
        while ci < len(changes) and changes[ci]["ts"] <= t:
            _apply_change(changes[ci], slots, dna, col, pos)
            ci += 1
        bx, by = float(ball[f, 0]), float(ball[f, 1])
        seen += (ball[f] - seen) * (DT / 1.3)
        sx_b, sy_b = float(seen[0]), float(seen[1])
        if f % 30 == 0:
            jitter = rng.normal(0, 1.0, size=(n, 2))
        targets = np.full((n, 2), np.nan)
        for side in ("home", "away"):
            is_home = side == "home"
            fx, fy = (sx_b, sy_b) if is_home else flip(sx_b, sy_b)
            in_poss = poss[f] == side
            for pid, (role, sx, sy) in slots[side].items():
                tx, ty = shape_target(sx, sy, role, fx, fy, in_poss, dna[side]["width"], dna[side]["line_height"])
                if not is_home:
                    tx, ty = flip(tx, ty)
                targets[col[pid]] = (tx, ty)
            if not in_poss:
                # nearest one or two defenders step out to press the ball
                members = [col[pid] for pid, s in slots[side].items() if s[0] != "GK"]
                d = np.hypot(targets[members, 0] - sx_b, targets[members, 1] - sy_b)
                order = np.argsort(d)
                for rank, k in enumerate(order[:2]):
                    j = members[k]
                    toward = 0.65 if rank == 0 else 0.3
                    targets[j] = targets[j] + (seen - targets[j]) * toward

        if f in run_to:
            j, ex, ey = run_to[f]
            if not np.isnan(targets[j, 0]):
                targets[j] = (ex, ey)

        active = ~np.isnan(targets[:, 0])
        targets[active] += jitter[active]
        gain = np.full(n, 0.55)
        cap = vmax.copy()
        a = actor[f]
        if a >= 0 and active[a]:
            # The player on the ball chases it hard (catch-up bursts are filtered out of physical stats).
            targets[a] = (bx, by)
            gain[a] = 3.0
            cap[a] = vmax[a] * 1.5
        new = active & np.isnan(pos[:, 0])
        pos[new] = targets[new]
        vel[~active] = 0
        pos[~active] = np.nan

        desired = (targets - pos) * gain[:, None]
        speed = np.linalg.norm(desired, axis=1, keepdims=True)
        desired = np.where(speed > cap[:, None], desired / np.maximum(speed, 1e-9) * cap[:, None], desired)
        dv = desired - vel
        dvn = np.linalg.norm(dv, axis=1, keepdims=True)
        dv = np.where(dvn > 3.5 * DT, dv / np.maximum(dvn, 1e-9) * 3.5 * DT, dv)
        vel[active] += dv[active]
        pos[active] += vel[active] * DT

        np.clip(pos[:, 0], 0, PITCH_LENGTH, out=pos[:, 0])
        np.clip(pos[:, 1], 0, PITCH_WIDTH, out=pos[:, 1])
        xy[f] = pos

    return Tracking(ids, sides, xy, ball, actor, vmax.astype(np.float32))


def _apply_change(e: dict, slots: dict, dna: dict, col: dict, pos: np.ndarray) -> None:
    side = e["team"]
    if e["type"] == "substitution":
        off, on = e["player_off"], e["player_on"]
        if off in slots[side]:
            slots[side][on] = slots[side].pop(off)
            pos[col[off]] = np.nan
    elif e["type"] == "card" and e.get("outcome") in ("red", "second_yellow"):
        if e["player"] in slots[side]:
            slots[side].pop(e["player"])
            pos[col[e["player"]]] = np.nan
    elif e["type"] == "tactical_change":
        ch = e.get("changes", {})
        for k in ("width", "line_height"):
            if k in ch:
                dna[side][k] = ch[k]
        if "formation" in ch and e.get("roles"):
            by_role = {slot[0]: slot for slot in FORMATIONS[ch["formation"]]}
            slots[side] = {pid: by_role[role] for pid, role in e["roles"].items()}


def _count_efforts(speed: np.ndarray, start_above: float, end_below: float, min_frames: int) -> int:
    """Sprint efforts with hysteresis: starts above one speed, ends below a lower one, lasts >= min_frames."""
    count = 0
    run = 0
    active = False
    for v in speed:
        if not active and v > start_above:
            active, run = True, 0
        if active:
            run += 1
            if v < end_below:
                count += run >= min_frames
                active = False
    return count + (active and run >= min_frames)
