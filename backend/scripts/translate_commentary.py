"""Translate the play-by-play commentary templates with the Microsoft Foundry model.

Writes matchmind/commentary_i18n.json: {lang: {kind: [variant, ...]}}. Placeholders like {player} stay as they are.

Usage: python scripts/translate_commentary.py [lang ...]   (default: all non-English)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from translate_ui import KEEP, client  # noqa: E402

from matchmind.ai.personas import LANGUAGES  # noqa: E402
from matchmind.commentary import I18N, TEMPLATES  # noqa: E402

PROMPT = """You write live football (soccer) TV commentary in {language}.
Translate each short commentary call in this JSON (values are lists of variants) into {language}, the way a
real play-by-play commentator in that language would say it on air: short, natural, lively.
Rules: keep every key and the same number of variants; keep placeholders like {{player}}, {{team}}, {{home_score}}
exactly; return only the JSON object."""


def translate(cli, lang: str) -> dict[str, list[str]]:
    import os

    resp = cli.chat.completions.create(
        model=os.environ["AZURE_OPENAI_DEPLOYMENT"],
        temperature=0.3,
        response_format={"type": "json_object"},
        messages=[{"role": "system", "content": PROMPT.format(language=LANGUAGES[lang])},
                  {"role": "user", "content": json.dumps(TEMPLATES, ensure_ascii=False)}],
    )
    out = json.loads(resp.choices[0].message.content)
    fixed: dict[str, list[str]] = {}
    for kind, variants in TEMPLATES.items():
        got = out.get(kind)
        if not isinstance(got, list) or len(got) != len(variants):
            continue
        ok = [t if isinstance(t, str) and sorted(KEEP.findall(t)) == sorted(KEEP.findall(v)) else v for t, v in zip(got, variants)]
        fixed[kind] = ok
    return fixed


def main(langs: list[str]) -> None:
    data = json.loads(I18N.read_text(encoding="utf-8")) if I18N.exists() else {}
    cli = client()
    for lang in langs:
        data[lang] = translate(cli, lang)
        print(f"{lang}: {len(data[lang])}/{len(TEMPLATES)} calls")
    I18N.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1:] or [k for k in LANGUAGES if k != "en"])
