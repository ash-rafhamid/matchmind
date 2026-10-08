"""Offline tests for the crew workflow using a scripted chat client."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent_framework import BaseChatClient, ChatResponse, Message  # noqa: E402

from matchmind import store  # noqa: E402
from matchmind.ai.crew import Crew, Job  # noqa: E402
from matchmind.ai.packets import moment_packet  # noqa: E402

MATCH = "red-iro-189"


class ScriptedClient(BaseChatClient):
    """Answers by agent role; the first Storyteller draft invents a number on purpose."""

    def __init__(self, good_story: str) -> None:
        super().__init__()
        self.good_story = good_story
        self.story_calls = 0

    def _inner_get_response(self, *, messages, stream, options, **kwargs):
        blob = " ".join(str(m.text) for m in messages) + str(options.get("instructions", ""))

        async def respond() -> ChatResponse:
            if "You are the Analyst" in blob:
                text = "- shot worth 0.2 xG"
            elif "You are the Tactician" in blob:
                text = "- came from a regain"
            else:
                self.story_calls += 1
                text = "What a goal after 37 passes and a 0.91 xG chance!" if self.story_calls == 1 else self.good_story
            return ChatResponse(messages=[Message("assistant", [text])])

        return respond()


def _job() -> Job:
    pkg = store.load(MATCH)
    moment = next(m for m in pkg["analytics"]["moments"] if m["type"] == "goal")
    return Job("moment", moment_packet(pkg, moment), "fan", "en", store.LEAGUE_ROSTER)


def test_revision_loop_fixes_hallucination() -> None:
    job = _job()
    shooter = job.packet["moment"]["facts"]["shooter"]
    good = f"{shooter} scores for {job.packet['moment']['team_name']} [#{job.packet['evidence_ids'][-1]}]!"
    client = ScriptedClient(good)
    result = asyncio.run(Crew(client).run_job(job))
    agents = [t["agent"] for t in result.trace]
    assert result.mode == "ai"
    assert result.verdict["passed"]
    assert result.text == good
    assert agents.count("Storyteller") == 2  # first draft rejected, second accepted
    assert {"Analyst", "Tactician"} <= set(agents)
    checks = [t for t in result.trace if t["agent"] == "Fact-checker"]
    assert not checks[0]["passed"] and "0.91" in checks[0]["output"]


def test_falls_back_to_template_when_drafts_keep_failing() -> None:
    job = _job()
    client = ScriptedClient("Still wrong: 0.91 xG and 37 passes.")
    result = asyncio.run(Crew(client).run_job(job))
    assert result.mode == "template"
    assert result.verdict["passed"]


def test_template_mode_without_model() -> None:
    result = asyncio.run(Crew(None).run_job(_job()))
    assert result.mode == "template" and result.verdict["passed"]
