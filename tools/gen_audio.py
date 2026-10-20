"""Generate mp3 voice files for the game from data.js using edge-tts.

Usage:  python tools/gen_audio.py
Output: audio/en|zh|sen|senzh|fx/<id>.mp3  (existing files are skipped)
"""
import asyncio
import json
import re
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent.parent
EN_VOICE = "en-US-AnaNeural"        # child-like US English voice
ZH_VOICE = "zh-CN-XiaoyiNeural"     # warm, friendly Mandarin voice
EN_RATE = "-15%"                    # slower for 5-year-olds
ZH_RATE = "-5%"


def load(name: str):
    text = (ROOT / "data.js").read_text(encoding="utf-8")
    m = re.search(rf"const {name} = (.*?);\s*(?:\n//|\nconst|\Z)", text, re.S)
    return json.loads(m.group(1))


def jobs():
    for lesson in load("LESSONS"):
        for it in lesson["items"]:
            yield "en", it["id"], it["en"], EN_VOICE, EN_RATE
            yield "zh", it["id"], it["zh"], ZH_VOICE, ZH_RATE
            if it.get("sen"):
                yield "sen", it["id"], it["sen"], EN_VOICE, EN_RATE
                yield "senzh", it["id"], it["senZh"], ZH_VOICE, ZH_RATE
    for fx in load("FX"):
        v, r = (EN_VOICE, EN_RATE) if fx["lang"] == "en" else (ZH_VOICE, ZH_RATE)
        yield "fx", fx["id"], fx["text"], v, r


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
