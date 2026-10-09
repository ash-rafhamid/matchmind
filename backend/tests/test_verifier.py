"""The fact-checker must accept everything the templates say and reject invented facts."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from matchmind import store  # noqa: E402
from matchmind.ai.packets import moment_packet, recap_packet  # noqa: E402
from matchmind.ai.personas import PERSONAS  # noqa: E402
from matchmind.ai.templates import narrate_moment, narrate_whatif, recap  # noqa: E402
from matchmind.ai.verifier import verify  # noqa: E402
from matchmind.whatif import run_what_if  # noqa: E402

MATCHES = [m["id"] for m in store.list_matches()]


@pytest.mark.parametrize("match_id", MATCHES)
def test_templates_always_verify(match_id: str) -> None:
    pkg = store.load(match_id)
    for m in pkg["analytics"]["moments"]:
        packet = moment_packet(pkg, m)
        for persona in PERSONAS:
            text = narrate_moment(packet, persona)
            v = verify(text, packet, store.LEAGUE_ROSTER, set(packet["evidence_ids"]))
            assert v.passed, (m["title"], persona, text, v.issues)
    packet = recap_packet(pkg)
    r = recap(packet)
    text = "\n".join([r["headline"], r["article"], *r["social"]])
    assert verify(text, packet, store.LEAGUE_ROSTER, set(packet["evidence_ids"])).passed


def test_whatif_template_verifies() -> None:
    meta = store.load(MATCHES[0])["meta"]
    result = run_what_if(meta, "home", 60, {"press": 0.95, "formation": "3-4-3"}, runs=50)
    for persona in PERSONAS:
        text = narrate_whatif(result, persona)
        v = verify(text, result, store.LEAGUE_ROSTER, set())
        assert v.passed, (text, v.issues)


def test_rejects_invented_facts() -> None:
    pkg = store.load(MATCHES[0])
    moment = next(m for m in pkg["analytics"]["moments"] if m["type"] == "goal")
    packet = moment_packet(pkg, moment)
    outsider = next(n for pid, n in store.LEAGUE_ROSTER.items() if n not in pkg["meta"]["player_names"].values())
    issues = verify(f"A 0.83 xG chance created by {outsider} [#99999].", packet, store.LEAGUE_ROSTER,
                    set(packet["evidence_ids"])).issues
    assert any("0.83" in i for i in issues)
    assert any(outsider in i for i in issues)
    assert any("#99999" in i for i in issues)


def test_scorelines_must_match_a_real_score() -> None:
    pkg = store.load(MATCHES[0])
    first_goal = next(m for m in pkg["analytics"]["moments"] if m["type"] == "goal")
    packet = moment_packet(pkg, first_goal)
    after = list(packet["score_after_this_moment"].values())
    real = f"{after[0]}-{after[1]}"
    fake = "7-7"
    assert verify(f"It is now {real}.", packet, store.LEAGUE_ROSTER).passed
    assert not verify(f"That levels it at {fake}.", packet, store.LEAGUE_ROSTER).passed
    # formations are not scorelines, but they must still be real
    formation = pkg["meta"]["teams"]["home"]["dna"]["formation"]
    assert verify(f"They set up in a {formation}.", packet, store.LEAGUE_ROSTER).passed
    assert not verify("They set up in a 4-1-4-1.", packet, store.LEAGUE_ROSTER).passed
