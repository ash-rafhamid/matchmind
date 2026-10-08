"""Event-level football match simulator.

The simulator walks a single ball through a match: the player in possession
picks an action (pass, carry, shot, cross, clearance...) with probabilities
shaped by pitch location, opponent pressure, both teams' tactical DNA and
player attributes. Outcomes produce restarts, turnovers, cards, goals and
substitutions. Coaches react to the scoreline, and scripted tactical changes
can be injected, so every match carries a story the analytics can find.

The same engine powers "what-if" questions: run the match to a minute, fork
the state, change a team's tactics, and re-simulate the remainder many times.
"""

from __future__ import annotations

import copy
import math
import random
from dataclasses import dataclass, field

from .formations import FORMATIONS, shape_target
from .league import Player, Team, TeamDNA
from .pitch import (
    BOX_X,
    GOAL_Y,
    PITCH_LENGTH,
    PITCH_WIDTH,
    clamp,
    clamp_to_pitch,
    distance_to_goal,
    expected_goals,
    expected_threat,
    flip,
    in_box,
    to_absolute,
)

SIDES = ("home", "away")


def other(side: str) -> str:
    return "away" if side == "home" else "home"


@dataclass
class TacticalChange:
    minute: float  # football minute (e.g. 60.0); applied once the clock passes it
    side: str
    changes: dict[str, float | str]
    label: str


@dataclass
class OnPitch:
    player: Player
    role: str
    base_x: float
    base_y: float


@dataclass
class SideState:
    team: Team
    dna: TeamDNA
    on_pitch: list[OnPitch]
    bench: list[Player]
    yellows: set[str] = field(default_factory=set)
    sent_off: list[str] = field(default_factory=list)
    subs_made: int = 0
    sub_times: list[float] = field(default_factory=list)  # second-half period seconds
    goals: int = 0
    shots: int = 0
    xg: float = 0.0
    coach_mode: str = "plan"  # plan | chasing | protecting | locked

    def outfield(self) -> list[OnPitch]:
        return [op for op in self.on_pitch if op.role != "GK"]

    def keeper(self) -> OnPitch:
        for op in self.on_pitch:
            if op.role == "GK":
                return op
        return self.on_pitch[0]


@dataclass
class Restart:
    kind: str  # kickoff | throw_in | goal_kick | corner | free_kick | penalty
    side: str
    x: float  # in `side`'s attacking frame
    y: float


class MatchSimulator:
    def __init__(
        self,
        home: Team,
        away: Team,
        seed: int,
        script: list[TacticalChange] | None = None,
        auto_coach: bool = True,
    ) -> None:
        self.rng = random.Random(seed)
        self.seed = seed
        self.script = sorted(script or [], key=lambda c: c.minute)
        self.auto_coach = auto_coach
        self.sides: dict[str, SideState] = {}
        for side, team in (("home", home), ("away", away)):
            slots = FORMATIONS[team.dna.formation]
            on_pitch = [OnPitch(p, role, bx, by) for p, (role, bx, by) in zip(team.starters, slots)]
            st = SideState(team, copy.copy(team.dna), on_pitch, list(team.bench))
            st.sub_times = sorted(self.rng.uniform(10 * 60, 38 * 60) for _ in range(self.rng.randint(3, 5)))
            self.sides[side] = st

        self.period_len = {1: 2700 + self.rng.uniform(60, 220), 2: 2700 + self.rng.uniform(150, 380)}
        self.period = 1
        self.pt = 0.0  # seconds into current period
        self.ts = 0.0  # seconds of play since kick-off (both halves, no interval)
        self.finished = False
        self.record = True

        self.events: list[dict] = []
        self.next_id = 1
        self.chain = 0
        self.poss = "home"
        self.ball = (PITCH_LENGTH / 2, GOAL_Y)
        self.carrier: Player = self._central_player("home")
        self.restart: Restart | None = Restart("kickoff", "home", PITCH_LENGTH / 2, GOAL_Y)
        self.counter_until = -1.0
        self.last_pass_id: int | None = None
        self.header_chance = False
        self.big_chance = False
        self.set_piece_shot: str | None = None
        self._emit_marker("period_start", "home", note="Kick-off")

    # ------------------------------------------------------------------ clock

    @property
    def minute(self) -> float:
        return self.pt / 60 + (45 if self.period == 2 else 0)

    def clock(self) -> str:
        base = 45 * (self.period - 1)
        m = int(self.pt // 60)
        if m >= 45:
            return f"{base + 45}+{m - 44}'"
        return f"{base + m + 1}'"

    def _advance(self, dt: float) -> None:
        self.pt += dt
        self.ts += dt

    # ------------------------------------------------------------ main loop

    def run(self, until_minute: float | None = None) -> "MatchSimulator":
        while not self.finished:
            if until_minute is not None and self.minute >= until_minute and self.restart is None:
                break
            self.step()
        return self

    def step(self) -> None:
        if self.pt >= self.period_len[self.period]:
            self._end_period()
            return
        self._apply_script()
        if self.restart is not None:
            self._take_restart()
        else:
            self._open_play()

    def fork(self, seed: int) -> "MatchSimulator":
        """Independent copy of the current state that continues with a new random stream."""
        events, self.events = self.events, []
        try:
            clone = copy.deepcopy(self)
        finally:
            self.events = events
        clone.rng = random.Random(seed)
        clone.record = False
        return clone

    def _end_period(self) -> None:
        self._emit_marker("period_end", self.poss, note="Half-time" if self.period == 1 else "Full-time")
        if self.period == 2:
            self.finished = True
            return
        self.period = 2
        self.pt = 0.0
        self.counter_until = -1.0
        self._emit_marker("period_start", "away", note="Second half")
        self._set_restart("kickoff", "away", PITCH_LENGTH / 2, GOAL_Y)

    # --------------------------------------------------------------- events

    def _emit(
        self,
        type: str,
        side: str,
        player: Player | None,
        x: float,
        y: float,
        *,
        end: tuple[float, float] | None = None,
        outcome: str | None = None,
        receiver: Player | None = None,
        dur: float = 0.0,
        xg: float | None = None,
        tags: list[str] | None = None,
        related: int | None = None,
        **extra: object,
    ) -> int:
        eid = self.next_id
        self.next_id += 1
        if not self.record:
            return eid
        is_home = side == "home"
        ax, ay = to_absolute(x, y, is_home)
        ev: dict = {
            "id": eid,
            "ts": round(self.ts, 2),
            "period": self.period,
            "minute": int(self.minute),
            "clock": self.clock(),
            "team": side,
            "type": type,
            "player": player.id if player else None,
            "x": round(ax, 1),
            "y": round(ay, 1),
            "dur": round(dur, 2),
            "chain": self.chain,
            "tags": tags or [],
        }
        if end is not None:
            ex, ey = to_absolute(end[0], end[1], is_home)
            ev["end_x"], ev["end_y"] = round(ex, 1), round(ey, 1)
        if outcome:
            ev["outcome"] = outcome
        if receiver:
            ev["receiver"] = receiver.id
        if xg is not None:
            ev["xg"] = round(xg, 3)
        if related:
            ev["related"] = related
        ev.update({k: v for k, v in extra.items() if v is not None})
        self.events.append(ev)
        return eid

    def _emit_marker(self, type: str, side: str, **extra: object) -> int:
        return self._emit(type, side, None, PITCH_LENGTH / 2, GOAL_Y, **extra)

    def _tag(self, event_id: int | None, *tags: str) -> None:
        if event_id is None or not self.record:
            return
        for ev in reversed(self.events):
            if ev["id"] == event_id:
                ev["tags"].extend(t for t in tags if t not in ev["tags"])
                return

    # ------------------------------------------------------------ helpers

    def _man_diff(self, side: str) -> int:
        return len(self.sides[side].on_pitch) - len(self.sides[other(side)].on_pitch)

    def _targets(self, side: str, ball_x: float, ball_y: float, in_possession: bool) -> list[tuple[OnPitch, float, float]]:
        st = self.sides[side]
        return [
            (op, *shape_target(op.base_x, op.base_y, op.role, ball_x, ball_y, in_possession, st.dna.width, st.dna.line_height))
            for op in st.on_pitch
        ]

    def _nearest(self, side: str, x: float, y: float, in_possession: bool, exclude: Player | None = None,
                 roles: set[str] | None = None) -> tuple[Player, float, float]:
        cands = [
            (math.hypot(tx - x, ty - y), op.player, tx, ty)
            for op, tx, ty in self._targets(side, x, y, in_possession)
            if op.player is not exclude and op.role != "GK" and (roles is None or op.role in roles)
        ]
        if not cands:
            cands = [(math.hypot(tx - x, ty - y), op.player, tx, ty)
                     for op, tx, ty in self._targets(side, x, y, in_possession) if op.player is not exclude]
        cands.sort(key=lambda c: c[0])
        pick = cands[0] if len(cands) == 1 or self.rng.random() < 0.72 else cands[1]
        return pick[1], pick[2], pick[3]

    def _central_player(self, side: str) -> Player:
        st = self.sides[side]
        order = ["ST", "LST", "RST", "AM", "LCM", "RCM", "CM", "DM"]
        for role in order:
            for op in st.on_pitch:
                if op.role == role:
                    return op.player
        return st.outfield()[0].player

    def _defender_at(self, side_with_ball: str, x: float, y: float) -> Player:
        """Nearest defender to a location given in the attacking team's frame."""
        dx, dy = flip(x, y)
        return self._nearest(other(side_with_ball), dx, dy, in_possession=False)[0]

    def _pressure(self, x: float, y: float) -> float:
        opp = self.sides[other(self.poss)].dna
        if x < 35:
            p = 0.12 + 0.7 * opp.press
        elif x < 70:
            p = 0.32 + 0.3 * opp.press
        else:
            p = 0.5 + 0.2 * (1 - opp.press) + (0.15 if in_box(x, y) else 0.0)
        p -= 0.06 * self._man_diff(self.poss)
        if self.ts < self.counter_until:
            p *= 0.55
        return clamp(p + self.rng.gauss(0, 0.08), 0.0, 1.0)

    def _fatigue(self, side: str) -> float:
        if self.period == 1:
            return 1.0 - 0.03 * self.pt / 2700
        return 0.97 - 0.06 * min(self.pt, 2700) / 2700

    def _change_possession(self, new_side: str, x: float, y: float, winner: Player, regain_event: int | None) -> None:
        """Hand the ball to `new_side` at (x, y) given in the *new* side's frame."""
        self.poss = new_side
        self.chain += 1
        self.ball = clamp_to_pitch(x, y)
        self.carrier = winner
        self.last_pass_id = None
        self.header_chance = self.big_chance = False
        self.set_piece_shot = None
        self.counter_until = -1.0
        if x >= 65:
            self._tag(regain_event, "high_turnover")
        dna = self.sides[new_side].dna
        if x < 70 and self.rng.random() < dna.counter * 0.45:
            self.counter_until = self.ts + self.rng.uniform(9, 15)
            self._tag(regain_event, "counter_start")

    def _set_restart(self, kind: str, side: str, x: float, y: float) -> None:
        self.restart = Restart(kind, side, *clamp_to_pitch(x, y))
        self.poss = side
        self.counter_until = -1.0
        self.last_pass_id = None
        self.header_chance = self.big_chance = False

    # --------------------------------------------------- coaching decisions

    def _apply_script(self) -> None:
        while self.script and self.minute >= self.script[0].minute:
            change = self.script.pop(0)
            self._apply_tactics(change.side, change.changes, change.label, source="scripted")
        if not self.auto_coach or self.period != 2:
            return
        for side in SIDES:
            st = self.sides[side]
            diff = st.goals - self.sides[other(side)].goals
            if st.coach_mode == "plan" and diff < 0 and self.minute >= 64:
                st.coach_mode = "chasing"
                self._apply_tactics(side, {
                    "press": min(1.0, st.dna.press + 0.18),
                    "directness": min(1.0, st.dna.directness + 0.15),
                    "line_height": min(1.0, st.dna.line_height + 0.12),
                }, "Chasing the game: press higher, play more direct", source="coach")
            elif st.coach_mode == "plan" and diff == 1 and self.minute >= 78:
                st.coach_mode = "protecting"
                self._apply_tactics(side, {
                    "press": max(0.0, st.dna.press - 0.2),
                    "line_height": max(0.0, st.dna.line_height - 0.2),
                    "tempo": max(0.0, st.dna.tempo - 0.15),
                }, "Protecting the lead: drop deeper, slow the tempo", source="coach")

    def _apply_tactics(self, side: str, changes: dict, label: str, source: str) -> None:
        st = self.sides[side]
        before = {k: getattr(st.dna, k) for k in changes if k != "formation"}
        for k, v in changes.items():
            if k == "formation":
                self._reshape(side, str(v))
            else:
                setattr(st.dna, k, clamp(float(v), 0.0, 1.0))
        self._emit_marker(
            "tactical_change", side, note=label, source=source,
            changes={k: round(float(v), 2) if k != "formation" else v for k, v in changes.items()},
            before={k: round(v, 2) for k, v in before.items()},
            roles={op.player.id: op.role for op in st.on_pitch} if "formation" in changes else None,
        )

    def _reshape(self, side: str, formation: str) -> None:
        st = self.sides[side]
        st.dna.formation = formation
        slots = FORMATIONS[formation]
        keeper = st.keeper()
        field_players = st.outfield()
        new = [OnPitch(keeper.player, "GK", *slots[0][1:])]
        for op, (role, bx, by) in zip(field_players, slots[1:]):
            new.append(OnPitch(op.player, role, bx, by))
        st.on_pitch = new

    def _maybe_substitute(self) -> None:
        if self.period != 2:
            return
        for side in SIDES:
            st = self.sides[side]
            while st.sub_times and self.pt >= st.sub_times[0] and st.bench and st.subs_made < 5:
                st.sub_times.pop(0)
                outgoing = self._pick_sub_off(st)
                if outgoing is None:
                    break
                group = outgoing.player.group
                incoming = next((p for p in st.bench if p.group == group), None) or next(
                    (p for p in st.bench if p.group != "GK"), None)
                if incoming is None:
                    break
                st.bench.remove(incoming)
                self._emit_marker("substitution", side, player_off=outgoing.player.id, player_on=incoming.id)
                outgoing.player = incoming
                st.subs_made += 1
                self._advance(self.rng.uniform(12, 25))

    def _pick_sub_off(self, st: SideState) -> OnPitch | None:
        pool = [op for op in st.outfield() if op.player in st.team.starters]
        if not pool:
            return None
        weights = [3.0 if op.player.group == "ATT" else 2.0 if op.player.group == "MID" else 0.8 for op in pool]
        weights = [w * (2.5 if op.player.id in st.yellows else 1.0) for w, op in zip(weights, pool)]
        return self.rng.choices(pool, weights)[0]

    # ------------------------------------------------------------ restarts

    def _take_restart(self) -> None:
        r = self.restart
        assert r is not None
        self.restart = None
        self.poss = r.side
        self.ball = (r.x, r.y)
        dead = {"kickoff": 0.0, "throw_in": 9.0, "goal_kick": 20.0, "corner": 25.0, "free_kick": 22.0, "penalty": 50.0}
        if r.kind != "kickoff" or self.pt > 0:
            self._advance(max(2.0, self.rng.gauss(dead[r.kind], 4)))
        self._maybe_substitute()
        self._apply_script()
        self.chain += 1

        if r.kind == "kickoff":
            self.carrier = self._central_player(r.side)
            self._pass("backward", 0.1, set_piece="kickoff")
        elif r.kind == "throw_in":
            self.carrier = self._nearest(r.side, r.x, r.y, in_possession=True)[0]
            self._pass("short", 0.35, set_piece="throw_in")
        elif r.kind == "goal_kick":
            self.carrier = self.sides[r.side].keeper().player
            self.ball = (5.5, GOAL_Y)
            long = self.rng.random() < 0.25 + 0.6 * self.sides[r.side].dna.directness
            self._pass("long" if long else "short", 0.25, set_piece="goal_kick")
        elif r.kind == "corner":
            self._corner(r)
        elif r.kind == "free_kick":
            self._free_kick(r)
        elif r.kind == "penalty":
            st = self.sides[r.side]
            taker = max((op.player for op in st.outfield()), key=lambda p: p.finishing)
            self.carrier = taker
            self.ball = (PITCH_LENGTH - 11, GOAL_Y)
            self.set_piece_shot = "penalty"
            self._shot(0.0, penalty=True)

    def _corner(self, r: Restart) -> None:
        st = self.sides[r.side]
        taker = max((op.player for op in st.outfield() if op.player.group != "DEF"), key=lambda p: p.passing,
                    default=st.outfield()[0].player)
        self.carrier = taker
        cy = 0.5 if r.y < GOAL_Y else PITCH_WIDTH - 0.5
        self.ball = (PITCH_LENGTH - 0.5, cy)
        tx, ty = self.rng.uniform(93, 99), self.rng.gauss(GOAL_Y, 6)
        if self.rng.random() < 0.3:
            target, *_ = self._nearest(r.side, tx, ty, in_possession=True,
                                       roles={"LCB", "RCB", "CB", "ST", "LST", "RST"})
            eid = self._emit("pass", r.side, taker, *self.ball, end=(tx, ty), outcome="complete", receiver=target,
                             dur=1.4, tags=["cross", "set_piece"], set_piece="corner", pass_type="cross")
            self._advance(1.4)
            self.ball, self.carrier = (tx, ty), target
            self.last_pass_id = eid
            self.header_chance = self.rng.random() < 0.75
            self.set_piece_shot = "corner"
            self._shot(0.4)
        else:
            defender = self._defender_at(r.side, tx, ty)
            eid = self._emit("pass", r.side, taker, *self.ball, end=(tx, ty), outcome="incomplete", dur=1.4,
                             tags=["cross", "set_piece"], set_piece="corner", pass_type="cross")
            self._advance(1.4)
            dx, dy = flip(tx, ty)
            cl = self._emit("clearance", other(r.side), defender, dx, dy, end=(dx + 25, dy), dur=1.0, related=eid)
            self._advance(1.0)
            if self.rng.random() < 0.35:
                winner = self._nearest(r.side, 78, self.rng.uniform(15, 53), in_possession=True)[0]
                self.ball, self.carrier = (78.0, self.rng.uniform(18, 50)), winner
                self.chain += 1
            else:
                winner = self._nearest(other(r.side), dx + 25, dy, in_possession=True)[0]
                self._change_possession(other(r.side), dx + 25, dy, winner, cl)

    def _free_kick(self, r: Restart) -> None:
        x, y = r.x, r.y
        st = self.sides[r.side]
        if x > 76 and abs(y - GOAL_Y) < 18 and distance_to_goal(x, y) < 30 and self.rng.random() < 0.4:
            self.carrier = max((op.player for op in st.outfield()), key=lambda p: p.finishing + p.passing)
            self.set_piece_shot = "free_kick"
            self._shot(0.0, xg_scale=0.7)
            return
        self.carrier = self._nearest(r.side, x, y, in_possession=True)[0]
        if x < 40:
            kind = "long" if self.rng.random() < 0.35 + 0.4 * st.dna.directness else "short"
        elif x > 72 and (y < 18 or y > 50):
            kind = "cross"
        else:
            kind = self.rng.choice(["short", "medium", "medium"])
        self._pass(kind, 0.2, set_piece="free_kick")

    # ------------------------------------------------------------ open play

    def _open_play(self) -> None:
        side = self.poss
        me, opp = self.sides[side], self.sides[other(side)]
        x, y = self.ball
        p = self._pressure(x, y)
        counter = self.ts < self.counter_until
        carrier = self.carrier
        is_gk = carrier is me.keeper().player
        dna, odna = me.dna, opp.dna

        if p > 0.55 and self.rng.random() < 0.45 * p and not is_gk:
            presser = self._defender_at(side, x, y)
            dx, dy = flip(x, y)
            self._emit("pressure", other(side), presser, dx, dy, dur=0.0)
            if self.rng.random() < 0.035 and not in_box(x, y):
                self._advance(1.0)
                self._foul(side, presser, x, y)
                return

        w: dict[str, float] = {}
        w["backward"] = 0.0 if x < 14 else (0.08 + 0.2 * p * (1 - dna.directness)) * (0.3 if counter else 1.0)
        w["short"] = 0.40 * (1.25 - 0.6 * dna.directness)
        w["medium"] = 0.24 * (1.3 if counter else 1.0)
        w["long"] = (0.03 + 0.16 * dna.directness) * (1.0 if x < 55 else 0.35)
        if 38 < x < 88:
            w["through"] = (0.02 + 0.07 * dna.directness + 0.06 * odna.line_height) * (2.2 if counter else 1.0)
        if x > 74 and (y < 15 or y > PITCH_WIDTH - 15):
            w["cross"] = 0.22 + 0.4 * dna.width
        w["carry"] = 0.2 * (0.55 + carrier.dribbling / 100) * (1 - 0.45 * p) * (1.7 if counter else 1.0)
        if x > 74 and distance_to_goal(x, y) < 32:
            base_xg = expected_goals(x, y, header=self.header_chance, big_chance=self.big_chance, counter=counter)
            d_goal = distance_to_goal(x, y)
            w["shot"] = 0.7 * base_xg + (0.05 if 12 < d_goal < 25 else 0.0)
            if self.header_chance or self.big_chance:
                w["shot"] += 0.35
        if x < 22 and p > 0.6:
            w["clearance"] = 0.35
        if is_gk:
            w.update(backward=0.0, through=0.0, carry=0.02, long=w["long"] * 3)

        action = self.rng.choices(list(w), list(w.values()))[0]
        if action == "shot":
            self._shot(p)
        elif action == "carry":
            self._carry(p, counter)
        elif action == "clearance":
            self._clearance()
        else:
            self._pass(action, p)

    def _sample_destination(self, kind: str, x: float, y: float) -> tuple[float, float]:
        g = self.rng.gauss
        u = self.rng.uniform
        if kind == "backward":
            d = (x + u(-18, -4), y + g(0, 10))
        elif kind == "short":
            d = (x + u(-3, 11), y + g(0, 9))
        elif kind == "medium":
            d = (x + u(6, 22), y + g(0, 14))
        elif kind == "long":
            d = (x + u(20, 45), y + g(0, 20))
        elif kind == "through":
            d = (x + u(12, 28), y + g(0, 8) + (GOAL_Y - y) * 0.3)
        elif kind == "cross":
            d = (u(91, 101), g(GOAL_Y, 6))
        else:  # clearance
            d = (x + u(25, 50), y + g(0, 18))
        return clamp_to_pitch(*d)

    def _pass(self, kind: str, p: float, set_piece: str | None = None) -> None:
        side = self.poss
        me = self.sides[side]
        x, y = self.ball
        passer = self.carrier
        dest = self._sample_destination(kind, x, y)
        roles = {"ST", "LST", "RST", "LW", "RW", "AM", "LM", "RM"} if kind == "through" else None
        receiver, rx, ry = self._nearest(side, dest[0], dest[1], in_possession=True, exclude=passer, roles=roles)
        end = dest if kind in ("through", "cross") else clamp_to_pitch((dest[0] + rx) / 2, (dest[1] + ry) / 2)
        length = math.hypot(end[0] - x, end[1] - y)

        base = {"backward": 0.98, "short": 0.95, "medium": 0.87, "long": 0.66, "through": 0.45, "cross": 0.3}[kind]
        if kind == "through":
            base *= 0.8 + 0.5 * self.sides[other(side)].dna.line_height
        skill = (0.86 + 0.28 * passer.passing / 100) * self._fatigue(side)
        if kind != "cross" and in_box(*end):
            base *= 0.78  # a crowded box: balls in are often cut out
        prob = clamp(base * skill * (1 - 0.12 * p) * (1 + 0.04 * self._man_diff(side)), 0.05, 0.99)
        dur = 0.9 + (1 - me.dna.tempo) * 1.6 + length / 16 + 0.6
        tags = [kind] if kind in ("through", "cross", "long") else []
        if set_piece:
            tags.append("set_piece")
        xt = expected_threat(*end) - expected_threat(x, y)
        progressive = end[0] - x >= 10 and end[0] > 40

        if self.rng.random() < prob:
            if progressive:
                tags.append("progressive")
            if end[0] > 70 and x <= 70:
                tags.append("final_third_entry")
            eid = self._emit("pass", side, passer, x, y, end=end, outcome="complete", receiver=receiver, dur=dur,
                             tags=tags, xt=round(xt, 4), set_piece=set_piece, pass_type=kind)
            self._advance(dur)
            self.ball, self.carrier = end, receiver
            self.last_pass_id = eid
            self.header_chance = kind == "cross" and in_box(*end) and self.rng.random() < 0.7
            self.big_chance = (kind == "through" and in_box(*end)) or (
                kind == "short" and in_box(*end) and x > BOX_X and abs(y - GOAL_Y) > 12)
            self.set_piece_shot = "set_piece" if set_piece in ("free_kick", "corner") else None
            return

        # Failed pass: offside, out of play, or a defender cuts it out.
        roll = self.rng.random()
        if kind == "cross" and roll < 0.2:
            eid = self._emit("pass", side, passer, x, y, end=end, outcome="out", dur=dur, tags=tags,
                             set_piece=set_piece, pass_type=kind)
            self._advance(dur)
            self._set_restart("corner", side, PITCH_LENGTH - 0.5, end[1])
            return
        if kind == "through" and roll < 0.13:
            eid = self._emit("pass", side, passer, x, y, end=end, outcome="offside", receiver=receiver, dur=dur,
                             tags=tags, set_piece=set_piece, pass_type=kind)
            self._advance(dur)
            self._emit("offside", side, receiver, *end, related=eid)
            fx, fy = flip(*end)
            self._set_restart("free_kick", other(side), fx, fy)
            return
        if roll < 0.3:
            eid = self._emit("pass", side, passer, x, y, end=end, outcome="out", dur=dur, tags=tags,
                             set_piece=set_piece, pass_type=kind)
            self._advance(dur)
            if end[0] > PITCH_LENGTH - 6:
                if self.rng.random() < 0.25:
                    self._set_restart("corner", side, PITCH_LENGTH - 0.5, end[1])
                else:
                    self._set_restart("goal_kick", other(side), 5.5, GOAL_Y)
            else:
                fx, fy = flip(end[0], 0.5 if end[1] < GOAL_Y else PITCH_WIDTH - 0.5)
                self._set_restart("throw_in", other(side), fx, fy)
            return
        f = self.rng.uniform(0.45, 1.0)
        ix, iy = x + (end[0] - x) * f, y + (end[1] - y) * f
        eid = self._emit("pass", side, passer, x, y, end=(ix, iy), outcome="intercepted", dur=dur * f, tags=tags,
                         set_piece=set_piece, pass_type=kind)
        self._advance(dur * f)
        dx, dy = flip(ix, iy)
        winner = self._nearest(other(side), dx, dy, in_possession=False)[0]
        reg = self._emit("interception", other(side), winner, dx, dy, related=eid)
        self._change_possession(other(side), dx, dy, winner, reg)

    def _carry(self, p: float, counter: bool) -> None:
        side = self.poss
        x, y = self.ball
        c = self.carrier
        length = self.rng.uniform(4, 12) * (0.6 + c.pace / 100) * (1.4 if counter else 1.0)
        if x > 80:
            length *= 0.55
        theta = self.rng.gauss(0, 0.6) + (GOAL_Y - y) / 120
        end = clamp_to_pitch(x + length * math.cos(theta), y + length * math.sin(theta))
        dur = length / (3.6 + c.pace / 30)
        prob = clamp((0.84 + 0.15 * (c.dribbling - 60) / 40 - 0.26 * p - (0.2 if in_box(*end) else 0.0))
                     * self._fatigue(side), 0.25, 0.97)
        if self.rng.random() < prob:
            tags = ["progressive"] if end[0] - x >= 8 and end[0] > 40 else []
            if end[0] > 70 and x <= 70:
                tags.append("final_third_entry")
            self._emit("carry", side, c, x, y, end=end, outcome="success", dur=dur, tags=tags,
                       xt=round(expected_threat(*end) - expected_threat(x, y), 4))
            self._advance(dur)
            self.ball = end
            self.header_chance = False
            self.big_chance = self.big_chance and in_box(*end)
            return

        mx, my = (x + end[0]) / 2, (y + end[1]) / 2
        defender = self._defender_at(side, mx, my)
        dx, dy = flip(mx, my)
        self._advance(dur / 2)
        if self.rng.random() < (0.025 if in_box(mx, my) else 0.3):
            self._foul(side, defender, mx, my)
            return
        self._emit("carry", side, c, x, y, end=(mx, my), outcome="tackled", dur=dur / 2)
        reg = self._emit("tackle", other(side), defender, dx, dy, outcome="won")
        self._change_possession(other(side), dx, dy, defender, reg)

    def _clearance(self) -> None:
        side = self.poss
        x, y = self.ball
        end = self._sample_destination("clearance", x, y)
        eid = self._emit("clearance", side, self.carrier, x, y, end=end, dur=2.0)
        self._advance(2.0)
        dx, dy = flip(*end)
        if self.rng.random() < 0.4:
            winner = self._nearest(side, end[0], end[1], in_possession=True)[0]
            self.ball, self.carrier = end, winner
            self.chain += 1
        else:
            winner = self._nearest(other(side), dx, dy, in_possession=True)[0]
            self._change_possession(other(side), dx, dy, winner, eid)

    def _foul(self, fouled_side: str, fouler: Player, x: float, y: float) -> None:
        """Foul by `fouler` at (x, y) in the fouled side's attacking frame."""
        fx, fy = flip(x, y)
        foul_id = self._emit("foul", other(fouled_side), fouler, fx, fy, victim=self.carrier.id)
        st = self.sides[other(fouled_side)]
        roll = self.rng.random()
        card = None
        if roll < 0.004:
            card = "red"
        elif roll < 0.15:
            card = "second_yellow" if fouler.id in st.yellows else "yellow"
            st.yellows.add(fouler.id)
        if card:
            self._emit("card", other(fouled_side), fouler, fx, fy, outcome=card, related=foul_id)
            if card in ("red", "second_yellow"):
                st.on_pitch = [op for op in st.on_pitch if op.player is not fouler]
                st.sent_off.append(fouler.id)
        if in_box(x, y):
            self._set_restart("penalty", fouled_side, PITCH_LENGTH - 11, GOAL_Y)
        else:
            self._set_restart("free_kick", fouled_side, x, y)

    def _shot(self, p: float, *, penalty: bool = False, xg_scale: float = 1.0) -> None:
        side = self.poss
        me, opp = self.sides[side], self.sides[other(side)]
        x, y = self.ball
        shooter = self.carrier
        counter = self.ts < self.counter_until
        header = self.header_chance
        xg = expected_goals(x, y, header=header, big_chance=self.big_chance, counter=counter,
                            under_pressure=p > 0.6, penalty=penalty) * xg_scale
        keeper = opp.keeper().player
        goal_p = clamp(xg * (0.7 + 0.6 * shooter.finishing / 100) * (1.15 - 0.3 * keeper.keeping / 100)
                       * self._fatigue(side), 0.005, 0.95)
        tags = []
        if header:
            tags.append("header")
        if counter:
            tags.append("counter")
        if self.set_piece_shot:
            tags.append("set_piece")
        if penalty:
            tags.append("penalty")
        if xg >= 0.3:
            tags.append("big_chance")

        if self.rng.random() < goal_p:
            outcome = "goal"
        else:
            r = self.rng.random()
            outcome = "blocked" if r < 0.30 and not penalty else "off_target" if r < 0.73 else "saved"
        end = (PITCH_LENGTH, clamp(self.rng.gauss(GOAL_Y, 2.2 if outcome in ("goal", "saved") else 6), 24, 44))
        if outcome == "blocked":
            end = (x + (PITCH_LENGTH - x) * 0.3, y + (GOAL_Y - y) * 0.3)
        me.shots += 1
        me.xg += xg
        sid = self._emit("shot", side, shooter, x, y, end=end, outcome=outcome, dur=1.0, xg=xg, tags=tags,
                         related=self.last_pass_id, body_part="head" if header else "foot",
                         situation=self.set_piece_shot or ("counter" if counter else "open_play"))
        self._tag(self.last_pass_id, "key_pass")
        self._advance(1.0)
        self.header_chance = self.big_chance = False
        self.set_piece_shot = None

        if outcome == "goal":
            me.goals += 1
            self._tag(self.last_pass_id, "assist")
            self._emit("goal", side, shooter, *end, related=sid,
                       score={"home": self.sides["home"].goals, "away": self.sides["away"].goals})
            self._advance(self.rng.uniform(45, 70))
            self._set_restart("kickoff", other(side), PITCH_LENGTH / 2, GOAL_Y)
        elif outcome == "saved":
            gx, gy = flip(*end)
            self._emit("save", other(side), keeper, gx, gy, related=sid)
            if self.rng.random() < 0.3:
                self._set_restart("corner", side, PITCH_LENGTH - 0.5, y)
            else:
                self._advance(self.rng.uniform(4, 9))
                self._change_possession(other(side), 6.0, GOAL_Y, keeper, None)
        elif outcome == "blocked":
            bx, by = flip(*end)
            blocker = self._defender_at(side, *end)
            bid = self._emit("block", other(side), blocker, bx, by, related=sid)
            r = self.rng.random()
            if r < 0.4:
                self._set_restart("corner", side, PITCH_LENGTH - 0.5, y)
            elif r < 0.7:
                self.ball = clamp_to_pitch(end[0] - 4, end[1] + self.rng.gauss(0, 5))
                self.carrier = self._nearest(side, *self.ball, in_possession=True)[0]
            else:
                self._change_possession(other(side), bx, by, blocker, bid)
        else:
            self._set_restart("goal_kick", other(side), 5.5, GOAL_Y)


def score_of(sim: MatchSimulator) -> tuple[int, int]:
    return sim.sides["home"].goals, sim.sides["away"].goals
