import json
import hashlib
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

def main():
    if len(sys.argv) < 2:
        print("Usage: python gen_beats_batch.py <slug>")
        sys.exit(1)
    
    slug = sys.argv[1]
    root = Path(__file__).resolve().parent.parent.parent
    job_dir = root / "jobs" / slug
    beats_path = job_dir / "beats.json"
    voice_dir = job_dir / "voice"
    voice_dir.mkdir(parents=True, exist_ok=True)
    
    if not beats_path.exists():
        print(f"Error: {beats_path} not found")
        sys.exit(1)
        
    data = json.loads(beats_path.read_text(encoding="utf-8"))
    voice_name = data.get("voice", "Adam")
    fps = data.get("fps", 30)
    gap_seconds = data.get("gapSeconds", 0.45)
    tail_seconds = data.get("tailSeconds", 1.8)
    
    from vieneu import Vieneu
    print(f"Initializing Vieneu-TTS (int8)...", file=sys.stderr)
    engine = Vieneu(precision="int8")
    
    current_start = 0.0
    for beat in data["beats"]:
        b_id = beat["id"]
        text = beat["vo"]
        out_wav = voice_dir / f"{b_id}.wav"
        meta_path = voice_dir / f"{b_id}.json"
        text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
        
        is_cached = False
        if meta_path.exists() and out_wav.exists():
            try:
                old = json.loads(meta_path.read_text(encoding="utf-8"))
                if old.get("textHash") == text_hash and old.get("durationSeconds", 0) > 0:
                    dur = old["durationSeconds"]
                    print(f"CACHED {b_id} ({dur}s)", file=sys.stderr)
                    beat["start"] = round(current_start, 2)
                    beat["duration"] = round(dur, 2)
                    beat["startFrame"] = round(current_start * fps)
                    beat["durFrames"] = round(dur * fps)
                    current_start += dur + gap_seconds
                    is_cached = True
            except Exception:
                pass
                
        if not is_cached:
            t0 = time.time()
            audio = engine.infer(text, voice=voice_name)
            engine.save(audio, str(out_wav))
            elapsed = time.time() - t0
            sample_rate = 48000
            duration = len(audio) / sample_rate
            words = split_words(text)
            timings = estimate_word_timings(words, duration)
            for t in timings:
                t["startFrame"] = round(t["start"] * fps)
                t["endFrame"] = round(t["end"] * fps)
                
            meta = {
                "text": text,
                "voice": voice_name,
                "precision": "int8",
                "wav": out_wav.name,
                "sampleRate": sample_rate,
                "durationSeconds": round(duration, 3),
                "generationSeconds": round(elapsed, 3),
                "rtf": round(elapsed / duration, 3) if duration > 0 else None,
                "timingMethod": "char-proportion",
                "textHash": text_hash,
                "words": timings,
            }
            meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"GENERATED {b_id} ({duration:.2f}s in {elapsed:.2f}s)", file=sys.stderr)
            
            beat["start"] = round(current_start, 2)
            beat["duration"] = round(duration, 2)
            beat["startFrame"] = round(current_start * fps)
            beat["durFrames"] = round(duration * fps)
            current_start += duration + gap_seconds

    # Calculate totalSeconds
    last_beat = data["beats"][-1]
    total_sec = round(last_beat["start"] + last_beat["duration"] + tail_seconds, 2)
    data["totalSeconds"] = total_sec
    data["totalFrames"] = round(total_sec * fps)
    
    beats_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"DONE batch voice: {len(data['beats'])} beats, total {total_sec}s ({data['totalFrames']} frames)", file=sys.stderr)

if __name__ == "__main__":
    main()
