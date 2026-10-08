"""Formation templates and the team-shape model.

Each slot is (role, x, y) in the attacking frame for a team in possession with
the ball on the centre spot. `shape_target` moves a slot with the ball, which
drives both receiver choice in the simulator and player movement in tracking.
"""

from __future__ import annotations

from .pitch import GOAL_Y, PITCH_LENGTH, clamp

FORMATIONS: dict[str, list[tuple[str, float, float]]] = {
    "4-3-3": [
        ("GK", 6, 34), ("LB", 38, 8), ("LCB", 30, 24), ("RCB", 30, 44), ("RB", 38, 60),
        ("LCM", 54, 21), ("DM", 45, 34), ("RCM", 54, 47),
        ("LW", 74, 8), ("ST", 80, 34), ("RW", 74, 60),
    ],
    "4-2-3-1": [
        ("GK", 6, 34), ("LB", 37, 9), ("LCB", 29, 25), ("RCB", 29, 43), ("RB", 37, 59),
        ("LDM", 46, 27), ("RDM", 46, 41),
        ("LW", 68, 10), ("AM", 64, 34), ("RW", 68, 58), ("ST", 80, 34),
    ],
    "4-4-2": [
        ("GK", 6, 34), ("LB", 36, 9), ("LCB", 28, 25), ("RCB", 28, 43), ("RB", 36, 59),
        ("LM", 58, 9), ("LCM", 50, 27), ("RCM", 50, 41), ("RM", 58, 59),
        ("LST", 76, 27), ("RST", 76, 41),
    ],
    "3-5-2": [
        ("GK", 6, 34), ("LCB", 28, 20), ("CB", 25, 34), ("RCB", 28, 48),
        ("LWB", 55, 6), ("LCM", 52, 24), ("DM", 44, 34), ("RCM", 52, 44), ("RWB", 55, 62),
        ("LST", 76, 28), ("RST", 76, 40),
    ],
    "3-4-3": [
        ("GK", 6, 34), ("LCB", 29, 20), ("CB", 26, 34), ("RCB", 29, 48),
        ("LWB", 56, 6), ("LCM", 49, 27), ("RCM", 49, 41), ("RWB", 56, 62),
        ("LW", 74, 12), ("ST", 80, 34), ("RW", 74, 56),
    ],
    "5-3-2": [
        ("GK", 6, 34), ("LWB", 34, 6), ("LCB", 26, 20), ("CB", 23, 34), ("RCB", 26, 48), ("RWB", 34, 62),
        ("LCM", 48, 23), ("DM", 42, 34), ("RCM", 48, 45),
        ("LST", 72, 28), ("RST", 72, 40),
    ],
}

DEFENSIVE_ROLES = {"GK", "LB", "RB", "LCB", "RCB", "CB", "LWB", "RWB"}
MIDFIELD_ROLES = {"DM", "LDM", "RDM", "LCM", "RCM", "CM", "AM", "LM", "RM"}
ATTACKING_ROLES = {"LW", "RW", "ST", "LST", "RST"}


def role_group(role: str) -> str:
    if role == "GK":
        return "GK"
    if role in DEFENSIVE_ROLES:
        return "DEF"
    if role in MIDFIELD_ROLES:
        return "MID"
    return "ATT"


def shape_target(
    base_x: float,
    base_y: float,
    role: str,
    ball_x: float,
    ball_y: float,
    in_possession: bool,
    width: float,
    line_height: float,
) -> tuple[float, float]:
    """Where a slot wants to stand given the ball (all in this team's attacking frame)."""
    if role == "GK":
        x = 5.0 + (ball_x - PITCH_LENGTH / 2) * 0.12 + line_height * 6
        y = GOAL_Y + (ball_y - GOAL_Y) * 0.15
        return clamp(x, 2.0, 22.0), clamp(y, 26.0, 42.0)

    if in_possession:
        x = base_x + (ball_x - PITCH_LENGTH / 2) * 0.55 + (line_height - 0.5) * 8
        # The opponents' back line (and offside) stops attackers drifting onto the goal line.
        group = role_group(role)
        x = min(x, 91.0 if group == "ATT" else 86.0 if group == "MID" else 70.0)
        y = GOAL_Y + (base_y - GOAL_Y) * (0.85 + 0.35 * width) + (ball_y - GOAL_Y) * 0.22
    else:
        x = base_x * 0.82 + (ball_x - PITCH_LENGTH / 2) * 0.5 + (line_height - 0.5) * 12 - 4
        y = GOAL_Y + (base_y - GOAL_Y) * 0.68 + (ball_y - GOAL_Y) * 0.35
    return clamp(x, 3.0, PITCH_LENGTH - 3.0), clamp(y, 2.0, 66.0)
