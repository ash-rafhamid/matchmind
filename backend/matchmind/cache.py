"""Cache for crew output.

Runtime results go to data/cache. Results generated ahead of time for the
featured matches live in precomputed/ and ship with the app, so the first
viewer of a featured match gets an instant, already-verified story.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from . import store

RUNTIME = store.DATA_DIR.parent / "cache"
PRECOMPUTED = Path(__file__).resolve().parents[1] / "precomputed"


def make_key(provider: str, model: str | None, *parts: object) -> str:
    raw = "|".join(str(p) for p in parts) + f"|{provider}|{model}"
    return hashlib.sha1(raw.encode()).hexdigest()[:20]


def get(key: str) -> dict | None:
    for folder in (RUNTIME, PRECOMPUTED):
        path = folder / f"{key}.json"
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    return None


def put(key: str, value: dict, precomputed: bool = False) -> None:
    folder = PRECOMPUTED if precomputed else RUNTIME
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{key}.json").write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
