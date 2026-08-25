import json
import sys
import wave
import numpy as np
from pathlib import Path

def main():
    if len(sys.argv) < 2:
        print("Usage: python merge_voice.py <slug>")
        sys.exit(1)

    slug = sys.argv[1]
    root = Path(__file__).resolve().parent.parent.parent
    job_dir = root / "jobs" / slug
    beats_path = job_dir / "beats.json"

    if not beats_path.exists():
        print(f"Error: {beats_path} not found")
        sys.exit(1)

    data = json.loads(beats_path.read_text(encoding="utf-8"))
    sample_rate = 48000
    total_seconds = data.get("totalSeconds")
    if not total_seconds:
        last = data["beats"][-1]
        total_seconds = round(last["start"] + last["duration"] + data.get("tailSeconds", 1.8), 2)
    total_samples = int(np.ceil(total_seconds * sample_rate))

    master_audio = np.zeros(total_samples, dtype=np.int16)

    for beat in data["beats"]:
        wav_file = job_dir / beat["wav"]
        if not wav_file.exists():
            print(f"Missing {wav_file}")
            continue

        with wave.open(str(wav_file), "rb") as wf:
            n_channels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            framerate = wf.getframerate()
            n_frames = wf.getnframes()
            audio_bytes = wf.readframes(n_frames)

            if sampwidth != 2 or framerate != sample_rate:
                print(f"Skip {beat['id']}: expect 16-bit {sample_rate}Hz, got {sampwidth*8}-bit {framerate}Hz")
                continue
            samples = np.frombuffer(audio_bytes, dtype=np.int16)
            if n_channels == 2:
                samples = samples[::2]  # mono

        start_sample = int(round(beat["start"] * sample_rate))
        end_sample = min(start_sample + len(samples), total_samples)
        copy_len = end_sample - start_sample
        if copy_len > 0:
            master_audio[start_sample:end_sample] = samples[:copy_len]

    out_paths = [
        job_dir / "voice" / "narration.wav",
        root / "starter-hf" / slug / "voice" / "narration.wav",
    ]

    for out_p in out_paths:
        out_p.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(out_p), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(master_audio.tobytes())
        print(f"Wrote {out_p} ({total_seconds}s)")

if __name__ == "__main__":
    main()
