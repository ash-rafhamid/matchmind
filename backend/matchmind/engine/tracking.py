"""10 Hz tracking: the Tracking container, physical metrics, and helpers the choreographer uses
(the event-keyframe ball path, the team-shape model and lineup changes).

The motion itself is produced by engine/choreo.py, which plays the event script out physically.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .formations import FORMATIONS, role_group
from .pitch import GOAL_Y, PITCH_LENGTH, PITCH_WIDTH

HZ = 10
DT = 1.0 / HZ
FEET = 0.6  # metres between a player's centre and the ball at their feet
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
    # animation cues: (time, player column, kind) - see CUE in choreo.py
    cues: np.ndarray | None = None  # (k, 3) float32

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
        # A new action always wins: cut short whatever the ball was still doing (deflections, set-piece restarts).
        cut = ts - 0.15 if e.get("set_piece") == "kickoff" else ts
        while kt and kt[-1] > cut:
            kt.pop(); kx.pop(); ky.pop(); kz.pop()
        if e.get("set_piece") == "kickoff":
            key(ts - 0.15, x, y)
        nxt = ball_events[i + 1] if i + 1 < len(ball_events) else None
        if t in ("pass", "clearance") and "end_x" in e:
            ex, ey = e["end_x"], e["end_y"]
            if nxt is not None and nxt["ts"] - (ts + dur) < 0.6 and nxt.get("set_piece") is None:
                ex, ey = nxt["x"], nxt["y"]  # the ball goes to whoever touches it next
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
            if nxt is not None and nxt["type"] in ("save", "block") and nxt["ts"] < ts + 0.25 + flight + 0.6:
                ex, ey = nxt["x"], nxt["y"]  # it stops where it is saved or blocked
                flight = max(0.15, nxt["ts"] - ts - 0.25)
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


# ------------------------------------------------------------- main entry


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
