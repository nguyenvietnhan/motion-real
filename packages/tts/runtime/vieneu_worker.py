"""Minimal JSONL worker for MotionReal's pinned local VieNeu runtime."""

from __future__ import annotations

import importlib.metadata
import json
import os
import sys
from pathlib import Path

EXPECTED_VERSION = "3.3.0"
SAMPLE_RATE = 48_000


def emit(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)


def main() -> int:
    if importlib.metadata.version("vieneu") != EXPECTED_VERSION:
        raise RuntimeError(f"vieneu {EXPECTED_VERSION} is required")

    import numpy as np
    import soundfile as sf
    from vieneu import Vieneu

    engine = Vieneu(mode="v3turbo", backend="onnx", precision="int8")
    if int(getattr(engine, "sample_rate", 0)) != SAMPLE_RATE:
        raise RuntimeError("VieNeu sample rate mismatch")
    voices = {voice_id for _label, voice_id in engine.list_preset_voices()}
    emit({"type": "ready", "version": EXPECTED_VERSION, "sample_rate": SAMPLE_RATE})

    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            if request.get("op") == "shutdown":
                return 0
            request_id = request.get("id")
            if request.get("op") != "synthesize" or not isinstance(request_id, str):
                continue
            text = str(request.get("text") or "").strip()
            voice = str(request.get("voice") or "").strip()
            output = Path(str(request.get("output_path") or ""))
            if not text or not output.is_absolute():
                emit({"id": request_id, "type": "error", "code": "invalid_request"})
                continue
            if voice not in voices:
                emit({"id": request_id, "type": "error", "code": "voice_not_found"})
                continue

            audio = np.asarray(
                engine.infer(text=text, voice=voice, temperature=0.8, apply_watermark=True),
                dtype=np.float32,
            ).reshape(-1)
            if audio.size == 0 or not np.isfinite(audio).all():
                raise RuntimeError("VieNeu returned invalid audio")
            output.parent.mkdir(parents=True, exist_ok=True)
            part = output.with_name(f"{output.stem}.part{output.suffix}")
            try:
                sf.write(str(part), audio, SAMPLE_RATE, subtype="PCM_16")
                os.replace(part, output)
            finally:
                part.unlink(missing_ok=True)
            emit({
                "id": request_id,
                "type": "result",
                "audio_path": str(output),
                "duration": audio.size / SAMPLE_RATE,
            })
        except Exception as exc:
            print(f"VieNeu worker synthesis failed: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
            emit({"id": request.get("id") if isinstance(request, dict) else None, "type": "error", "code": "provider_unavailable"})
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"VieNeu worker startup failed: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        raise SystemExit(1)
