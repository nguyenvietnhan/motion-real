# VieNeu Local (Developer Preview)

VieNeu Local is the Vietnamese, no-API-cost narration option used by MotionReal
development builds. It runs in a persistent Python worker for one narration job
and feeds the same TTS cache, measured timing, captions, and render pipeline as
the cloud providers. It is not a second render path and never silently falls
back to `mock` or another voice provider.

## Pinned runtime

- Python 3.11
- `vieneu==3.3.0`
- `mode=v3turbo`, `backend=onnx`, `precision=int8`
- 48 kHz mono PCM16 WAV, speed `1.0`, temperature `0.8`
- Runtime identity: `vieneu-3.3.0-v3turbo-onnx-int8-48k-t08-v1`

MotionReal pins the tested Python 3.11 environment even though the published
package declares Python 3.10 or newer. VieNeu's published 3.3.0 metadata and
runtime overview are available on [PyPI](https://pypi.org/project/vieneu/3.3.0/).

The development launcher first looks for
`../motion-china/.venv/Scripts/python.exe`. Override it with
`MOTIONREAL_VIENEU_PYTHON` when the environment lives elsewhere. The committed
worker path may be overridden with `MOTIONREAL_VIENEU_WORKER` for diagnostics.

Model files are cached under
`VIDEO_TOOL_HOME/.video-tool/vieneu/huggingface` (the launcher resolves this to
the repository's `.video-tool/vieneu/huggingface`). First use downloads roughly
285 MB and startup can take over a minute on CPU. Later scenes in the same job
reuse the loaded worker.

## Verify and calibrate

From the repository root in PowerShell:

```powershell
$env:MOTIONREAL_VIENEU_PYTHON = "V:\Projects\motion-china\.venv\Scripts\python.exe"
$env:MOTIONREAL_VIENEU_WORKER = "V:\Projects\motion-real\packages\tts\runtime\vieneu_worker.py"
$env:MOTIONREAL_VIENEU_CACHE = "V:\Projects\motion-real\.video-tool\vieneu\huggingface"
npm.cmd run smoke:vieneu
npm.cmd run calibrate:voice -- --provider=vieneu
```

The smoke test must produce a non-empty WAV whose duration can be measured by
FFprobe. Calibration measures the selected preset and stores its words-per-second
rate in normal MotionReal settings. Until calibration exists, VieNeu uses the
measured conservative fallback of `3.5` words/second.

## Scope

- Vietnamese only in Phase 3.5.
- One local worker per narration job; the desktop queue is already serial.
- Development runtime only. Packaging Python, native libraries, and model cache
  in the installer is deferred.
- The package is early-stage, so a version mismatch fails visibly instead of
  using an untested version or silently changing provider.
