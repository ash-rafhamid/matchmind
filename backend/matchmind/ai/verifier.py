"""Deterministic fact-checker for anything the crew writes.

The rule is simple: every number, player name and evidence tag in a piece of
generated text must be traceable to the fact packet the agents were given.
No model is involved, so the check itself cannot hallucinate.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

NUMBER = re.compile(r"(?<![\w#])(\d+(?:[.,]\d+)?)(\s?%)?")
EVIDENCE = re.compile(r"\[#(\d+)\]")
CLOCK = re.compile(r"\b(\d{1,3})(?:\+(\d{1,2}))?['’′]")
SCORELINE = re.compile(r"(?<![\d.,])(\d{1,2})\s?[-–]\s?(\d{1,2})(?![\d.,]\d)")
ALWAYS_OK = {0.0, 1.0, 2.0, 3.0, 11.0, 45.0, 90.0}  # football vocabulary: one-two, 3 points, 11 v 11, halves


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


def _collect(obj: object, numbers: set[float], strings: set[str]) -> None:
    if isinstance(obj, bool) or obj is None:
        return
    if isinstance(obj, (int, float)):
        numbers.add(float(obj))
    elif isinstance(obj, str):
        strings.add(obj)
        for m in NUMBER.finditer(obj):
            numbers.add(float(m.group(1).replace(",", ".")))
    elif isinstance(obj, dict):
        for v in obj.values():
            _collect(v, numbers, strings)
    elif isinstance(obj, (list, tuple, set)):
        for v in obj:
            _collect(v, numbers, strings)


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
    """Check `text` against `packet`. `roster` maps player id -> name for the whole match."""
    numbers: set[float] = set()
    strings: set[str] = set()
    _collect(packet, numbers, strings)
    issues: list[str] = []

    # Minutes like 73' or 90+2' must exist in the packet's clocks.
    clocks = {s for s in strings if CLOCK.fullmatch(s.strip())}
    clock_minutes = set()
    for c in clocks:
        m = CLOCK.fullmatch(c.strip())
        if m:
            clock_minutes.add(float(m.group(1)))
            if m.group(2):
                clock_minutes.add(float(m.group(2)))
    def check_clock(m: re.Match) -> str:
        minute = float(m.group(1))
        if minute not in clock_minutes and minute not in ALWAYS_OK and not _supported(minute, numbers):
            issues.append(f"minute {m.group(0)} does not match any event in the packet")
        return " "

    def check_score(m: re.Match) -> str:
        if not (_supported(float(m.group(1)), numbers) and _supported(float(m.group(2)), numbers)):
            issues.append(f"scoreline {m.group(0)} is not supported")
        return " "

    # Blank out each checked span in place so later passes never see half of it.
    stripped = CLOCK.sub(check_clock, text)
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

    # Any player of this match who is named must be in the packet.
    allowed_names = {s for s in strings if s in set(roster.values())}
    named = 0
    for name in set(roster.values()):
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
