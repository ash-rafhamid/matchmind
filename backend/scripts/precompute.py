"""Generate and verify crew output for the featured matches ahead of time.

Writes to precomputed/, which ships with the app. Only stories that came from
the model AND passed the fact-checker are stored; anything else is left for
the live crew to handle on demand.

Usage: python scripts/precompute.py [lang ...]     (default: en)
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from matchmind import cache, store  # noqa: E402
from matchmind.ai.crew import Crew, Job  # noqa: E402
from matchmind.ai.llm import make_client  # noqa: E402
from matchmind.ai.packets import moment_packet, recap_packet  # noqa: E402
from matchmind.ai.personas import PERSONAS  # noqa: E402

PARALLEL = 2


def _result(r) -> dict:
    return {"text": r.text, "data": r.data, "verdict": r.verdict, "trace": r.trace, "mode": r.mode}


async def main(langs: list[str]) -> None:
    model = make_client()
    if not model.available:
        raise SystemExit("No model configured - set up backend/.env first")
    crew = Crew(model.client)
    sem = asyncio.Semaphore(PARALLEL)
    stats = {"stored": 0, "skipped": 0, "fallback": 0}

    async def one(key: str, job: Job) -> None:
        if cache.get(key):
            stats["skipped"] += 1
            return
        async with sem:
            r = await crew.run_job(job)
        if r.mode == "ai" and r.verdict["passed"]:
            cache.put(key, _result(r), precomputed=True)
            stats["stored"] += 1
        else:
            stats["fallback"] += 1

    tasks = []
    for summary in store.list_matches():
        if not summary["featured"]:
            continue
        pkg = store.load(summary["id"])
        mid = summary["id"]
        for lang in langs:
            for persona in PERSONAS:
                for m in pkg["analytics"]["moments"]:
                    key = cache.make_key(model.provider, model.model, "moment", mid, m["id"], persona, lang)
                    tasks.append(one(key, Job("moment", moment_packet(pkg, m), persona, lang, store.LEAGUE_ROSTER)))
                key = cache.make_key(model.provider, model.model, "recap", mid, persona, lang)
                tasks.append(one(key, Job("recap", recap_packet(pkg), persona, lang, store.LEAGUE_ROSTER)))

    t0 = time.perf_counter()
    print(f"{len(tasks)} jobs on {model.provider} / {model.model}")
    await asyncio.gather(*tasks)
    print(f"done in {time.perf_counter() - t0:.0f}s: {stats}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:] or ["en"]))
