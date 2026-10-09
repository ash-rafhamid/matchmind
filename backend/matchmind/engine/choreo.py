"""The choreographer: plays the event script out as continuous, physical football.

The event simulator decides *what* happens (who passes to whom, tackles, shots,
goals). This module decides *how it looks*, by stepping every player and the
ball forward 10 times a second:

* the player on the ball keeps moving with it (receive, touch, dribble, pass);
* passes are struck at real ball speeds and aimed where the receiver will be,
  and the receiver runs onto them;
* defenders react to where the ball really is: the nearest presses the carrier,
  interceptors step into the passing lane, tacklers chase the dribbler;
* goalkeepers stay between ball and goal and go to meet shots;
* everyone accelerates, runs and slows down like an athlete, and players do not
  run through each other.

Event coordinates are then rewritten from what actually happened on the pitch,
so analytics, AI commentary and the 3D replay all describe the same match.
"""

from __future__ import annotations

import numpy as np

from .formations import FORMATIONS, role_group
from .league import Team
from .pitch import GOAL_Y, PITCH_LENGTH, PITCH_WIDTH, expected_goals
from .tracking import (
    BALL_EVENTS,
    DT,
    HZ,
    Tracking,
    _apply_change,
    _ball_path,
    _shape,
    _smooth,
)

FEET = 0.65  # the ball sits this far in front of the player who has it
# animation cues for the 3D figures
CUE = {"kick": 1, "shoot": 2, "stab": 3, "slide": 4, "lunge": 5, "fall": 6, "dive_pos": 7, "dive_neg": 8, "block": 9}
SEP = 1.1  # players keep at least this far apart
LOFTED = {"long", "cross"}


def _ball_speed(length: float) -> float:
    """Typical ball speed for a pass of this length (m/s): short ~12, long ~26."""
    return float(np.clip(11.0 + 0.36 * length, 10.0, 27.0))


def _clip_len(v: np.ndarray, max_len: float) -> np.ndarray:
    n = float(np.hypot(*v))
    return v if n <= max_len or n == 0 else v * (max_len / n)


def _unit(v: np.ndarray) -> np.ndarray:
    n = float(np.hypot(*v))
    return v / n if n > 1e-6 else np.zeros(2)


def choreograph(events: list[dict], home: Team, away: Team, end_ts: float, seed: int = 0) -> Tracking:
    rng = np.random.default_rng(seed + 7919)
    cue_rng = np.random.default_rng(seed + 31)  # animation choices never shift the match itself
    teams = {"home": home, "away": away}
    ids: list[str] = []
    sides: list[str] = []
    pace: list[float] = []
    for side, team in teams.items():
        for p in team.players:
            ids.append(p.id)
            sides.append(side)
            pace.append(p.pace)
    P = len(ids)
    col = {pid: i for i, pid in enumerate(ids)}
    side_arr = np.array([s == "home" for s in sides])
    pace_arr = np.array(pace, dtype=float)
    n = int(end_ts * HZ) + 1
    events.sort(key=lambda e: (e["ts"], e["id"]))

    # ---------------------------------------------------------------- shape targets
    # Where each player wants to be from the team's shape, given (roughly) where the ball is.
    hx, hy, _, _, _ = _ball_path(events, n, col)
    poss_home = np.ones(n, dtype=bool)
    current, last_f = True, 0
    for e in events:
        if e["type"] in BALL_EVENTS:
            f = min(n, int(round(e["ts"] * HZ)))
            poss_home[last_f:f] = current
            current, last_f = e["team"] == "home", f
    poss_home[last_f:] = current
    own_half = np.zeros(n, dtype=bool)
    prev_end = 0.0
    for e in events:
        if e["type"] in BALL_EVENTS:
            if e.get("set_piece") == "kickoff":
                own_half[int(prev_end * HZ):int(round((e["ts"] + 0.3) * HZ)) + 1] = True
            prev_end = e["ts"] + e.get("dur", 0.0)
    period_starts = sorted({int(round(e["ts"] * HZ)) for e in events if e["type"] == "period_start" and e["ts"] > 0})

    slots = {s: {p.id: slot for p, slot in zip(t.starters, FORMATIONS[t.dna.formation])} for s, t in teams.items()}
    dna = {s: {"width": t.dna.width, "line_height": t.dna.line_height, "press": t.dna.press} for s, t in teams.items()}
    press_at = {s: np.full(n, teams[s].dna.press) for s in teams}
    role_at = np.full((n, P), "", dtype=object)
    changes = [e for e in events if e["type"] in ("substitution", "card", "tactical_change")]
    cuts = [0.0] + [e["ts"] for e in changes] + [n * DT]
    targets = np.full((n, P, 2), np.nan)
    lag = rng.integers(2, 6, size=P)  # 0.2-0.5 s to read the game
    gain = rng.uniform(0.8, 1.1, size=P)
    scratch_anchors: dict[int, list] = {j: [] for j in range(P)}
    for seg in range(len(cuts) - 1):
        if seg > 0:
            _apply_change(changes[seg - 1], slots, dna, scratch_anchors, col)
            ch = changes[seg - 1]
            if ch["type"] == "tactical_change" and "press" in ch.get("changes", {}):
                press_at[ch["team"]][int(ch["ts"] * HZ):] = ch["changes"]["press"]
        f0, f1 = int(round(cuts[seg] * HZ)), min(n, int(round(cuts[seg + 1] * HZ)))
        if f1 <= f0:
            continue
        frames = np.arange(f0, f1)
        for side in ("home", "away"):
            is_home = side == "home"
            for pid, (role, sx, sy) in slots[side].items():
                j = col[pid]
                seen = np.maximum(frames - lag[j], 0)
                bxs = hx[seen] if is_home else PITCH_LENGTH - hx[seen]
                bys = hy[seen] if is_home else PITCH_WIDTH - hy[seen]
                bxs = PITCH_LENGTH / 2 + (bxs - PITCH_LENGTH / 2) * gain[j]
                bys = GOAL_Y + (bys - GOAL_Y) * gain[j]
                in_poss = poss_home[seen] if is_home else ~poss_home[seen]
                x, y = _shape(sx, sy, role, bxs, bys, in_poss, dna[side]["width"], dna[side]["line_height"])
                if role != "GK":
                    x = np.where(own_half[f0:f1], np.minimum(x, PITCH_LENGTH / 2 - 1.0), x)
                if not is_home:
                    x, y = PITCH_LENGTH - x, PITCH_WIDTH - y
                targets[f0:f1, j, 0] = x
                targets[f0:f1, j, 1] = y
                role_at[f0:f1, j] = role
    # a little life: slow individual drift, and off-the-ball runs by attackers and midfielders
    drift = np.cumsum(rng.normal(0, 0.05, size=(n, P, 2)), axis=0)
    for j in range(P):
        for d in range(2):
            drift[:, j, d] -= _smooth(drift[:, j, d], 80)
    targets += np.clip(drift, -1.8, 1.8)
    for j in range(P):
        attack = 1.0 if side_arr[j] else -1.0
        mine = poss_home if side_arr[j] else ~poss_home
        t = rng.uniform(3, 12)
        while True:
            t += rng.uniform(9, 22)
            f0 = int(t * HZ)
            dur = int(rng.uniform(2.2, 3.8) * HZ)
            if f0 + dur >= n:
                break
            r = role_at[f0, j]
            if not r or r == "GK" or role_group(r) not in ("ATT", "MID") or not mine[f0]:
                continue
            ang = rng.uniform(-0.7, 0.7)
            amp = rng.uniform(8, 17)
            w = np.sin(np.linspace(0, np.pi, dur)) ** 2
            targets[f0:f0 + dur, j, 0] += attack * np.cos(ang) * amp * w
            targets[f0:f0 + dur, j, 1] += np.sin(ang) * amp * w
    np.clip(targets[..., 0], 1.0, PITCH_LENGTH - 1.0, out=targets[..., 0])
    np.clip(targets[..., 1], 1.0, PITCH_WIDTH - 1.0, out=targets[..., 1])

    # ---------------------------------------------------------------- the script
    ball_events = [e for e in events if e["type"] in BALL_EVENTS]
    next_ball = {id(e): (ball_events[i + 1] if i + 1 < len(ball_events) else None) for i, e in enumerate(ball_events)}
    dead_types = {"goal", "foul", "offside", "period_end"}
    script = [e for e in events if e["type"] in BALL_EVENTS or e["type"] in dead_types or e["type"] in ("period_start", "pressure")]
    goal_x = {True: PITCH_LENGTH, False: 0.0}  # the goal each side attacks

    vmax = 7.0 + 2.3 * pace_arr / 100
    pos = np.where(np.isnan(targets[0]), 0.0, targets[0]).astype(float)
    vel = np.zeros((P, 2))
    face = np.where(side_arr[:, None], np.array([1.0, 0.0]), np.array([-1.0, 0.0]))
    xy = np.full((n, P, 2), np.nan, dtype=np.float32)
    ball_out = np.zeros((n, 2), dtype=np.float32)
    z_out = np.zeros(n, dtype=np.float32)
    owner_out = np.full(n, -1, dtype=np.int32)
    cues: list[tuple[float, int, int]] = []
    last_lunge: dict[int, float] = {}

    ball = np.array([PITCH_LENGTH / 2, PITCH_WIDTH / 2])
    ball_z = 0.0
    owner = -1
    dead = True
    dribble: dict | None = None  # {"to": point, "speed": m/s}
    flight: dict | None = None  # {"p0","p1","t0","t1","peak","to": col | None, "dead_after": bool}
    pending: dict | None = None  # a strike scheduled for a later time
    roles: dict[int, dict] = {}  # col -> {"to": point | None, "chase": col | None, "until": t, "speed": "sprint"/"run"}
    restart: dict | None = None  # {"spot", "taker", "ts"} for the next set piece
    fixes: list[tuple] = []  # (event, field, frame, kind, col) filled in from the recording
    k = 0
    reset_frames = set(period_starts)
    was_on = ~np.isnan(targets[0, :, 0])

    def at_feet(j: int) -> np.ndarray:
        return pos[j] + face[j] * FEET

    def team_cols(home_side: bool, on: np.ndarray) -> np.ndarray:
        return np.nonzero(on & (side_arr == home_side))[0]

    def strike(e: dict, t: float, to: int | None, aim: np.ndarray, t1: float, peak: float, dead_after: bool) -> None:
        nonlocal flight, owner, dribble
        p0 = ball.copy()
        flight = {"p0": p0, "p1": aim.astype(float), "t0": t, "t1": max(t1, t + 0.25), "peak": peak, "to": to, "dead_after": dead_after}
        owner = -1
        dribble = None
        e["x"], e["y"] = round(float(p0[0]), 2), round(float(p0[1]), 2)
        if "end_x" in e:
            e["end_x"], e["end_y"] = round(float(aim[0]), 2), round(float(aim[1]), 2)

    for f in range(n):
        t = f * DT
        on = ~np.isnan(targets[f, :, 0])
        # substitutes come on from the halfway line; red cards walk off
        new = on & ~was_on
        if f in reset_frames:
            pos[on] = targets[f][on]
            vel[on] = 0.0
        if new.any():
            pos[new] = np.column_stack([np.full(new.sum(), PITCH_LENGTH / 2), np.where(side_arr[new], -1.0, PITCH_WIDTH + 1.0)])
            vel[new] = 0.0
        was_on = on

        # ------------------------------------------------ events due now
        while k < len(script) and script[k]["ts"] <= t + 1e-9:
            e = script[k]
            k += 1
            typ = e["type"]
            j = col.get(e.get("player") or "")
            if typ == "period_start":
                dead = True
                continue
            if typ == "foul" and j is not None and on[j]:
                victim = col.get(e.get("victim") or "")
                far = victim is None or np.hypot(*(pos[j] - pos[victim])) > 1.8
                cues.append((t - 0.15, j, CUE["slide"] if far and cue_rng.random() < 0.5 else CUE["stab"]))
                if victim is not None and on[victim]:
                    cues.append((t, victim, CUE["fall"]))
            if typ in dead_types:
                if typ != "goal":
                    fixes.append((e, "xy", f, "ball", None))
                dead = True
                owner = -1 if typ != "offside" else owner
                continue
            if typ == "pressure":
                if j is not None and on[j]:
                    roles[j] = {"chase": owner, "to": None, "until": t + 1.4, "speed": "sprint"}
                    fixes.append((e, "xy", f, "player", j))
                    if owner >= 0 and np.hypot(*(pos[j] - pos[owner])) < 3.2:
                        cues.append((t, j, CUE["lunge"]))
                continue
            if j is None or not on[j]:
                continue
            # the ball is live again (restarts) or changes hands
            if dead and e.get("set_piece"):
                spot = np.array([e["x"], e["y"]], dtype=float)
                if np.hypot(*(pos[j] - spot)) > 2.5:
                    pos[j] = spot - _unit(np.array([goal_x[side_arr[j]] - spot[0], GOAL_Y - spot[1]])) * FEET
                ball = spot.copy()
                ball_z = 0.0
                face[j] = _unit(np.array([goal_x[side_arr[j]], GOAL_Y]) - spot)
                restart = None
            dead = False
            flight = None if typ in ("interception", "tackle", "save") else flight
            nxt = next_ball.get(id(e))
            if typ == "tackle":
                prev = owner
                far = prev >= 0 and np.hypot(*(pos[j] - pos[prev])) > 1.7
                cues.append((t - 0.2, j, CUE["slide"] if far else CUE["stab"]))
                if prev >= 0 and cue_rng.random() < 0.3:
                    cues.append((t + 0.05, prev, CUE["fall"]))
            elif typ == "interception":
                cues.append((t - 0.15, j, CUE["stab"]))
            elif typ == "block":
                cues.append((t - 0.1, j, CUE["block"]))
            elif typ == "save":
                cues.append((t - 0.25, j, CUE["dive_pos"] if ball[1] >= pos[j][1] else CUE["dive_neg"]))
            if typ in ("interception", "tackle", "save", "block"):
                owner = j
                pending = None
                fixes.append((e, "xy", f, "ball", None))
                roles.pop(j, None)
                if typ == "block":
                    owner = -1
                continue
            owner = j
            roles.pop(j, None)
            if typ == "carry":
                disp = np.array([e["end_x"] - e["x"], e["end_y"] - e["y"]], dtype=float)
                dur = max(e.get("dur", 1.0), 0.3)
                dribble = {"to": pos[j] + disp, "speed": float(np.clip(np.hypot(*disp) / dur, 1.5, 7.5))}
                fixes.append((e, "xy", f, "ball", None))
                fixes.append((e, "end", min(n - 1, int(round((e["ts"] + dur) * HZ))), "ball", None))
                if e.get("outcome") == "tackled" and nxt is not None and nxt["type"] == "tackle":
                    d = col.get(nxt["player"])
                    if d is not None:
                        roles[d] = {"chase": j, "to": None, "until": nxt["ts"], "speed": "sprint"}
                continue
            # passes, clearances and shots: the player keeps the ball, then strikes it
            intent = np.array([e.get("end_x", e["x"]), e.get("end_y", e["y"])], dtype=float)
            arrive = nxt["ts"] if nxt is not None and nxt["ts"] > e["ts"] else e["ts"] + max(e.get("dur", 1.0), 0.5)
            if typ == "shot":
                strike_at = e["ts"] + 0.12
            else:
                length = float(np.hypot(*(intent - pos[j])))
                flight_s = float(np.clip(length / _ball_speed(length), 0.3, max(0.3, arrive - e["ts"] - 0.15)))
                strike_at = max(e["ts"] + 0.1, arrive - flight_s)
                hold = strike_at - e["ts"]
                if hold > 0.8:  # take a touch and move with the ball towards the pass
                    dribble = {"to": pos[j] + _clip_len(intent - pos[j], min(5.0, 0.25 * length + 1.0)), "speed": float(np.clip(3.0 / max(hold, 1.0) * 1.6, 1.2, 3.2))}
                else:
                    dribble = None
            receiver = col.get(e.get("receiver") or "") if e.get("outcome") == "complete" else None
            catcher = col.get(nxt["player"]) if nxt is not None and nxt["team"] != e["team"] and nxt["type"] in ("interception", "save", "block") else None
            if receiver is not None and on[receiver]:
                roles[receiver] = {"to": intent, "chase": None, "until": arrive, "speed": "run"}
            if catcher is not None and on[catcher] and typ != "shot":
                roles[catcher] = {"to": pos[j] + (intent - pos[j]) * 0.7, "chase": None, "until": arrive, "speed": "sprint"}
            pending = {"e": e, "at": strike_at, "arrive": arrive, "intent": intent, "receiver": receiver, "catcher": catcher, "nxt": nxt}

        # ------------------------------------------------ strikes that are due
        if pending is not None and t >= pending["at"] and owner >= 0:
            e = pending["e"]
            typ = e["type"]
            j = owner
            intent = pending["intent"]
            arrive = pending["arrive"]
            nxt = pending["nxt"]
            left = max(arrive - t, 0.25)
            if typ == "shot":
                out = e.get("outcome")
                gx = goal_x[side_arr[j]]
                direction = 1.0 if gx > 50 else -1.0
                if out == "goal":
                    aim = np.array([gx + direction * 0.6, float(np.clip(e.get("end_y", GOAL_Y), GOAL_Y - 3.3, GOAL_Y + 3.3))])
                    to, peak, dead_after = None, rng.uniform(0.3, 1.6), True
                elif out == "saved" and pending["catcher"] is not None:
                    keeper = pending["catcher"]
                    line = np.array([gx, float(np.clip(e.get("end_y", GOAL_Y), GOAL_Y - 3.2, GOAL_Y + 3.2))])
                    aim = pos[keeper] + _clip_len(line - pos[keeper], 2.0)
                    roles[keeper] = {"to": aim, "chase": None, "until": arrive, "speed": "sprint"}
                    to, peak, dead_after = keeper, 0.9, False
                elif out == "blocked" and pending["catcher"] is not None:
                    blocker = pending["catcher"]
                    toward = np.array([gx, GOAL_Y]) - ball
                    aim = ball + _unit(toward) * float(np.clip(np.hypot(*(pos[blocker] - ball)), 1.5, 4.0))
                    roles[blocker] = {"to": aim, "chase": None, "until": arrive, "speed": "sprint"}
                    to, peak, dead_after = None, 0.4, False
                else:
                    aim = np.array([e.get("end_x", gx + direction), e.get("end_y", GOAL_Y + 5)], dtype=float)
                    to, peak, dead_after = None, rng.uniform(0.5, 2.5), True
                flight_end = t + float(np.clip(np.hypot(*(aim - ball)) / 25.0, 0.25, max(left, 0.3)))
                cues.append((t - 0.12, j, CUE["shoot"]))
                strike(e, t, to, aim, flight_end, peak, dead_after)
                # the shot is where the shooter really was: keep xG consistent with that spot
                ax = e["x"] if side_arr[j] else PITCH_LENGTH - e["x"]
                ay = e["y"] if side_arr[j] else PITCH_WIDTH - e["y"]
                tags = e.get("tags", [])
                e["xg"] = round(float(expected_goals(ax, ay, header="header" in tags, big_chance="big_chance" in tags,
                                                     counter=e.get("situation") == "counter",
                                                     penalty=e.get("situation") == "penalty")), 3)
            else:
                rec = pending["receiver"]
                catcher = pending["catcher"]
                lofted = e.get("pass_type") in LOFTED or typ == "clearance" or (
                    e.get("set_piece") in ("goal_kick", "corner") and np.hypot(*(intent - ball)) > 25)
                if rec is not None and on[rec]:
                    # aim where the receiver can get to in time, as close as possible to the intended spot
                    aim = pos[rec] + _clip_len(intent - pos[rec], 0.85 * vmax[rec] * left)
                    roles[rec] = {"to": aim, "chase": None, "until": arrive, "speed": "sprint"}
                    to, dead_after = rec, e.get("outcome") == "offside"
                elif catcher is not None and on[catcher]:
                    a, b = ball, intent
                    ab = b - a
                    s = float(np.clip(np.dot(pos[catcher] - a, ab) / max(np.dot(ab, ab), 1e-6), 0.15, 1.0))
                    lane = a + ab * s
                    aim = pos[catcher] + _clip_len(lane - pos[catcher], 0.9 * vmax[catcher] * left)
                    roles[catcher] = {"to": aim, "chase": None, "until": arrive, "speed": "sprint"}
                    to, dead_after = catcher, False
                elif nxt is not None and not nxt.get("set_piece") and col.get(nxt.get("player") or "") is not None:
                    other = col[nxt["player"]]
                    aim = pos[other] + _clip_len(intent - pos[other], 0.9 * vmax[other] * left)
                    roles[other] = {"to": aim, "chase": None, "until": arrive, "speed": "sprint"}
                    to, dead_after = other, False
                else:
                    aim, to, dead_after = intent, None, True
                length = float(np.hypot(*(aim - ball)))
                peak = min(13.0, 0.15 * length) if lofted else min(0.5, 0.02 * length)
                cues.append((t - 0.1, j, CUE["kick"]))
                strike(e, t, to, aim, arrive, peak, dead_after)
            pending = None

        # ------------------------------------------------ the ball in the air
        if flight is not None and t >= flight["t1"]:
            ball = flight["p1"].copy()
            ball_z = 0.0
            if flight["to"] is not None and on[flight["to"]]:
                owner = flight["to"]
                face[owner] = _unit(ball - pos[owner]) if np.hypot(*(ball - pos[owner])) > 0.2 else face[owner]
            if flight["dead_after"]:
                dead = True
            flight = None

        # ------------------------------------------------ where everyone wants to go
        tgt = targets[f].copy()
        urgent = np.zeros(P, dtype=bool)
        speed_cap = np.where(on, 7.0, 0.0)
        for j, r in list(roles.items()):
            if t > r["until"] + 0.3 or not on[j]:
                del roles[j]
                continue
            if r["chase"] is not None and r["chase"] >= 0:
                c = r["chase"]
                tgt[j] = pos[c] + vel[c] * 0.3
            elif r["to"] is not None:
                tgt[j] = r["to"]
            urgent[j] = True
            if r["speed"] == "run":
                speed_cap[j] = 7.0
            else:
                speed_cap[j] = vmax[j]
        live_ball = ball if flight is None else flight["p1"]
        if not dead and owner >= 0:
            # the defending side: the nearest outfield player presses, a second covers if the team presses high
            defend_home = not side_arr[owner]
            cand = [c for c in team_cols(defend_home, on) if c not in roles and role_at[f, c] != "GK"]
            if cand:
                d = np.hypot(*(pos[cand] - ball).T)
                order = np.argsort(d)
                goal_side = _unit(np.array([0.0 if defend_home else PITCH_LENGTH, GOAL_Y]) - ball)
                first = cand[order[0]]
                if d[order[0]] < 25:
                    carrier_v = vel[owner]
                    if d[order[0]] > 3.5:
                        # close him down at full speed
                        tgt[first] = ball + goal_side * 1.6 + carrier_v * 0.4
                        speed_cap[first] = float(min(vmax[first], 6.5 + 2.5 * press_at["home" if defend_home else "away"][f]))
                    else:
                        # jockey: stay goal-side, give a little ground, mirror his moves, and now and then
                        # stick a foot in (most of these miss - the event script decides the real tackles)
                        tgt[first] = ball + goal_side * 1.4 + carrier_v * 0.35
                        speed_cap[first] = float(min(vmax[first], np.hypot(*carrier_v) + 2.0))
                        if d[order[0]] < 2.4 and t - last_lunge.get(first, -9.0) > 4.0 and cue_rng.random() < 0.015:
                            cues.append((t, first, CUE["lunge"]))
                            last_lunge[first] = t
                    urgent[first] = True
                pr = press_at["home" if defend_home else "away"][f]
                if len(order) > 1 and pr > 0.6 and d[order[1]] < 16:
                    second = cand[order[1]]
                    tgt[second] = ball + goal_side * 6.0 + np.array([0.0, 4.0 if ball[1] < GOAL_Y else -4.0])
                    speed_cap[second] = 6.8
                    urgent[second] = True
        # goalkeepers: between the ball and the middle of their goal
        for j in np.nonzero(on)[0]:
            if role_at[f, j] != "GK" or j in roles or j == owner:
                continue
            own_goal = np.array([0.0 if side_arr[j] else PITCH_LENGTH, GOAL_Y])
            to_ball = live_ball - own_goal
            dist = float(np.hypot(*to_ball))
            tgt[j] = own_goal + _unit(to_ball) * float(np.clip(dist * 0.09, 1.2, 5.5))
            tgt[j][1] = float(np.clip(tgt[j][1], GOAL_Y - 5, GOAL_Y + 5))
        # the player on the ball goes where he is dribbling
        if owner >= 0 and on[owner]:
            if dribble is not None:
                tgt[owner] = dribble["to"]
                speed_cap[owner] = dribble["speed"]
            else:
                tgt[owner] = pos[owner]
                speed_cap[owner] = 1.0
            urgent[owner] = True

        # ------------------------------------------------ move, like athletes
        gap = np.where(on[:, None], tgt - pos, 0.0)
        dist = np.hypot(gap[:, 0], gap[:, 1])
        # far from where you should be: run; close: jog or walk
        want = np.where(urgent, speed_cap, np.minimum(speed_cap, np.clip(1.0 + 0.5 * dist, 1.0, 7.2)))
        # arrive gently, and stand still when already there
        want = np.minimum(want, dist * 1.4)
        want = np.where((~urgent) & (dist < 0.5), 0.0, want)
        desired = gap / np.maximum(dist, 1e-6)[:, None] * want[:, None]
        acc = np.where(urgent, 7.5, 4.2) * DT
        dv = desired - vel
        dvn = np.hypot(dv[:, 0], dv[:, 1])
        dv *= np.minimum(1.0, acc / np.maximum(dvn, 1e-9))[:, None]
        vel = np.where(on[:, None], vel + dv, 0.0)
        # personal space: nudge players apart when they get too close
        idx = np.nonzero(on)[0]
        if len(idx) > 1:
            q = pos[idx]
            diff = q[:, None, :] - q[None, :, :]
            dd = np.hypot(diff[..., 0], diff[..., 1]) + np.eye(len(idx)) * 99
            push = np.clip(SEP - dd, 0, None) / np.maximum(dd, 1e-6)
            vel[idx] += (diff * push[..., None]).sum(axis=1) * 2.0
        pos = np.where(on[:, None], pos + vel * DT, pos)
        np.clip(pos[:, 0], -2.0, PITCH_LENGTH + 2.0, out=pos[:, 0])
        np.clip(pos[:, 1], -2.0, PITCH_WIDTH + 2.0, out=pos[:, 1])
        moving = np.hypot(vel[:, 0], vel[:, 1]) > 0.4
        face = np.where(moving[:, None], vel / np.maximum(np.hypot(vel[:, 0], vel[:, 1]), 1e-6)[:, None], face)

        # ------------------------------------------------ the ball
        if flight is not None:
            u = (t - flight["t0"]) / max(flight["t1"] - flight["t0"], 1e-6)
            u = float(np.clip(u, 0.0, 1.0))
            ease = 1 - (1 - u) ** 1.5  # struck hard, slowing as it travels
            ball = flight["p0"] + (flight["p1"] - flight["p0"]) * ease
            ball_z = flight["peak"] * 4 * u * (1 - u)
        elif owner >= 0 and on[owner] and not dead:
            target_ball = at_feet(owner)
            jump = float(np.hypot(*(target_ball - ball)))
            ball = target_ball if jump < 1.2 else ball + (target_ball - ball) * 0.45
            ball_z = 0.0
        elif dead and restart is None:
            ball_z = 0.0

        xy[f] = np.where(on[:, None], pos, np.nan)
        ball_out[f] = ball
        z_out[f] = ball_z
        owner_out[f] = owner if (owner >= 0 and flight is None and not dead) else -1

    # ---------------------------------------------------------------- rewrite event positions
    for e, field, f, kind, j in fixes:
        f = min(f, n - 1)
        p = ball_out[f] if kind == "ball" else xy[f, j]
        if np.isnan(p).any():
            continue
        if field == "xy":
            e["x"], e["y"] = round(float(p[0]), 2), round(float(p[1]), 2)
        else:
            e["end_x"], e["end_y"] = round(float(p[0]), 2), round(float(p[1]), 2)
    for e in events:
        if "x" in e:
            e["x"] = round(float(np.clip(e["x"], -1.0, PITCH_LENGTH + 1.0)), 2)
            e["y"] = round(float(np.clip(e["y"], -1.0, PITCH_WIDTH + 1.0)), 2)

    vmax_out = (6.2 + 3.2 * pace_arr / 100).astype(np.float32)
    cue_arr = np.array(sorted(cues), dtype=np.float32).reshape(-1, 3)
    return Tracking(ids, sides, xy, ball_out, z_out, owner_out, vmax_out, cue_arr)
