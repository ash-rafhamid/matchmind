"""Who the crew is talking to, and in which language."""

from __future__ import annotations

PERSONAS: dict[str, dict[str, str]] = {
    "fan": {
        "label": "Casual fan",
        "style": "Warm and energetic, plain words, no jargon. If you use a stat, say what it means in a few words "
                 "(e.g. 'xG 0.42 - a chance scored about 4 times in 10'). 2-4 sentences.",
    },
    "analyst": {
        "label": "Tactics analyst",
        "style": "Precise and tactical. Use metrics (xG, PPDA, field tilt, progressive passes) and name the "
                 "mechanism: pressing trigger, overload, rest-defence, transition. 3-5 sentences.",
    },
    "kid": {
        "label": "Young fan (8-12)",
        "style": "Fun and simple for a child aged 8-12. Short sentences, one vivid image, no scary or rude words, "
                 "at most one number. 2-3 sentences.",
    },
    "coach": {
        "label": "Coach",
        "style": "Speak to a coach. Explain what worked or failed and end with one concrete coaching point. "
                 "3-4 sentences.",
    },
    "audio": {
        "label": "Audio description",
        "style": "Audio description for blind and low-vision fans, written to be read aloud. Describe positions "
                 "spatially (left/right flank, distance from goal in metres, which end), present tense, no "
                 "references to colours on screen or 'as you can see'. 2-4 sentences.",
    },
}

LANGUAGES: dict[str, str] = {
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "pt": "Portuguese",
    "de": "German",
    "ar": "Arabic",
    "hi": "Hindi",
    "bn": "Bengali",
    "sw": "Swahili",
    "ja": "Japanese",
}


def persona_brief(persona: str, language: str) -> str:
    p = PERSONAS.get(persona, PERSONAS["fan"])
    lang = LANGUAGES.get(language, "English")
    return (f"Audience: {p['label']}. {p['style']} Write in {lang}. Keep player and team names exactly as given. "
            f"Write numbers with digits.")
