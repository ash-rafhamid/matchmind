"""The commentator's voice: Azure AI Speech neural text-to-speech, through the same Foundry resource.

Keyless on Azure (managed identity with the "Cognitive Services Speech User" role); a key works for local
development. Audio is cached on disk by content, so each line is synthesised once.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import re
import time
from xml.sax.saxutils import escape

import httpx

from . import cache

VOICES: dict[str, tuple[str, str]] = {
    "en": ("en-GB", "en-GB-RyanNeural"),
    "es": ("es-ES", "es-ES-AlvaroNeural"),
    "fr": ("fr-FR", "fr-FR-HenriNeural"),
    "pt": ("pt-BR", "pt-BR-AntonioNeural"),
    "de": ("de-DE", "de-DE-ConradNeural"),
    "ar": ("ar-SA", "ar-SA-HamedNeural"),
    "hi": ("hi-IN", "hi-IN-MadhurNeural"),
    "bn": ("bn-IN", "bn-IN-BashkarNeural"),
    "sw": ("sw-KE", "sw-KE-RafikiNeural"),
    "ja": ("ja-JP", "ja-JP-KeitaNeural"),
}
FORMAT = "audio-24khz-48kbitrate-mono-mp3"
FOLDER = cache.RUNTIME / "tts"
REGION = os.getenv("AZURE_SPEECH_REGION", "japaneast")
RESOURCE_ID = os.getenv("AZURE_SPEECH_RESOURCE_ID", "")
TAGS = re.compile(r"\s*\[#\d+(?:\s*[-,]\s*#?\d+)*\]")

_sem = asyncio.Semaphore(4)
_inflight: dict[str, asyncio.Task] = {}
_token: dict[str, float | str] = {"value": "", "expires": 0.0}
_credential = None


def available() -> bool:
    return bool(os.getenv("AZURE_SPEECH_KEY") or os.getenv("AZURE_OPENAI_API_KEY") or RESOURCE_ID)


def _auth() -> dict[str, str]:
    key = os.getenv("AZURE_SPEECH_KEY") or os.getenv("AZURE_OPENAI_API_KEY")
    if key:
        return {"Ocp-Apim-Subscription-Key": key}
    global _credential
    if time.time() > float(_token["expires"]) - 300:
        if _credential is None:
            from azure.identity import DefaultAzureCredential

            _credential = DefaultAzureCredential()
        tok = _credential.get_token("https://cognitiveservices.azure.com/.default")
        _token.update(value=tok.token, expires=float(tok.expires_on))
    return {"Authorization": f"Bearer aad#{RESOURCE_ID}#{_token['value']}"}


def ssml(text: str, lang: str, mood: str = "call") -> str:
    """Excited calls go quicker and higher; analysis is read at an even pace."""
    locale, voice = VOICES.get(lang, VOICES["en"])
    prosody = {"excited": 'rate="+14%" pitch="+10%" volume="+15%"', "call": 'rate="+6%"', "story": 'rate="+2%"'}[mood]
    clean = TAGS.sub("", text).strip()
    return (f"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='{locale}'>"
            f"<voice name='{voice}'><prosody {prosody}>{escape(clean)}</prosody></voice></speak>")


async def speak(text: str, lang: str, mood: str = "call") -> bytes:
    """MP3 audio for this text, from the disk cache or freshly synthesised."""
    doc = ssml(text, lang, mood)
    key = hashlib.sha1(doc.encode("utf-8")).hexdigest()
    path = FOLDER / f"{key}.mp3"
    if path.exists():
        return path.read_bytes()
    if key in _inflight:
        return await asyncio.shield(_inflight[key])

    async def run() -> bytes:
        async with _sem:
            headers = {"Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": FORMAT, "User-Agent": "matchmind",
                       **(await asyncio.to_thread(_auth))}
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.post(f"https://{REGION}.tts.speech.microsoft.com/cognitiveservices/v1", content=doc.encode("utf-8"),
                                      headers=headers)
            r.raise_for_status()
            FOLDER.mkdir(parents=True, exist_ok=True)
            path.write_bytes(r.content)
            return r.content

    task = asyncio.create_task(run())
    _inflight[key] = task
    task.add_done_callback(lambda _: _inflight.pop(key, None))
    return await asyncio.shield(task)


def first_sentences(text: str, max_chars: int = 320) -> str:
    """The opening of a crew story, for reading out: whole sentences, not too long."""
    clean = TAGS.sub("", text).strip()
    parts = re.split(r"(?<=[.!?。！？])\s*", clean)
    out = ""
    for s in parts:
        if not s:
            continue
        if out and len(out) + len(s) > max_chars:
            break
        out = f"{out} {s}".strip()
    return out or clean[:max_chars]
