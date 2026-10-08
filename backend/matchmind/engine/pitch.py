"""Pitch geometry and the two shot/possession value models used everywhere.

Coordinates are metres on a 105 x 68 pitch. Inside the simulator every team
works in its own *attacking frame* (it always attacks towards x = 105, and
small y is its left flank). Stored events use the *absolute frame*, where the
home team attacks towards x = 105 for the whole match.
"""

from __future__ import annotations

import math

PITCH_LENGTH = 105.0
PITCH_WIDTH = 68.0
GOAL_WIDTH = 7.32
GOAL_X = PITCH_LENGTH
GOAL_Y = PITCH_WIDTH / 2

BOX_X = PITCH_LENGTH - 16.5
BOX_Y_MIN = GOAL_Y - 20.16
BOX_Y_MAX = GOAL_Y + 20.16


def clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def clamp_to_pitch(x: float, y: float) -> tuple[float, float]:
    return clamp(x, 0.5, PITCH_LENGTH - 0.5), clamp(y, 0.5, PITCH_WIDTH - 0.5)


def to_absolute(x: float, y: float, is_home: bool) -> tuple[float, float]:
    """Attacking frame -> absolute frame (home attacks right)."""
    if is_home:
        return x, y
    return PITCH_LENGTH - x, PITCH_WIDTH - y


def flip(x: float, y: float) -> tuple[float, float]:
    """Swap between the two teams' attacking frames."""
    return PITCH_LENGTH - x, PITCH_WIDTH - y


def distance_to_goal(x: float, y: float) -> float:
    return math.hypot(GOAL_X - x, GOAL_Y - y)


def goal_angle(x: float, y: float) -> float:
    """Opening angle (radians) between the posts, seen from (x, y)."""
    dx = GOAL_X - x
    dy = abs(GOAL_Y - y)
    half = GOAL_WIDTH / 2
    if dx <= 0:
        return 0.0
    a = math.atan2(half - dy, dx) + math.atan2(half + dy, dx)
    return max(a, 0.0)


def in_box(x: float, y: float) -> bool:
    return x >= BOX_X and BOX_Y_MIN <= y <= BOX_Y_MAX


def expected_goals(
    x: float,
    y: float,
    *,
    header: bool = False,
    big_chance: bool = False,
    counter: bool = False,
    under_pressure: bool = False,
    penalty: bool = False,
) -> float:
    """Logistic xG on distance and angle, with situational adjustments.

    Calibrated so that open-play shots from the penalty spot are ~0.19, from
    the edge of the box ~0.07 and from 25 m ~0.04.
    """
    if penalty:
        return 0.76
    logit = -2.55 + 2.7 * goal_angle(x, y) - 0.06 * distance_to_goal(x, y)
    if header:
        logit -= 1.2
    if big_chance:
        logit += 0.45
    if counter:
        logit += 0.3
    if under_pressure:
        logit -= 0.3
    return 1.0 / (1.0 + math.exp(-logit))


def expected_threat(x: float, y: float) -> float:
    """Smooth stand-in for an xT grid: chance this location leads to a goal soon."""
    progress = clamp(x / PITCH_LENGTH, 0.0, 1.0)
    centrality = 1.0 - clamp(abs(y - GOAL_Y) / GOAL_Y, 0.0, 1.0)
    base = 0.004 + 0.06 * progress**4
    if x > 80:
        base += 0.10 * ((x - 80) / 25) ** 2 * (0.35 + 0.65 * centrality**2)
    return base * (0.55 + 0.45 * centrality)
