"""Tiny eSpeak NG wrapper (ctypes) that needs no installer: `pip install espeakng-loader`.

    from espeak_synth import synth_wav
    synth_wav("[[a:]]", "out.wav", voice="en-us")      # [[...]] = eSpeak phoneme mnemonics

eSpeak NG is GPL-3.0. The audio it produces is generated speech, not a copy of eSpeak code;
see CREDITS in README for how the sounds are credited.
"""
import ctypes
import os
import shutil
import tempfile
import wave

import espeakng_loader

_lib = None
_rate = 22050
_chunks: list = []

CB = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_short), ctypes.c_int, ctypes.c_void_p)


@CB
def _on_samples(wav, n, events):
    if wav and n > 0:
        _chunks.append(ctypes.string_at(wav, n * 2))
    return 0


def _ascii_paths():
    """(dll, data) paths. The engine cannot open files under a path with Chinese characters,
    so in that case copy both once to an ASCII-only folder in the temp directory."""
    dll, data = espeakng_loader.get_library_path(), espeakng_loader.get_data_path()
    if all(ord(c) < 128 for c in dll + data):
        return dll, data
    base = os.path.join(tempfile.gettempdir(), "abc_espeak")
    d2, data2 = os.path.join(base, os.path.basename(dll)), os.path.join(base, "espeak-ng-data")
    if not (os.path.exists(d2) and os.path.isdir(data2)):
        os.makedirs(base, exist_ok=True)
        shutil.copy2(dll, d2)
        shutil.copytree(data, data2, dirs_exist_ok=True)
    return d2, data2


def _init():
    global _lib, _rate
    if _lib is not None:
        return _lib
    dll, data = _ascii_paths()
    lib = ctypes.CDLL(dll)
    lib.espeak_Initialize.restype = ctypes.c_int
    lib.espeak_Initialize.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
    # AUDIO_OUTPUT_SYNCHRONOUS = 2: samples go to the callback, nothing is played
    _rate = lib.espeak_Initialize(2, 0, data.encode("ascii"), 0)
    if _rate <= 0:
        raise RuntimeError(f"espeak_Initialize failed ({_rate}); data={data}")
    lib.espeak_SetSynthCallback.argtypes = [CB]
    lib.espeak_SetSynthCallback(_on_samples)
    lib.espeak_SetVoiceByName.argtypes = [ctypes.c_char_p]
    lib.espeak_SetParameter.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_int]
    lib.espeak_Synth.argtypes = [ctypes.c_char_p, ctypes.c_size_t, ctypes.c_uint, ctypes.c_int,
                                 ctypes.c_uint, ctypes.c_uint, ctypes.POINTER(ctypes.c_uint), ctypes.c_void_p]
    lib.espeak_Synchronize.restype = ctypes.c_int
    _lib = lib
    return lib


def synth_pcm(text: str, voice: str = "en-us", speed: int = 110, pitch: int = 50, ssml: bool = False) -> bytes:
    """Render text (or [[phoneme mnemonics]]) to 16-bit mono PCM at the engine's rate."""
    lib = _init()
    if lib.espeak_SetVoiceByName(voice.encode()) != 0:
        raise RuntimeError("unknown voice " + voice)
    lib.espeak_SetParameter(1, speed, 0)      # espeakRATE (words per minute)
    lib.espeak_SetParameter(3, pitch, 0)      # espeakPITCH
    _chunks.clear()
    raw = text.encode("utf-8") + b"\0"
    flags = 1 | (0x10 if ssml else 0)         # espeakCHARS_UTF8 | espeakSSML
    lib.espeak_Synth(raw, len(raw), 0, 0, 0, flags, None, None)
    lib.espeak_Synchronize()
    return b"".join(_chunks)


def synth_wav(text: str, path: str, **kw) -> float:
    pcm = synth_pcm(text, **kw)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(_rate)
        w.writeframes(pcm)
    return len(pcm) / 2 / _rate


def to_phonemes(text: str, voice: str = "en-us", ipa: bool = True) -> str:
    """eSpeak's own IPA transcription of a word (handy to double-check an example word)."""
    lib = _init()
    lib.espeak_SetVoiceByName(voice.encode())
    lib.espeak_TextToPhonemes.restype = ctypes.c_char_p
    lib.espeak_TextToPhonemes.argtypes = [ctypes.POINTER(ctypes.c_char_p), ctypes.c_int, ctypes.c_int]
    buf = ctypes.c_char_p(text.encode("utf-8") + b"\0")
    out = []
    while buf.value:
        r = lib.espeak_TextToPhonemes(ctypes.byref(buf), 1, (2 if ipa else 0))   # 2 = IPA, 0 = eSpeak mnemonics
        if not r:
            break
        out.append(r.decode("utf-8"))
    return "".join(out)
