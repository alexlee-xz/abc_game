"""Generate the single-sound mp3 files of the IPA page with eSpeak NG (no installer needed: pip install espeakng-loader).

Usage:  python tools/gen_phonemes.py [--force] [id ...]
Reads:  js/content/phonetics.js   (field "syn" = eSpeak phoneme mnemonics, e.g. "[['I]]" for /ɪ/, "[[SS]]" for /ʃ/)
Writes: audio/ph/<id>.mp3         (mono, silence trimmed, loudness normalised; existing files are skipped unless --force)
Needs:  ffmpeg on PATH (or at the winget default location).
Then check the vowels with:  python tools/check_vowels.py
"""
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from espeak_synth import synth_wav      # noqa: E402
from gen_audio import load              # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
FFMPEG = "ffmpeg"
WINGET_FFMPEG = Path.home() / "AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe"
# cut leading/trailing silence, normalise the loudness, short fade at the end
FILTER = ("silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,"
          "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse,"
          "loudnorm=I=-18:TP=-2:LRA=7")
SPEED = 80       # eSpeak words per minute: slower than the default (175) so every sound is long enough to hear


def ffmpeg_exe() -> str:
    return str(WINGET_FFMPEG) if WINGET_FFMPEG.exists() else FFMPEG


def make(sound: dict, force: bool = False) -> bool:
    out = ROOT / "audio" / "ph" / f"{sound['id']}.mp3"
    if out.exists() and not force:
        return False
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "x.wav"
        # phonemes=True is essential: without it eSpeak reads "[[p@]]" as the letters "pee at"
        dur = synth_wav(sound["syn"], str(wav), voice="en-us", speed=SPEED, pitch=50, phonemes=True)
        r = subprocess.run([ffmpeg_exe(), "-y", "-loglevel", "error", "-i", str(wav), "-af", FILTER,
                            "-ac", "1", "-ar", "24000", "-codec:a", "libmp3lame", "-q:a", "4", str(out)],
                           capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(r.stderr)
    print(f"ok   {out.relative_to(ROOT)}  {sound['ipa']:4s} {sound['syn']:10s} raw {dur:.2f}s")
    return True


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    for s in load("IPA", "phonetics.js"):
        if not args or s["id"] in args:
            make(s, force)
