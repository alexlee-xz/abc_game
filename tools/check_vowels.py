"""Check the vowel mp3s in audio/ph objectively (no listening needed): estimate F1/F2 with LPC and compare
with typical American English values (Hillenbrand et al. 1995, adult male; eSpeak's en-us voice is male).

Usage:  python tools/check_vowels.py
  steady vowels  -> median F1/F2 of the middle half, flagged when far from the reference
  glides         -> F1/F2 at the start and at the end (diphthongs move, r-colored vowels bend)
It checks vowel quality only: not naturalness, and not consonants.
"""
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gen_audio import load                      # noqa: E402
from gen_phonemes import ffmpeg_exe             # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
# steady vowels: id -> (F1, F2, allowed F1 deviation, allowed F2 deviation). eSpeak's [a] is lower/more back than a
# General-American /æ/ and its /uː/ is fronted, so those two get wider limits.
REF = {
    "ih": (427, 2034, .15, .12), "eh": (580, 1799, .15, .12), "ae": (588, 1952, .15, .22), "uh": (623, 1200, .15, .15),
    "uu": (469, 1122, .15, .15), "ee": (342, 2322, .25, .12), "ah": (768, 1333, .15, .15), "aw": (652, 997, .15, .12),
    "oo": (378, 997, .15, .40), "er": (474, 1379, .15, .12),
}
GLIDES = {"ar", "or", "ear", "air", "ei", "ai", "oi", "ou", "ow", "schwa"}


def read_mp3(path, fs=11025):
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "x.wav"
        subprocess.run([ffmpeg_exe(), "-y", "-loglevel", "error", "-i", str(path), "-ac", "1", "-ar", str(fs), str(wav)], check=True)
        with wave.open(str(wav)) as w:
            return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float), fs


def lpc_formants(seg, fs, order=12):
    seg = np.append(seg[0], seg[1:] - 0.95 * seg[:-1]) * np.hamming(len(seg))
    r = np.correlate(seg, seg, "full")[len(seg) - 1: len(seg) + order]
    if r[0] < 1e-3:
        return []
    R = np.array([[r[abs(i - j)] for j in range(order)] for i in range(order)]) + 1e-5 * r[0] * np.eye(order)
    z = np.roots(np.concatenate(([1.0], -np.linalg.solve(R, r[1: order + 1]))))
    z = z[np.imag(z) > 0]
    f, bw = np.angle(z) * fs / (2 * np.pi), -np.log(np.abs(z)) * fs / np.pi
    return sorted(a for a, b in zip(f, bw) if 250 < a < 4000 and b < 350)


def track(x, fs, win=0.025, hop=0.010):
    n, h = int(win * fs), int(hop * fs)
    out = []
    for i in range(0, len(x) - n, h):
        seg = x[i:i + n]
        out.append((np.sqrt(np.mean(seg ** 2)), lpc_formants(seg, fs)[:2]))
    peak = max((e for e, _ in out), default=0)
    return [f for e, f in out if e > 0.25 * peak and len(f) == 2]


def main():
    bad = 0
    print(f"{'id':6s} {'ipa':4s} {'len':>5s}  measured                      reference / note")
    for s in load("IPA", "phonetics.js"):
        x, fs = read_mp3(ROOT / "audio" / "ph" / f"{s['id']}.mp3")
        if s["id"] not in REF and s["id"] not in GLIDES:      # consonant: only check that it is long enough to hear
            if not 0.2 <= len(x) / fs <= 1.2:
                print(f"{s['id']:6s} {s['ipa']:4s} {len(x)/fs:5.2f}  consonant has a strange length"); bad += 1
            continue
        tr = track(x, fs)
        if len(tr) < 4:
            print(f"{s['id']:6s} {s['ipa']:4s} {len(x)/fs:5.2f}  too short / unvoiced"); bad += 1
            continue
        n = len(tr)
        if s["id"] in REF:
            mid = tr[n // 4: n - n // 4]
            f1, f2 = np.median([f[0] for f in mid]), np.median([f[1] for f in mid])
            r1, r2, t1, t2 = REF[s["id"]]
            ok = abs(f1 - r1) / r1 < t1 and abs(f2 - r2) / r2 < t2
            bad += not ok
            print(f"{s['id']:6s} {s['ipa']:4s} {len(x)/fs:5.2f}  F1={f1:4.0f} F2={f2:4.0f}              {r1}/{r2}  {'OK' if ok else 'WRONG VOWEL'}")
        else:
            a, b = np.median(tr[:max(2, n // 4)], axis=0), np.median(tr[-max(2, n // 4):], axis=0)
            print(f"{s['id']:6s} {s['ipa']:4s} {len(x)/fs:5.2f}  {a[0]:4.0f}/{a[1]:4.0f} -> {b[0]:4.0f}/{b[1]:4.0f}")
    print("\nALL OK" if not bad else f"\n{bad} vowel(s) need a look")


if __name__ == "__main__":
    main()
