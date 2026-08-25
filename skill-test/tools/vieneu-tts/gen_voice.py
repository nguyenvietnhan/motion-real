import argparse
import hashlib
import json
import re
import sys
import time
from pathlib import Path

EMOTION_TAG = re.compile(r"\[[^\]]+\]")
TRAILING_PUNCT = re.compile(r"^[^\wÀ-ỹ0-9]+|[^\wÀ-ỹ0-9]+$")


def split_words(text: str) -> list[str]:
    cleaned = EMOTION_TAG.sub(" ", text)
    return [w for w in cleaned.split() if w]


def display_word(raw: str) -> str:
    return TRAILING_PUNCT.sub("", raw) or raw


def estimate_word_timings(words: list[str], duration: float) -> list[dict]:
    weights = [len(w) + 1 for w in words]
    total = sum(weights) or 1
    timings = []
    cursor = 0.0
    for w, weight in zip(words, weights):
        span = duration * weight / total
        timings.append(
            {"word": display_word(w), "start": round(cursor, 3), "end": round(cursor + span, 3)}
        )
        cursor += span
    last = timings[-1] if timings else None
    if last is not None:
        last["end"] = round(duration, 3)
    return timings


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sinh giọng đọc tiếng Việt bằng VieNeu-TTS (local, CPU ONNX)."
    )
    parser.add_argument("--text", required=True, help="Nội dung lời đọc (hỗ trợ tag [cười]...)")
    parser.add_argument("--voice", default="Adam", help="Tên giọng preset, vd: Adam, Trúc Ly, Minh Đức")
    parser.add_argument("--out", required=True, help="Đường dẫn file WAV xuất ra")
    parser.add_argument("--meta", help="Đường dẫn file JSON meta (mặc định: <out>.json)")
    parser.add_argument("--fps", type=int, default=30, help="FPS video để tính thêm startFrame/endFrame")
    parser.add_argument("--precision", default="int8", choices=["int8", "fp32"])
    parser.add_argument("--force", action="store_true", help="Bo qua cache, sinh lai bat ke textHash")
    args = parser.parse_args()

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path = Path(args.meta) if args.meta else out_path.with_suffix(".json")

    text_hash = hashlib.sha256(args.text.encode("utf-8")).hexdigest()[:16]

    if not args.force and meta_path.exists() and out_path.exists():
        try:
            old = json.loads(meta_path.read_text(encoding="utf-8"))
            if old.get("textHash") == text_hash and old.get("durationSeconds", 0) > 0:
                print(
                    f"CACHED {out_path.name} | {old.get('durationSeconds')}s | textHash khop, bo qua sinh lai",
                    file=sys.stderr,
                )
                return 0
        except (json.JSONDecodeError, OSError):
            pass

    from vieneu import Vieneu

    engine = Vieneu(precision=args.precision)
    started = time.time()
    audio = engine.infer(args.text, voice=args.voice)
    engine.save(audio, str(out_path))
    elapsed = time.time() - started

    sample_rate = 48000
    duration = len(audio) / sample_rate
    words = split_words(args.text)
    timings = estimate_word_timings(words, duration)
    for t in timings:
        t["startFrame"] = round(t["start"] * args.fps)
        t["endFrame"] = round(t["end"] * args.fps)

    meta = {
        "text": args.text,
        "voice": args.voice,
        "precision": args.precision,
        "wav": out_path.name,
        "sampleRate": sample_rate,
        "durationSeconds": round(duration, 3),
        "generationSeconds": round(elapsed, 3),
        "rtf": round(elapsed / duration, 3) if duration > 0 else None,
        "timingMethod": "char-proportion",
        "textHash": text_hash,
        "words": timings,
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        f"OK {out_path.name} | {duration:.2f}s | {len(words)} từ | "
        f"sinh trong {elapsed:.2f}s | meta: {meta_path.name}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
