"""Audit every mp3 in audio/: is it decodable, long enough, loud enough, not mostly silence?
Usage:  python tools/audit_audio.py        (needs ffmpeg + ffprobe on PATH)
Prints a table of suspicious files and a summary; exit code 1 if any problem was found."""
import json, os, re, subprocess, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
AUDIO = os.path.join(ROOT, "audio")

def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")

def probe(path):
    r = run(["ffprobe", "-v", "error", "-show_entries", "format=duration,bit_rate:stream=codec_name,sample_rate,channels",
             "-of", "json", path])
    try:
        j = json.loads(r.stdout)
        return float(j["format"]["duration"]), j["streams"][0]
    except Exception:
        return None, None

def volume(path):
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "volumedetect,silencedetect=noise=-45dB:d=0.4", "-f", "null", "-"])
    t = r.stderr
    mean = re.search(r"mean_volume: (-?[\d.]+|-inf) dB", t)
    peak = re.search(r"max_volume: (-?[\d.]+|-inf) dB", t)
    f = lambda m: float(m.group(1)) if m and m.group(1) != "-inf" else -99.0
    # leading silence: first silence_start at ~0
    starts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", t)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", t)]
    lead = ends[0] if starts and starts[0] <= 0.05 and ends else 0.0
    return f(mean), f(peak), lead

def main():
    rows, bad = [], 0
    for d, _, files in os.walk(AUDIO):
        for fn in sorted(files):
            if not fn.lower().endswith(".mp3"):
                continue
            p = os.path.join(d, fn)
            rel = os.path.relpath(p, AUDIO).replace("\\", "/")
            dur, st = probe(p)
            if dur is None:
                rows.append((rel, "UNDECODABLE", 0, 0, 0, 0)); bad += 1; continue
            mean, peak, lead = volume(p)
            why = []
            if dur < 0.35: why.append("too short")
            if peak < -12: why.append("very quiet peak")
            if mean < -38: why.append("very quiet mean")
            if lead > 0.8: why.append("long leading silence")
            rows.append((rel, ",".join(why), dur, mean, peak, lead))
            if why: bad += 1
    rows.sort()
    n = len(rows)
    durs = [r[2] for r in rows if r[2]]
    means = [r[3] for r in rows if r[3] > -99]
    print(f"{n} files; duration {min(durs):.2f}-{max(durs):.2f}s; mean volume {min(means):.1f}..{max(means):.1f} dB")
    for r in rows:
        if r[1]:
            print(f"  !! {r[0]:28s} {r[1]:28s} dur={r[2]:.2f}s mean={r[3]:.1f}dB peak={r[4]:.1f}dB lead={r[5]:.2f}s")
    # relative check: files much quieter than the median of their own folder
    by = {}
    for r in rows:
        by.setdefault(r[0].split("/")[0], []).append(r)
    for folder, rs in by.items():
        ms = sorted(x[3] for x in rs)
        med = ms[len(ms) // 2]
        for r in rs:
            if r[3] < med - 9 and not r[1]:
                print(f"  ~~ {r[0]:28s} quieter than its folder median ({med:.1f} dB) by {med - r[3]:.1f} dB: mean={r[3]:.1f}")
    print("PROBLEMS:", bad)
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main())
