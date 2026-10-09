"""10 Hz player and ball tracking, anchored to the event stream.

Every action pins someone in space and time: the passer stands at the ball
when it is played, the receiver is where the ball arrives, the dribbler keeps
it at their feet, tacklers and interceptors are exactly where they win it,
pressers close down the ball. Between anchors each player follows the team
shape (in/out of possession, shifted by the ball, zero-phase smoothed) and
blends into the next anchor with a smoothstep correction, so motion is
continuous and the ball and players always agree.

The ball itself is held, struck and decelerates in flight; long balls,
crosses and clearances get a height profile.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .formations import FORMATIONS, role_group
from .league import Team
from .pitch import GOAL_Y, PITCH_LENGTH, PITCH_WIDTH

HZ = 10
DT = 1.0 / HZ
BLEND_S = 3.0  # how long a player takes to fold back into the team shape around an anchor
FEET = 0.6  # metres between a player's centre and the ball at their feet
CATCH_UP = 4.5  # m/s: typical speed used to close the gap between team shape and an anchor
BALL_EVENTS = {"pass", "carry", "shot", "clearance", "interception", "tackle", "save", "block"}
LOFTED = {"long", "cross", "clearance"}


@dataclass
class Tracking:
    """Positions in the absolute frame (home attacks +x). NaN = player not on the pitch."""

    player_ids: list[str]
    teams: list[str]  # "home"/"away" per player column
    xy: np.ndarray  # (frames, players, 2) float32
    ball: np.ndarray  # (frames, 2) float32
    ball_z: np.ndarray  # (frames,) float32, metres above the ground
    on_ball: np.ndarray  # (frames,) int32 column of the player controlling the ball, -1 if none
    vmax: np.ndarray  # (players,) top running speed in m/s

    @property
    def frames(self) -> int:
        return self.ball.shape[0]

    def physical(self) -> dict[str, dict[str, float]]:
        """Distance covered, top speed and sprint counts per player."""
        out: dict[str, dict[str, float]] = {}
        step = np.linalg.norm(np.diff(self.xy, axis=0), axis=2)  # (frames-1, players)
        step = np.minimum(step, self.vmax[None, :] / HZ)
        speed = step * HZ
        for j, pid in enumerate(self.player_ids):
            s = speed[:, j]
            valid = ~np.isnan(s)
            if not valid.any():
                continue
            sv = np.where(valid, s, 0.0)
            smooth = np.convolve(sv, np.ones(HZ) / HZ, mode="same")
            out[pid] = {
                "distance_km": round(float(np.sum(step[:, j][valid])) / 1000, 2),
                "top_speed_kmh": round(float(np.max(smooth)) * 3.6, 1),
                "sprints": _count_efforts(smooth, start_above=7.0, end_below=5.5, min_frames=HZ),
                "high_intensity_m": round(float(np.sum(step[:, j][valid & (smooth > 5.5)])), 0),
                "minutes": round(float(valid.sum()) / HZ / 60, 1),
            }
        return out


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


# ----------------------------------------------------------------- the ball

def _flight_seconds(length: float) -> float:
    return length / float(np.clip(12.0 + 0.32 * length, 10.0, 27.0))


def _pass_flight(e: dict) -> float:
    if e["type"] == "shot":
        return max(e["dur"] - 0.25, 0.3)
    length = float(np.hypot(e["end_x"] - e["x"], e["end_y"] - e["y"]))
    return min(max(e["dur"] - 0.15, 0.2), _flight_seconds(length))


def _ball_path(events: list[dict], n: int, col: dict[str, int]):
    """Ball keyframes (x, y, height) and who controls it, frame by frame."""
    kt: list[float] = []
    kx: list[float] = []
    ky: list[float] = []
    kz: list[float] = []
    owner = np.full(n, -1, dtype=np.int32)
    holds: list[tuple[float, float, int]] = []  # (from, to, player column) control intervals
    flights: list[tuple[float, float]] = []

    def key(t: float, x: float, y: float, z: float = 0.0) -> None:
        if kt and t <= kt[-1]:
            t = kt[-1] + 1e-3
        kt.append(t)
        kx.append(x)
        ky.append(y)
        kz.append(z)

    ball_events = [e for e in events if e["type"] in BALL_EVENTS]

    def held_until(i: int, holder: str | None, start: float) -> float:
        """A player keeps the ball until their own next action; otherwise only briefly (ball goes dead)."""
        if i + 1 < len(ball_events) and ball_events[i + 1].get("player") == holder:
            return ball_events[i + 1]["ts"]
        return start + 0.8

    for i, e in enumerate(ball_events):
        ts, x, y, dur = e["ts"], e["x"], e["y"], max(e.get("dur", 0.0), 0.0)
        pid = col.get(e.get("player") or "")
        t = e["type"]
        if t in ("pass", "clearance") and "end_x" in e:
            ex, ey = e["end_x"], e["end_y"]
            length = float(np.hypot(ex - x, ey - y))
            flight = _pass_flight(e)
            release = ts + max(0.0, dur - flight)
            lofted = e.get("pass_type") in LOFTED or t == "clearance" or (
                e.get("set_piece") in ("goal_kick", "corner") and length > 25)
            peak = min(14.0, 0.16 * length) if lofted else min(0.6, 0.02 * length)
            key(ts, x, y)
            key(release, x, y)
            for s in np.linspace(0.1, 1.0, 10):
                u = 1 - (1 - s) ** 1.6  # the ball slows down as it travels
                key(release + flight * s, x + (ex - x) * u, y + (ey - y) * u, peak * 4 * s * (1 - s))
            flights.append((release, ts + dur))
            if pid is not None:
                holds.append((ts, release, pid))
            rid = col.get(e.get("receiver") or "")
            if e.get("outcome") == "complete" and rid is not None:
                holds.append((ts + dur, held_until(i, e.get("receiver"), ts + dur), rid))
        elif t == "carry" and "end_x" in e:
            key(ts, x, y)
            key(ts + dur, e["end_x"], e["end_y"])
            if pid is not None:
                end = held_until(i, e.get("player"), ts + dur) if e.get("outcome") == "success" else ts + dur
                holds.append((ts, end, pid))
        elif t == "shot":
            ex, ey = e.get("end_x", PITCH_LENGTH), e.get("end_y", GOAL_Y)
            flight = _pass_flight(e)
            key(ts, x, y)
            key(ts + 0.25, x, y)
            for s in np.linspace(0.2, 1.0, 5):
                key(ts + 0.25 + flight * s, x + (ex - x) * s, y + (ey - y) * s,
                    (1.2 if e.get("body_part") != "head" else 0.4) * 4 * s * (1 - s))
            flights.append((ts + 0.25, ts + 0.25 + flight))
            if pid is not None:
                holds.append((ts, ts + 0.25, pid))
        else:  # interception, tackle, save, block: the ball is where the defender wins it
            key(ts, x, y)
            if pid is not None and t != "block":
                holds.append((ts, held_until(i, e.get("player"), ts), pid))

    frame_t = np.arange(n) * DT
    bx = np.interp(frame_t, kt, kx)
    by = np.interp(frame_t, kt, ky)
    bz = np.interp(frame_t, kt, kz)
    for t0, t1, pid in holds:
        owner[int(round(t0 * HZ)):min(n, int(round(t1 * HZ)) + 1)] = pid
    for t0, t1 in flights:  # in flight nobody owns it
        f0, f1 = int(round(t0 * HZ)) + 1, int(round(t1 * HZ))
        owner[f0:max(f0, f1)] = -1
    return bx, by, bz, owner, holds


# ----------------------------------------------------------- team shape

def _shape(base_x: float, base_y: float, role: str, ball_x: np.ndarray, ball_y: np.ndarray, in_poss: np.ndarray,
           width: float, line: float) -> tuple[np.ndarray, np.ndarray]:
    """Vectorised version of formations.shape_target over many frames (own attacking frame)."""
    if role == "GK":
        x = 5.0 + (ball_x - PITCH_LENGTH / 2) * 0.12 + line * 6
        y = GOAL_Y + (ball_y - GOAL_Y) * 0.15
        return np.clip(x, 2.0, 22.0), np.clip(y, 26.0, 42.0)
    group = role_group(role)
    cap = 91.0 if group == "ATT" else 86.0 if group == "MID" else 70.0
    xp = np.minimum(base_x + (ball_x - PITCH_LENGTH / 2) * 0.55 + (line - 0.5) * 8, cap)
    yp = GOAL_Y + (base_y - GOAL_Y) * (0.85 + 0.35 * width) + (ball_y - GOAL_Y) * 0.22
    xd = base_x * 0.82 + (ball_x - PITCH_LENGTH / 2) * 0.5 + (line - 0.5) * 12 - 4
    yd = GOAL_Y + (base_y - GOAL_Y) * 0.68 + (ball_y - GOAL_Y) * 0.35
    x = np.where(in_poss, xp, xd)
    y = np.where(in_poss, yp, yd)
    return np.clip(x, 3.0, PITCH_LENGTH - 3.0), np.clip(y, 2.0, PITCH_WIDTH - 2.0)


def _smooth(a: np.ndarray, sigma_frames: float) -> np.ndarray:
    """Zero-phase Gaussian smoothing that ignores NaNs (players off the pitch)."""
    r = int(3 * sigma_frames)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma_frames) ** 2)
    valid = ~np.isnan(a)
    num = np.convolve(np.where(valid, a, 0.0), k, mode="same")
    den = np.convolve(valid.astype(float), k, mode="same")
    out = np.where(den > 1e-6, num / np.maximum(den, 1e-6), np.nan)
    out[~valid] = np.nan
    return out


def _smoothstep(u: np.ndarray) -> np.ndarray:
    u = np.clip(u, 0.0, 1.0)
    return u * u * (3 - 2 * u)


def _apply_anchors(path: np.ndarray, anchors: list[tuple[float, float, float]], n: int) -> np.ndarray:
    """Bend a smooth shape path so it passes exactly through each anchor (t, x, y)."""
    if not anchors:
        return path
    merged: list[tuple[float, float, float]] = []
    for a in sorted(anchors):  # several anchors within one frame -> keep the last
        if merged and a[0] - merged[-1][0] < DT:
            merged[-1] = a
        else:
            merged.append(a)
    t_frames = np.arange(n) * DT
    corr = np.zeros((n, 2))
    fr = [min(n - 1, int(round(t * HZ))) for t, _, _ in merged]
    offs = []
    for (_, x, y), f in zip(merged, fr):
        base = path[f]
        offs.append(np.array([x, y]) - base if not np.isnan(base).any() else np.zeros(2))

    first, last = fr[0], fr[-1]
    lead0 = max(0, first - int(max(BLEND_S, float(np.linalg.norm(offs[0])) / CATCH_UP) * HZ))
    span = max(t_frames[first] - t_frames[lead0], DT)
    corr[lead0:first + 1] = offs[0] * _smoothstep((t_frames[lead0:first + 1] - t_frames[lead0]) / span)[:, None]
    for k in range(len(fr) - 1):
        a, b = fr[k], fr[k + 1]
        if b <= a:
            continue
        L = (b - a) * DT
        seg = t_frames[a:b + 1] - t_frames[a]
        ramp_out = max(BLEND_S, float(np.linalg.norm(offs[k])) / CATCH_UP)
        ramp_in = max(BLEND_S, float(np.linalg.norm(offs[k + 1])) / CATCH_UP)
        if ramp_out + ramp_in >= L:
            u = _smoothstep(seg / L)
            corr[a:b + 1] = offs[k] * (1 - u)[:, None] + offs[k + 1] * u[:, None]
        else:
            leave = 1 - _smoothstep(seg / ramp_out)
            arrive = _smoothstep((seg - (L - ramp_in)) / ramp_in)
            corr[a:b + 1] = offs[k] * leave[:, None] + offs[k + 1] * arrive[:, None]
    ramp = max(BLEND_S, float(np.linalg.norm(offs[-1])) / CATCH_UP)
    tail = min(n, last + int(ramp * HZ) + 1)
    corr[last:tail] = offs[-1] * (1 - _smoothstep((t_frames[last:tail] - t_frames[last]) / ramp))[:, None]
    return path + corr


# ------------------------------------------------------------- main entry

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
    side_of = dict(zip(ids, sides))
    n = int(end_ts * HZ) + 1
    P = len(ids)
    events = sorted(events, key=lambda e: e["ts"])

    bx, by, bz, owner, holds = _ball_path(events, n, col)

    # Possession per frame: the team of whoever last touched the ball.
    poss_home = np.ones(n, dtype=bool)
    current, last_f = True, 0
    for e in events:
        if e["type"] in BALL_EVENTS:
            f = min(n, int(round(e["ts"] * HZ)))
            poss_home[last_f:f] = current
            current, last_f = e["team"] == "home", f
    poss_home[last_f:] = current

    # Before each kick-off everybody returns to their own half.
    own_half = np.zeros(n, dtype=bool)
    prev_end = 0.0
    for e in events:
        if e["type"] in BALL_EVENTS:
            if e.get("set_piece") == "kickoff":
                own_half[int(prev_end * HZ):int(round(e["ts"] * HZ)) + 1] = True
            prev_end = e["ts"] + e.get("dur", 0.0)

    # Lineup segments: who plays in which slot, with which width / line height, over time.
    slots = {s: {p.id: slot for p, slot in zip(t.starters, FORMATIONS[t.dna.formation])} for s, t in teams.items()}
    dna = {s: {"width": t.dna.width, "line_height": t.dna.line_height} for s, t in teams.items()}
    anchors: dict[int, list[tuple[float, float, float]]] = {j: [] for j in range(P)}
    changes = [e for e in events if e["type"] in ("substitution", "card", "tactical_change")]
    cuts = [0.0] + [e["ts"] for e in changes] + [n * DT]
    targets = np.full((n, P, 2), np.nan)
    for seg in range(len(cuts) - 1):
        if seg > 0:
            _apply_change(changes[seg - 1], slots, dna, anchors, col)
        f0, f1 = int(round(cuts[seg] * HZ)), min(n, int(round(cuts[seg + 1] * HZ)))
        if f1 <= f0:
            continue
        for side in ("home", "away"):
            is_home = side == "home"
            ball_x = bx[f0:f1] if is_home else PITCH_LENGTH - bx[f0:f1]
            ball_y = by[f0:f1] if is_home else PITCH_WIDTH - by[f0:f1]
            in_poss = poss_home[f0:f1] if is_home else ~poss_home[f0:f1]
            for pid, (role, sx, sy) in slots[side].items():
                x, y = _shape(sx, sy, role, ball_x, ball_y, in_poss, dna[side]["width"], dna[side]["line_height"])
                if role != "GK":
                    x = np.where(own_half[f0:f1], np.minimum(x, PITCH_LENGTH / 2 - 1.0), x)
                if not is_home:
                    x, y = PITCH_LENGTH - x, PITCH_WIDTH - y
                targets[f0:f1, col[pid], 0] = x
                targets[f0:f1, col[pid], 1] = y

    # A little individual drift so the shape breathes like real players do.
    drift = np.cumsum(rng.normal(0, 0.06, size=(n, P, 2)), axis=0)
    for j in range(P):
        for d in range(2):
            drift[:, j, d] -= _smooth(drift[:, j, d], 60)
    targets += np.clip(drift, -2.0, 2.0)

    # Event anchors: hard ones (on-ball actions) are always honoured, soft ones (pressing) when feasible.
    soft: dict[int, list[tuple[float, float, float]]] = {j: [] for j in range(P)}

    def feet(x: float, y: float, side: str) -> tuple[float, float]:
        return (x - FEET, y) if side == "home" else (x + FEET, y)

    for e in events:
        pid = e.get("player")
        j = col.get(pid or "")
        if j is None:
            continue
        typ, side, ts, x, y = e["type"], side_of[pid], e["ts"], e["x"], e["y"]
        if typ in ("pass", "clearance", "shot"):
            anchors[j].append((ts, *feet(x, y, side)))
            if "end_x" in e:
                anchors[j].append((ts + e["dur"] - _pass_flight(e), *feet(x, y, side)))
            r = col.get(e.get("receiver") or "")
            if r is not None and "end_x" in e:
                anchors[r].append((ts + e["dur"], *feet(e["end_x"], e["end_y"], side_of[e["receiver"]])))
        elif typ == "carry" and "end_x" in e:
            anchors[j].append((ts, *feet(x, y, side)))
            anchors[j].append((ts + e["dur"], *feet(e["end_x"], e["end_y"], side)))
        elif typ in ("interception", "tackle", "save", "block", "offside"):
            anchors[j].append((ts, *feet(x, y, side)))
        elif typ in ("pressure", "foul"):  # close the ball down from the goal side
            soft[j].append((ts, x - 1.6 if side == "home" else x + 1.6, y))

    # The last moment someone has the ball is an anchor too, so they leave it smoothly.
    for t0, t1, j in holds:
        f = min(n - 1, int(round(t1 * HZ)))
        anchors[j].append((t1, *feet(float(bx[f]), float(by[f]), sides[j])))

    shape_path = _follow(targets, np.array(pace))
    xy = np.empty((n, P, 2))
    for j in range(P):
        path = np.stack([_smooth(shape_path[:, j, 0], 4), _smooth(shape_path[:, j, 1], 4)], axis=1)
        hard = _apply_anchors(path, anchors[j], n)
        # Pressing runs are optional: keep one only if the player could physically get there in time
        # and it does not collide with an action of their own.
        hard_t = np.array(sorted(a[0] for a in anchors[j])) if anchors[j] else np.array([])
        ok = []
        for t, x, y in soft[j]:
            f = min(n - 1, int(round(t * HZ)))
            f_back = max(0, f - int(1.5 * HZ))
            here = hard[f_back]
            if np.isnan(here).any():
                continue
            if hard_t.size and np.min(np.abs(hard_t - t)) < 1.2:
                continue
            if np.hypot(x - here[0], y - here[1]) / 1.5 <= 8.0:
                ok.append((t, x, y))
        xy[:, j] = _apply_anchors(path, anchors[j] + ok, n) if ok else hard
        xy[np.isnan(targets[:, j, 0]), j] = np.nan

    # Whoever has the ball keeps it at their feet.
    f_idx = np.nonzero(owner >= 0)[0]
    js = owner[f_idx]
    keep = ~np.isnan(xy[f_idx, js, 0])
    f_idx, js = f_idx[keep], js[keep]
    behind = np.where(np.array([sides[j] == "home" for j in js], dtype=bool), -FEET, FEET)
    xy[f_idx, js, 0] = bx[f_idx] + behind
    xy[f_idx, js, 1] = by[f_idx]

    np.clip(xy[..., 0], -2.0, PITCH_LENGTH + 2.0, out=xy[..., 0])
    np.clip(xy[..., 1], -2.0, PITCH_WIDTH + 2.0, out=xy[..., 1])
    vmax = (6.2 + 3.2 * np.array(pace) / 100).astype(np.float32)
    return Tracking(ids, sides, xy.astype(np.float32), np.stack([bx, by], axis=1).astype(np.float32),
                    bz.astype(np.float32), owner, vmax)


def _follow(targets: np.ndarray, pace: np.ndarray) -> np.ndarray:
    """Players move towards their shape targets like athletes: capped speed and acceleration."""
    n, P, _ = targets.shape
    vcap = 4.2 + 3.0 * pace / 100  # a team keeps its shape at a jog-to-run, not a sprint
    acc = 2.8 * DT
    pos = np.where(np.isnan(targets[0]), 0.0, targets[0])
    vel = np.zeros((P, 2))
    out = np.empty_like(targets)
    was_on = ~np.isnan(targets[0, :, 0])
    for f in range(n):
        tgt = targets[f]
        on = ~np.isnan(tgt[:, 0])
        new = on & ~was_on  # just came on: start in place
        pos[new] = tgt[new]
        vel[new] = 0.0
        desired = np.where(on[:, None], (tgt - pos) * 1.1, 0.0)
        speed = np.linalg.norm(desired, axis=1)
        over = speed > vcap
        desired[over] *= (vcap[over] / speed[over])[:, None]
        dv = desired - vel
        dvn = np.linalg.norm(dv, axis=1)
        big = dvn > acc
        dv[big] *= (acc / dvn[big])[:, None]
        vel += dv
        pos = pos + vel * DT
        out[f] = np.where(on[:, None], pos, np.nan)
        was_on = on
    return out


def _apply_change(e: dict, slots: dict, dna: dict, anchors: dict, col: dict) -> None:
    side = e["team"]
    if e["type"] == "substitution":
        off, on = e["player_off"], e["player_on"]
        if off in slots[side]:
            slots[side][on] = slots[side].pop(off)
    elif e["type"] == "card" and e.get("outcome") in ("red", "second_yellow"):
        slots[side].pop(e["player"], None)
    elif e["type"] == "tactical_change":
        ch = e.get("changes", {})
        for k in ("width", "line_height"):
            if k in ch:
                dna[side][k] = ch[k]
        if "formation" in ch and e.get("roles"):
            by_role = {slot[0]: slot for slot in FORMATIONS[ch["formation"]]}
            slots[side] = {pid: by_role[role] for pid, role in e["roles"].items() if role in by_role}
