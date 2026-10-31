"""Generate mp3 voice files for the game from data.js using edge-tts.

Usage:  python tools/gen_audio.py
Output: audio/en|en2|zh|sen|sen2|senzh|act|fx/<id>.mp3  (existing files are skipped)
  en2 / sen2 = the same words and sentences in a second (male) voice, used for review questions
  act        = "Show me a dancer!"-style commands for the move-your-body step
  let|letw|letz = alphabet page (js/content/alphabet.js): letter name, example word, example word in Chinese
  phw|phz    = IPA page (js/content/phonetics.js): example / pair words (file name = slug of the word), mouth tips
                (the single sounds themselves come from tools/gen_phonemes.py -> audio/ph/)
"""
import asyncio
import json
import re
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent.parent
EN_VOICE = "en-US-AnaNeural"        # child-like US English voice
EN2_VOICE = "en-US-GuyNeural"       # second voice (male), so words are heard from different speakers
ZH_VOICE = "zh-CN-XiaoyiNeural"     # warm, friendly Mandarin voice
EN_RATE = "-15%"                    # slower for 5-year-olds
ZH_RATE = "-5%"


def load(name: str, file: str = "data.js"):
    text = (ROOT / "js" / "content" / file).read_text(encoding="utf-8")
    m = re.search(rf"const {name} = (.*?);\s*(?:\n//|\nconst|\Z)", text, re.S)
    return json.loads(m.group(1))


def slugify(word: str) -> str:
    """File name for a word: lowercase, anything that is not a letter/digit becomes _ (same rule as js/pages/phonetics.js)."""
    return re.sub(r"[^a-z0-9]+", "_", word.lower()).strip("_")


def jobs():
    for lesson in load("LESSONS"):
        for it in lesson["items"]:
            yield "en", it["id"], it["en"], EN_VOICE, EN_RATE
            yield "zh", it["id"], it["zh"], ZH_VOICE, ZH_RATE
            if it.get("sen"):
                yield "sen", it["id"], it["sen"], EN_VOICE, EN_RATE
                yield "senzh", it["id"], it["senZh"], ZH_VOICE, ZH_RATE
            # second voice: only for words used in review questions (not sentences, not abstract words)
            if not it.get("sentence") and it.get("game") is not False:
                yield "en2", it["id"], it["en"], EN2_VOICE, EN_RATE
                if it.get("sen"):
                    yield "sen2", it["id"], it["sen"], EN2_VOICE, EN_RATE
    for id_, a in load("ACTS").items():
        yield "act", id_, a["en"], EN_VOICE, EN_RATE
    for it in load("STORY_LINES"):      # story-only sentences: English voice only (the story page never plays Chinese)
        yield "en", it["id"], it["en"], EN_VOICE, EN_RATE
    for fx in load("FX"):
        v, r = (EN_VOICE, EN_RATE) if fx["lang"] == "en" else (ZH_VOICE, ZH_RATE)
        yield "fx", fx["id"], fx["text"], v, r
    for L in load("ALPHABET", "alphabet.js"):
        yield "let", L["id"], L["say"], EN_VOICE, EN_RATE
        yield "letw", L["id"], L["word"], EN_VOICE, EN_RATE
        yield "letz", L["id"], L["zh"], ZH_VOICE, ZH_RATE
    seen = set()
    for s in load("IPA", "phonetics.js"):
        yield "phz", s["id"], s["tip"], ZH_VOICE, ZH_RATE
        words = [w[0].replace("[", "").replace("]", "") for w in s["words"]] + list(s.get("pair", [])[:2])
        for w in words:
            slug = slugify(w)
            if slug not in seen:
                seen.add(slug)
                yield "phw", slug, w, EN_VOICE, EN_RATE


async def main():
    sem = asyncio.Semaphore(4)

    async def run(folder, id_, text, voice, rate):
        out = ROOT / "audio" / folder / f"{id_}.mp3"
        if out.exists():
            return
        out.parent.mkdir(parents=True, exist_ok=True)
        async with sem:
            for attempt in range(3):
                try:
                    await edge_tts.Communicate(text, voice, rate=rate).save(str(out))
                    print("ok  ", out.relative_to(ROOT), "-", text)
                    return
                except Exception as e:  # network hiccup: retry
                    print("retry", id_, e)
                    await asyncio.sleep(1.5)
            print("FAIL", out)

    await asyncio.gather(*(run(*j) for j in jobs()))


if __name__ == "__main__":
    asyncio.run(main())
