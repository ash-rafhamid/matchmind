"""Translate the web app's interface strings with the Microsoft Foundry model.

Reads frontend/src/i18n/en.json and writes one JSON file per language next to
it. Placeholders like {team} and symbols (→ ↓ ✓ ▶ ·) are kept; club and
player names are never in these strings.

Usage: python scripts/translate_ui.py [lang ...]   (default: all non-English)
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

from matchmind.ai.personas import LANGUAGES  # noqa: E402

I18N = ROOT.parent / "frontend" / "src" / "i18n"
KEEP = re.compile(r"\{\w+\}")

PROMPT = """You localise the interface of MatchMind, a football (soccer) app where an AI crew explains matches.
Translate every JSON value into {language}. Rules:
- Keep every key exactly. Return only the JSON object.
- Keep placeholders like {{team}}, {{n}}, {{lang}} unchanged.
- Keep symbols and arrows (→ ↓ ↗ ✓ ✕ ▶ ♪ ■ ↺ · / %) where they are.
- Keep technical terms people use in football broadcasts: xG, PPDA, MCP, AI, 3D, Hz. Keep "MatchMind".
- Use natural, short, broadcast-style wording a fan would expect; football terms as used by fans in that language.
- Lowercase/uppercase like the source does.
"""


def client():
    import os

    from openai import AzureOpenAI

    return AzureOpenAI(azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"], api_key=os.environ["AZURE_OPENAI_API_KEY"],
                       api_version=os.environ.get("AZURE_OPENAI_API_VERSION", "2024-10-21"))


def translate(cli, src: dict[str, str], lang: str) -> dict[str, str]:
    import os

    resp = cli.chat.completions.create(
        model=os.environ["AZURE_OPENAI_DEPLOYMENT"],
        temperature=0.2,
        response_format={"type": "json_object"},
        messages=[{"role": "system", "content": PROMPT.format(language=LANGUAGES[lang])},
                  {"role": "user", "content": json.dumps(src, ensure_ascii=False)}],
    )
    out = json.loads(resp.choices[0].message.content)
    fixed = {}
    for k, v in src.items():
        t = out.get(k)
        # fall back to English for anything missing or with broken placeholders
        if not isinstance(t, str) or sorted(KEEP.findall(t)) != sorted(KEEP.findall(v)):
            t = v
        fixed[k] = t
    return fixed


def main(langs: list[str]) -> None:
    src = json.loads((I18N / "en.json").read_text(encoding="utf-8"))
    cli = client()
    for lang in langs:
        path = I18N / f"{lang}.json"
        merged: dict[str, str] = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        merged = {k: v for k, v in merged.items() if k in src}
        items = [(k, v) for k, v in src.items() if k not in merged]  # only what is new or missing
        for i in range(0, len(items), 70):  # small batches keep the model precise
            merged.update(translate(cli, dict(items[i:i + 70]), lang))
        merged = {k: merged.get(k, v) for k, v in src.items()}
        path.write_text(json.dumps(merged, ensure_ascii=False, indent=1), encoding="utf-8")
        kept = sum(merged[k] == src[k] for k in src)
        print(f"{lang}: {len(merged)} strings ({kept} left in English)")


if __name__ == "__main__":
    main(sys.argv[1:] or [k for k in LANGUAGES if k != "en"])
