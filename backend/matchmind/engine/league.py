"""A fictional league: clubs, tactical DNA and generated squads.

Everything here is invented. Clubs differ in formation and in six tactical
dials that the simulator reads, so different pairings produce recognisably
different matches.
"""

from __future__ import annotations

import random
from dataclasses import asdict, dataclass, field, replace

from .formations import FORMATIONS, role_group


@dataclass
class Player:
    id: str
    name: str
    number: int
    role: str
    passing: int
    finishing: int
    dribbling: int
    pace: int
    defending: int
    keeping: int

    @property
    def group(self) -> str:
        return role_group(self.role)


@dataclass
class TeamDNA:
    """Tactical dials, each 0..1."""

    formation: str
    press: float  # how high and hard they press without the ball
    tempo: float  # speed of ball circulation
    directness: float  # preference for long / vertical passes
    width: float  # how wide they stretch in possession
    line_height: float  # height of the defensive line
    counter: float  # urge to attack fast after winning the ball

    def describe(self) -> list[str]:
        traits = []
        if self.press >= 0.7:
            traits.append("high press")
        elif self.press <= 0.3:
            traits.append("low block")
        if self.tempo >= 0.7:
            traits.append("quick circulation")
        if self.directness >= 0.65:
            traits.append("direct, vertical passing")
        elif self.directness <= 0.35:
            traits.append("patient short passing")
        if self.width >= 0.7:
            traits.append("wide, crossing play")
        if self.line_height >= 0.7:
            traits.append("high defensive line")
        elif self.line_height <= 0.3:
            traits.append("deep defensive line")
        if self.counter >= 0.7:
            traits.append("dangerous on the counter")
        return traits


@dataclass
class Team:
    id: str
    name: str
    short: str
    primary: str
    secondary: str
    coach: str
    dna: TeamDNA
    quality: float
    players: list[Player] = field(default_factory=list)  # 11 starters then subs

    @property
    def starters(self) -> list[Player]:
        return self.players[:11]

    @property
    def bench(self) -> list[Player]:
        return self.players[11:]

    def with_dna(self, **changes: object) -> "Team":
        return replace(self, dna=replace(self.dna, **changes))

    def to_dict(self) -> dict:
        d = asdict(self)
        d["traits"] = self.dna.describe()
        return d


FIRST_NAMES = [
    "Aiden", "Kofi", "Mateo", "Rafael", "Yusuf", "Liam", "Tomas", "Emeka", "Joon", "Ilias",
    "Callum", "Sami", "Andre", "Nico", "Darius", "Felix", "Hamza", "Luca", "Oskar", "Tariq",
    "Bruno", "Kenji", "Marek", "Idris", "Jonah", "Elias", "Rory", "Malik", "Teo", "Ade",
    "Gabriel", "Viktor", "Ravi", "Leon", "Omar", "Dylan", "Mason", "Ezra", "Kian", "Arlo",
]
LAST_NAMES = [
    "Okafor", "Lindqvist", "Moreau", "Castillo", "Haddad", "Brennan", "Novak", "Mensah", "Park",
    "Varga", "Whitlock", "Duarte", "Kowalski", "Achebe", "Fairweather", "Romano", "Sato", "Delacroix",
    "Ashworth", "Petrov", "Quinlan", "Abara", "Holm", "Iversen", "Marlowe", "Santos", "Thorne",
    "Adeyemi", "Kerr", "Lindgren", "Morales", "Nakamura", "Osei", "Pryce", "Rahman", "Strand",
    "Valdez", "Whitfield", "Yilmaz", "Zielinski", "Barros", "Coleman", "Dumont", "Esposito",
]

# Attribute centre per role group: passing, finishing, dribbling, pace, defending, keeping
_ROLE_PROFILE = {
    "GK": (55, 10, 25, 45, 30, 78),
    "DEF": (66, 35, 52, 70, 76, 10),
    "MID": (77, 55, 70, 68, 62, 10),
    "ATT": (70, 77, 77, 79, 35, 10),
}

_BENCH_ROLES = ["GK", "CB", "CM", "RW", "ST"]


_USED_NAMES: set[str] = set()  # names are unique across the whole league


def _make_players(team_id: str, formation: str, quality: float, seed: int) -> list[Player]:
    rng = random.Random(seed)
    roles = [slot[0] for slot in FORMATIONS[formation]] + _BENCH_ROLES
    used_numbers: set[int] = set()
    players = []
    for i, role in enumerate(roles):
        group = role_group(role)
        centre = _ROLE_PROFILE[group]
        boost = (quality - 0.5) * 20 - (6 if i >= 11 else 0)
        attrs = [int(max(20, min(95, rng.gauss(c + boost, 5)))) for c in centre]
        while True:
            name = f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}"
            if name not in _USED_NAMES:
                _USED_NAMES.add(name)
                break
        preferred = {"GK": 1, "DEF": 4, "MID": 8, "ATT": 9}[group]
        number = preferred if preferred not in used_numbers else rng.randint(2, 35)
        while number in used_numbers:
            number = rng.randint(2, 35)
        used_numbers.add(number)
        players.append(Player(f"{team_id}-{number}", name, number, role, *attrs))
    return players


def _club(id: str, name: str, short: str, primary: str, secondary: str, coach: str,
          quality: float, dna: TeamDNA, seed: int) -> Team:
    team = Team(id, name, short, primary, secondary, coach, dna, quality)
    team.players = _make_players(id, dna.formation, quality, seed)
    return team


def build_league() -> dict[str, Team]:
    _USED_NAMES.clear()
    clubs = [
        _club("RED", "Redmond Rovers", "RED", "#c8102e", "#ffffff", "Ilse Marchetti", 0.62,
              TeamDNA("4-3-3", press=0.82, tempo=0.74, directness=0.48, width=0.6, line_height=0.78, counter=0.66), 11),
        _club("HAR", "Harbour City", "HAR", "#5fb3e6", "#0b2545", "Tomasz Rhee", 0.64,
              TeamDNA("4-2-3-1", press=0.6, tempo=0.62, directness=0.28, width=0.55, line_height=0.62, counter=0.4), 22),
        _club("IRO", "Ironvale Athletic", "IRO", "#1d1d1d", "#f2c230", "Dominic Kale", 0.52,
              TeamDNA("5-3-2", press=0.22, tempo=0.45, directness=0.66, width=0.4, line_height=0.25, counter=0.86), 33),
        _club("WES", "Westport Albion", "WES", "#1f7a3d", "#f5f5f5", "Grace Oduya", 0.5,
              TeamDNA("4-4-2", press=0.45, tempo=0.5, directness=0.8, width=0.62, line_height=0.45, counter=0.55), 44),
        _club("KIN", "Kingsmoor FC", "KIN", "#13294b", "#e4002b", "Pablo Iriarte", 0.55,
              TeamDNA("4-4-2", press=0.5, tempo=0.55, directness=0.5, width=0.85, line_height=0.5, counter=0.45), 55),
        _club("SEA", "Seabrook Town", "SEA", "#f36c21", "#14213d", "Mara Lindholm", 0.57,
              TeamDNA("3-4-3", press=0.66, tempo=0.68, directness=0.42, width=0.72, line_height=0.6, counter=0.6), 66),
    ]
    return {c.id: c for c in clubs}
