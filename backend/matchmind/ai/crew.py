"""The MatchMind crew: specialised agents orchestrated with Microsoft Agent Framework.

Moment and recap pipeline (a WorkflowBuilder graph):

             +--> Analyst ----+
    Brief ---+                +--> Storyteller --> Fact-checker --> output
             +--> Tactician --+         ^               |
                                        +-- revision ---+

Analyst and Tactician run concurrently (fan-out / fan-in). The Fact-checker is
deterministic code: a draft that cites a number, name, minute or event that is
not in the fact packet goes back to the Storyteller with the exact issues. If
it still fails, the verified template narration is used instead, so nothing
unverified ever reaches a viewer.

Questions ("Ask the crew") go to a Host agent that pulls numbers through the
match-data tools (local functions or the MCP server), can consult the
Tactician as a sub-agent and can run what-if simulations. Every tool result is
captured by middleware and becomes the fact base for checking the answer.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import dataclass, field
from typing import Any

from agent_framework import (
    Agent,
    Executor,
    FunctionInvocationContext,
    WorkflowBuilder,
    WorkflowContext,
    function_middleware,
    handler,
)

from .. import tools as match_tools
from .personas import persona_brief
from .templates import narrate_moment, narrate_whatif, recap as template_recap
from .verifier import normalize_tags, verify

MAX_DRAFTS = 2

ANALYST = """You are the Analyst in MatchMind, an AI football match crew.
You receive a JSON fact packet. Pick the 3-5 numbers that best explain what happened and say in one short line each
what they show. Use only values that appear in the packet, written exactly as they appear. Add the evidence tag [#id]
of the event that supports a line when there is one. Bullet points only, no story, no adjectives."""

TACTICIAN = """You are the Tactician in MatchMind, an AI football match crew.
You receive a JSON fact packet. Explain WHY it happened in tactical terms: how the ball was won, the pattern
(pressing trap, counter-attack, overload, switch of play, set piece, crossing), and how it reflects each team's
formation and style from the packet. 2-4 bullet points. Use only facts in the packet - if the packet does not support
a claim, leave it out. Add evidence tags [#id] from the packet where relevant."""

STORYTELLER = """You are the Storyteller in MatchMind, an AI football match crew.
You turn the Analyst's and Tactician's notes into the final piece for a specific audience.
Rules:
- Use only facts from the packet and the notes. Never invent numbers, players, minutes or events.
- Keep evidence tags like [#123] right after the claim they support; they become replay links. Only use tags that
  appear in the packet or notes.
- Player and team names must be written exactly as in the packet.
- Only state a scoreline by copying it from a score field (score_before_this_moment / score_after_this_moment /
  final_score). Never work one out yourself.
- Do not add details the packet does not contain: which foot, the weather, the crowd, a player's feelings.
- One evidence tag per bracket, e.g. "[#40] [#45]" - never "[#40, #45]" or tags without a number.
- Return only the final text, no preamble."""

HOST = """You are the Host of MatchMind, an AI football match crew, answering a viewer's question about one match.
- Get every number from the tools. Never guess a statistic, minute or name.
- For "what if" questions (a team changing tactics or formation), call simulate_what_if and explain the result,
  including whether the effect is clear or not.
- For "why" questions you can consult the tactician tool.
- When you mention a specific action, add its evidence tag [#id] from the tool results.
- If the tools cannot answer the question, say so briefly.
- Only state scorelines exactly as the tools return them. Do not add details the tools did not return.
- One evidence tag per bracket, e.g. "[#40] [#45]".
- Write for the audience described, in the requested language. Keep it under 150 words."""


@dataclass
class Job:
    kind: str  # "moment" | "recap" | "whatif"
    packet: dict
    persona: str
    language: str
    roster: dict[str, str]
    trace: list[dict] = field(default_factory=list)

    @property
    def allowed_ids(self) -> set[int]:
        return set(self.packet.get("evidence_ids", []))


@dataclass
class Note:
    role: str
    text: str
    job: Job


@dataclass
class Draft:
    text: str
    job: Job
    notes: list[Note]
    attempt: int


@dataclass
class Revision:
    draft: Draft
    issues: list[str]


@dataclass
class CrewResult:
    text: str
    data: dict | None
    verdict: dict
    trace: list[dict]
    mode: str


def _packet_json(packet: dict) -> str:
    return json.dumps(packet, ensure_ascii=False, separators=(",", ":"))


def _parse_recap(text: str) -> dict | None:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict) or "article" not in data:
        return None
    data.setdefault("headline", "")
    data["social"] = [s for s in data.get("social", []) if isinstance(s, str)][:3]
    return data


def _recap_text(data: dict) -> str:
    return "\n".join([data.get("headline", ""), data.get("article", ""), *data.get("social", [])])


class Brief(Executor):
    """Producer step: frames the job and hands it to the specialists."""

    @handler
    async def brief(self, job: Job, ctx: WorkflowContext[Job]) -> None:
        what = {"moment": job.packet.get("moment", {}).get("title"), "recap": "full-match recap",
                "whatif": "what-if simulation"}[job.kind]
        job.trace.append({"agent": "Producer", "kind": "rules", "output": f"Brief: {what} for "
                          f"{job.persona} audience in {job.language}", "ms": 0})
        await ctx.send_message(job)


class Specialist(Executor):
    """Runs one LLM agent (Analyst or Tactician) on the fact packet."""

    def __init__(self, id: str, agent: Agent, role: str) -> None:
        super().__init__(id=id)
        self.agent = agent
        self.role = role

    @handler
    async def work(self, job: Job, ctx: WorkflowContext[Note]) -> None:
        t0 = time.perf_counter()
        task = {"moment": "this key moment", "recap": "the whole match",
                "whatif": "this what-if simulation (results of many re-simulations)"}[job.kind]
        response = await self.agent.run(f"Fact packet for {task}:\n{_packet_json(job.packet)}")
        job.trace.append({"agent": self.role, "kind": "llm", "output": response.text.strip(),
                          "ms": round(1000 * (time.perf_counter() - t0))})
        await ctx.send_message(Note(self.role, response.text.strip(), job))


class Storyteller(Executor):
    def __init__(self, id: str, agent: Agent) -> None:
        super().__init__(id=id)
        self.agent = agent

    def _task(self, job: Job) -> str:
        if job.kind == "recap":
            return ("Write the full-time package as JSON with keys: \"headline\" (max 12 words), \"article\" "
                    "(120-180 words, with evidence tags), \"social\" (list of 3 short posts, max 200 characters each).")
        if job.kind == "whatif":
            return ("Explain this what-if simulation to the audience: what was changed and when, how the win chance, expected points and xG for/against moved, and whether the effect is clear according to the verdict and 95% interval. Do not overstate a result marked 'no clear effect'.")
        return "Write the commentary for this moment."

    @handler
    async def compose(self, notes: list[Note], ctx: WorkflowContext[Draft]) -> None:
        job = notes[0].job
        t0 = time.perf_counter()
        notes_text = "\n\n".join(f"{n.role} notes:\n{n.text}" for n in notes)
        prompt = (f"{persona_brief(job.persona, job.language)}\n{self._task(job)}\n\nFact packet:\n"
                  f"{_packet_json(job.packet)}\n\n{notes_text}")
        response = await self.agent.run(prompt)
        text = normalize_tags(response.text)
        job.trace.append({"agent": "Storyteller", "kind": "llm", "output": text, "attempt": 1,
                          "ms": round(1000 * (time.perf_counter() - t0))})
        await ctx.send_message(Draft(text, job, notes, 1))

    @handler
    async def revise(self, rev: Revision, ctx: WorkflowContext[Draft]) -> None:
        job = rev.draft.job
        t0 = time.perf_counter()
        prompt = (f"{persona_brief(job.persona, job.language)}\n{self._task(job)}\n\nFact packet:\n"
                  f"{_packet_json(job.packet)}\n\nYour previous draft:\n{rev.draft.text}\n\n"
                  "The fact-checker rejected it for these reasons:\n- " + "\n- ".join(rev.issues) +
                  "\n\nRewrite it. Fix or remove every unsupported claim. Keep everything else.")
        response = await self.agent.run(prompt)
        attempt = rev.draft.attempt + 1
        text = normalize_tags(response.text)
        job.trace.append({"agent": "Storyteller", "kind": "llm", "output": text,
                          "attempt": attempt, "ms": round(1000 * (time.perf_counter() - t0))})
        await ctx.send_message(Draft(text, job, rev.draft.notes, attempt))


class FactChecker(Executor):
    """Deterministic verification against the fact packet."""

    @handler
    async def check(self, draft: Draft, ctx: WorkflowContext[Revision, CrewResult]) -> None:
        job = draft.job
        data = _parse_recap(draft.text) if job.kind == "recap" else None
        text = _recap_text(data) if data else draft.text
        if job.kind == "recap" and data is None:
            verdict_dict = {"passed": False, "issues": ["recap was not valid JSON with an article"],
                            "checked_numbers": 0, "checked_names": 0, "evidence": []}
        else:
            verdict_dict = verify(text, job.packet, job.roster, job.allowed_ids).to_dict()
        job.trace.append({"agent": "Fact-checker", "kind": "code", "attempt": draft.attempt,
                          "output": "passed" if verdict_dict["passed"] else "; ".join(verdict_dict["issues"]),
                          "passed": verdict_dict["passed"], "ms": 0})
        if verdict_dict["passed"]:
            await ctx.yield_output(CrewResult(draft.text if data is None else data["article"], data, verdict_dict,
                                              job.trace, "ai"))
        elif draft.attempt < MAX_DRAFTS:
            await ctx.send_message(Revision(draft, verdict_dict["issues"]))
        else:
            fallback = _template(job)
            job.trace.append({"agent": "Fact-checker", "kind": "code", "output": "AI draft rejected twice - "
                              "using the verified template narration instead", "passed": True, "ms": 0})
            await ctx.yield_output(fallback)


def _template(job: Job) -> CrewResult:
    if job.kind == "recap":
        data = template_recap(job.packet)
        text = _recap_text(data)
        verdict = verify(text, job.packet, job.roster, job.allowed_ids).to_dict()
        return CrewResult(data["article"], data, verdict, job.trace, "template")
    if job.kind == "whatif":
        text = narrate_whatif(job.packet, job.persona)
    else:
        text = narrate_moment(job.packet, job.persona)
    verdict = verify(text, job.packet, job.roster, job.allowed_ids).to_dict()
    return CrewResult(text, None, verdict, job.trace, "template")


class Crew:
    def __init__(self, client: Any | None, mcp_tool: Any | None = None) -> None:
        self.client = client
        self.mcp_tool = mcp_tool
        if client is None:
            return
        self.analyst = Agent(client, ANALYST, name="Analyst")
        self.tactician = Agent(client, TACTICIAN, name="Tactician")
        self.storyteller = Agent(client, STORYTELLER, name="Storyteller")

    @property
    def ai_enabled(self) -> bool:
        return self.client is not None

    def _workflow(self):
        brief = Brief(id="producer")
        analyst = Specialist("analyst", self.analyst, "Analyst")
        tactician = Specialist("tactician", self.tactician, "Tactician")
        story = Storyteller("storyteller", self.storyteller)
        check = FactChecker(id="fact_checker")
        return (
            WorkflowBuilder(start_executor=brief, name="matchmind-crew")
            .add_fan_out_edges(brief, [analyst, tactician])
            .add_fan_in_edges([analyst, tactician], story)
            .add_edge(story, check)
            .add_edge(check, story)
            .build()
        )

    async def run_job(self, job: Job) -> CrewResult:
        if not self.ai_enabled:
            job.trace.append({"agent": "Producer", "kind": "rules", "output": "No AI model configured - "
                              "template narration", "ms": 0})
            return _template(job)
        for attempt in range(3):
            try:
                result = await self._workflow().run(job)
                outputs = result.get_outputs()
                if outputs:
                    return outputs[-1]
                job.trace.append({"agent": "Producer", "kind": "rules", "output": "workflow produced no output",
                                  "ms": 0})
                break
            except Exception as exc:  # model outage, quota, network: degrade, never break the demo
                if "RateLimit" in type(exc).__name__ or "429" in str(exc):
                    if attempt < 2:
                        await asyncio.sleep(4 * (attempt + 1))
                        continue
                job.trace.append({"agent": "Producer", "kind": "rules", "output": f"AI unavailable "
                                  f"({type(exc).__name__}: {str(exc)[:200]}) - using verified template", "ms": 0})
                break
        return _template(job)

    # ------------------------------------------------------------ Q&A

    async def ask(self, match_id: str, question: str, persona: str, language: str,
                  roster: dict[str, str]) -> dict:
        if not self.ai_enabled:
            return {"answer": "The AI crew needs a language model to answer free questions. The stats, moments "
                              "and what-if lab all work without one.", "verdict": None, "trace": [], "mode": "template"}
        evidence = match_tools.start_evidence_log()
        trace: list[dict] = []

        @function_middleware
        async def capture(context: FunctionInvocationContext, call_next) -> None:
            t0 = time.perf_counter()
            await call_next()
            result = context.result
            if not isinstance(result, (dict, list)):
                try:
                    result = json.loads(str(result))
                except (TypeError, ValueError):
                    result = str(result)
            if not any(item.get("result") == result for item in evidence):
                evidence.append({"tool": context.function.name, "result": result})
            trace.append({"agent": "Host", "kind": "tool", "tool": context.function.name,
                          "args": _safe_args(context), "ms": round(1000 * (time.perf_counter() - t0))})

        data_tools = [self.mcp_tool] if self.mcp_tool is not None else list(match_tools.ALL_TOOLS)
        tactician = Agent(self.client, TACTICIAN + "\nUse the tools to fetch facts before answering.",
                          name="Tactician", tools=data_tools, middleware=[capture])
        host = Agent(self.client, HOST, name="Host", middleware=[capture], tools=[
            *data_tools,
            tactician.as_tool(name="consult_tactician",
                              description="Ask the Tactician agent a 'why' question about this match.",
                              arg_name="question"),
        ])
        prompt = (f"Match id: {match_id}\n{persona_brief(persona, language)}\nViewer question: {question}")
        t0 = time.perf_counter()
        try:
            response = await host.run(prompt)
        except Exception as exc:
            return {"answer": f"The crew could not reach the AI model ({type(exc).__name__}). Try again shortly.",
                    "verdict": None, "trace": trace, "mode": "error"}
        answer = normalize_tags(response.text)
        trace.append({"agent": "Host", "kind": "llm", "output": answer, "ms": round(1000 * (time.perf_counter() - t0))})
        facts = {"tool_results": [e["result"] for e in evidence], "overview": match_tools.match_overview(match_id)}
        ids = _ids_in(facts)
        verdict = verify(answer, facts, roster, ids)
        if not verdict.passed:
            retry = await host.run(prompt + "\n\nYour previous answer was rejected by the fact-checker:\n- "
                                   + "\n- ".join(verdict.issues) + "\nAnswer again using only tool results.")
            answer = normalize_tags(retry.text)
            facts["tool_results"] = [e["result"] for e in evidence]
            verdict = verify(answer, facts, roster, _ids_in(facts))
            trace.append({"agent": "Host", "kind": "llm", "output": answer, "attempt": 2, "ms": 0})
        trace.append({"agent": "Fact-checker", "kind": "code", "passed": verdict.passed,
                      "output": "passed" if verdict.passed else "; ".join(verdict.issues), "ms": 0})
        return {"answer": answer, "verdict": verdict.to_dict(), "trace": trace, "mode": "ai"}


def _safe_args(context: FunctionInvocationContext) -> dict:
    args = getattr(context, "arguments", None)
    try:
        if hasattr(args, "model_dump"):
            return args.model_dump()
        return dict(args or {})
    except (TypeError, ValueError):
        return {}


def _ids_in(obj: Any) -> set[int]:
    ids: set[int] = set()

    def walk(o: Any, key: str = "") -> None:
        if isinstance(o, dict):
            for k, v in o.items():
                walk(v, k)
        elif isinstance(o, list):
            for v in o:
                walk(v, key)
        elif isinstance(o, int) and key in ("id", "event_id", "evidence", "evidence_ids", "event_ids"):
            ids.add(o)

    walk(obj)
    return ids
