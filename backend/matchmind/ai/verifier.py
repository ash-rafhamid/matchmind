"""Deterministic fact-checker for anything the crew writes.

The rule is simple: every number, scoreline, formation, minute, player name and
evidence tag in a piece of generated text must be traceable to the fact packet
the agents were given. No model is involved, so the check itself cannot
hallucinate.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

NUMBER = re.compile(r"(?<![\w#])(\d+(?:[.,]\d+)?)(\s?%)?")
EVIDENCE = re.compile(r"\[#(\d+)\]")
CLOCK = re.compile(r"\b(\d{1,3})(?:\+(\d{1,2}))?['’′]")
FORMATION = re.compile(r"(?<![\d.,])\d-\d-\d(?:-\d)?(?![\d.,]\d)")
SCORELINE = re.compile(r"(?<![\d.,])(\d{1,2})\s?[-–]\s?(\d{1,2})(?![\d.,]\d)")
SCORE_STRING = re.compile(r"^(\d{1,2})-(\d{1,2})$")
CLUB = re.compile(r"\b(?:[A-Z][a-z]+ ){1,2}(?:City|Town|United|Rovers|Athletic|Albion|FC|Wanderers|County|Rangers)\b")
ALWAYS_OK = {0.0, 1.0, 2.0, 3.0, 10.0, 11.0, 45.0, 90.0, 100.0}  # one-two, 3 points, "4 in 10", 11 v 11, halves

MULTI_TAG = re.compile(r"\[\s*#?(\d+)(?:\s*[,;]\s*#?\d+)+\s*\]")
LOOSE_TAG = re.compile(r"\[(?!#\d)[^\]\n]{1,40}\]")


def normalize_tags(text: str) -> str:
    """Model output clean-up: "[#40, #45]" -> "[#40] [#45]", and drop bracket tags that are not event ids."""
    text = MULTI_TAG.sub(lambda m: " ".join(f"[#{i}]" for i in re.findall(r"\d+", m.group(0))), text)
    text = LOOSE_TAG.sub("", text)
    return re.sub(r"[ \t]{2,}", " ", text).replace(" .", ".").replace(" ,", ",").strip()


@dataclass
class Verdict:
    passed: bool
    issues: list[str] = field(default_factory=list)
    checked_numbers: int = 0
    checked_names: int = 0
    evidence: list[int] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"passed": self.passed, "issues": self.issues, "checked_numbers": self.checked_numbers,
                "checked_names": self.checked_names, "evidence": self.evidence}


@dataclass
class _Facts:
    numbers: set[float] = field(default_factory=set)
    strings: set[str] = field(default_factory=set)
    scores: set[tuple[int, int]] = field(default_factory=set)


def _collect(obj: object, facts: _Facts) -> None:
    if isinstance(obj, bool) or obj is None:
        return
    if isinstance(obj, (int, float)):
        facts.numbers.add(float(obj))
    elif isinstance(obj, str):
        facts.strings.add(obj)
        for m in NUMBER.finditer(obj):
            facts.numbers.add(float(m.group(1).replace(",", ".")))
        if s := SCORE_STRING.match(obj.strip()):
            facts.scores.add((int(s.group(1)), int(s.group(2))))
    elif isinstance(obj, dict):
        values = list(obj.values())
        # {"Team A": 2, "Team B": 1} or {"home": 2, "away": 1} is a scoreline
        if len(values) == 2 and all(isinstance(v, int) and not isinstance(v, bool) for v in values):
            facts.scores.add((values[0], values[1]))
        for v in values:
            _collect(v, facts)
    elif isinstance(obj, (list, tuple, set)):
        for v in obj:
            _collect(v, facts)


def _supported(value: float, allowed: set[float]) -> bool:
    if value in ALWAYS_OK:
        return True
    for a in allowed:
        # 0.634 may be written as 63.4%; a negative value may be written without its sign ("fell by 0.19")
        for c in (a, a * 100, abs(a), abs(a) * 100):
            if abs(c - value) < 1e-9 or any(round(c, nd) == value for nd in (0, 1, 2)):
                return True
    return False


def verify(text: str, packet: dict, roster: dict[str, str], allowed_event_ids: set[int] | None = None) -> Verdict:
    """Check `text` against `packet`. `roster` maps player id -> name for every player who could be named."""
    facts = _Facts()
    _collect(packet, facts)
    numbers, strings = facts.numbers, facts.strings
    issues: list[str] = []

    # Minutes like 73' or 90+2' must exist in the packet's clocks.
    clock_minutes = set()
    for s in strings:
        if m := CLOCK.fullmatch(s.strip()):
            clock_minutes.add(float(m.group(1)))
            if m.group(2):
                clock_minutes.add(float(m.group(2)))

    def check_clock(m: re.Match) -> str:
        minute = float(m.group(1))
        if minute not in clock_minutes and minute not in ALWAYS_OK and not _supported(minute, numbers):
            issues.append(f"minute {m.group(0)} does not match any event in the packet")
        return " "

    def check_formation(m: re.Match) -> str:
        if not any(m.group(0) in s for s in strings):
            issues.append(f"formation {m.group(0)} is not in the facts")
        return " "

    def check_score(m: re.Match) -> str:
        a, b = int(m.group(1)), int(m.group(2))
        if (a, b) not in facts.scores and (b, a) not in facts.scores:
            issues.append(f"scoreline {m.group(0)} does not match any score in the facts")
        return " "

    # Blank out each checked span in place so later passes never see half of it.
    stripped = CLOCK.sub(check_clock, text)
    stripped = FORMATION.sub(check_formation, stripped)
    stripped = SCORELINE.sub(check_score, stripped)

    evidence = [int(e) for e in EVIDENCE.findall(stripped)]
    stripped = EVIDENCE.sub(" ", stripped)
    if allowed_event_ids is not None:
        for e in evidence:
            if e not in allowed_event_ids:
                issues.append(f"evidence tag [#{e}] is not part of the supplied facts")

    checked = 0
    for m in NUMBER.finditer(stripped):
        value = float(m.group(1).replace(",", "."))
        checked += 1
        if not _supported(value, numbers):
            issues.append(f"number {m.group(0).strip()} is not in the facts")

    # Club names must be ones the facts mention (catches invented or misspelled teams).
    known_clubs = {m.group(0) for s in strings for m in CLUB.finditer(s)}
    for m in CLUB.finditer(text):
        name = m.group(0)
        if not any(name == k or name.endswith(k) for k in known_clubs):
            issues.append(f"team {name} is not in these facts")

    # Any player who is named must be in the packet.
    roster_names = set(roster.values())
    allowed_names = {s for s in strings if s in roster_names}
    named = 0
    for name in roster_names:
        surname = name.split()[-1]
        if name in text:
            named += 1
            if name not in allowed_names:
                issues.append(f"{name} is mentioned but is not part of these facts")
        elif re.search(rf"\b{re.escape(surname)}\b", text):
            if not any(n.split()[-1] == surname for n in allowed_names):
                named += 1
                issues.append(f"{surname} is mentioned but no player with that name is in these facts")

    return Verdict(passed=not issues, issues=sorted(set(issues)), checked_numbers=checked, checked_names=named,
                   evidence=evidence)
