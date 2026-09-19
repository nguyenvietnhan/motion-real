# TTS Providers

MotionReal supports three narration options: **VieNeu Local** (Vietnamese offline/developer preview), **Vivibe** (Vietnamese cloud), and **ElevenLabs** (English & Multilingual cloud).

Missing local runtime or cloud credentials **block** production render; the pipeline preserves configured choices and never silently falls back to `mock`, `none`, or an unconfigured provider.

Cloud TTS endpoints and media/subtitle URLs must be public **HTTPS**. The shared
transport resolves and pins every public redirect hop, caps responses and
timeouts, rejects redirects for authenticated API calls, and strips credential
headers when an anonymous media redirect crosses origin. VieNeu Local is a
separate local worker path and is unaffected by this cloud-only policy.

## Comparison & Selection Matrix

| Provider | Language | Hosting | Cost / API Key | Output Format | Alignment / Timing | Best For |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **VieNeu Local** (`vieneu`) | Vietnamese (`vi`) only | Local persistent Python worker | Free (No API key needed; downloads ONNX weights) | 48 kHz mono PCM16 WAV | Central breath-gap lock + calibrated rate | Local development, offline rendering, cost-free Vietnamese videos |
| **Vivibe / LucyLab** (`vivibe`) | Vietnamese (`vi`) only | LucyLab Cloud API | Requires `VIVIBE_API_KEY` + `VIVIBE_VOICE_ID` | WAV via URL polling | Provider SRT sidecar with word timing | High-fidelity Vietnamese cloud production |
| **ElevenLabs** (`elevenlabs`) | English (`en`) & Vietnamese (`vi`) | ElevenLabs REST API | Requires `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` | MP3 44.1kHz 128kbps | Word-timed SRT from character timestamps | English-language videos and high-grade multilingual production |

---

## 1. VieNeu Local (Developer Preview)

VieNeu Local runs in a dedicated, persistent Python worker per narration job and feeds the same measured timing, caption track, and TTS cache as cloud providers.

### Pinned Runtime Specification
- **Python:** `3.11`
- **Package:** `vieneu==3.3.0`
- **Inference Mode:** `mode=v3turbo`, `backend=onnx`, `precision=int8`
- **Audio Output:** 48 kHz mono PCM16 WAV, speed `1.0`, temperature `0.8`
- **Runtime Identity:** `vieneu-3.3.0-v3turbo-onnx-int8-48k-t08-v1`

### Environment & Cache
- The dev launcher checks `../motion-china/.venv/Scripts/python.exe` or `MOTIONREAL_VIENEU_PYTHON`.
- Model weights (~285 MB) are cached under `VIDEO_TOOL_HOME/.video-tool/vieneu/huggingface`.
- Once both pinned model snapshots are complete, the worker uses that cache in
  offline mode so an unavailable Hugging Face metadata endpoint cannot delay or
  break local synthesis. An incomplete first-run cache still permits download.
- Worker implementation is at `packages/tts/runtime/vieneu_worker.py` (override via `MOTIONREAL_VIENEU_WORKER` if needed).

### Verification & Calibration
```powershell
# Smoke test (synthesizes a real WAV and measures duration with ffprobe)
npm.cmd run smoke:vieneu

# Calibrate words-per-second rate for the selected voice preset
npm.cmd run calibrate:voice -- --provider=vieneu
```
Until calibration data exists, VieNeu uses a conservative fallback of `3.5` words/second.

---

## 2. Vivibe / LucyLab Provider

Vivibe is configured in the desktop UI or via `.env`:

```dotenv
VIVIBE_API_KEY=          # or VIETNAMESE_API_KEY
VIVIBE_VOICE_ID=         # or VIETNAMESE_VOICEID
VIVIBE_BASE_URL=https://api.lucylab.io/json-rpc
LUCYLAB_POLL_INTERVAL_MS=2000
LUCYLAB_POLL_TIMEOUT_MS=300000
```

### Protocol & Behavior
- **Base URL:** `https://api.lucylab.io/json-rpc` (JSON-RPC 2.0)
- **Voice Listing:** `getUserVoices` (`limit: 100, page: 1`)
- **Synthesis:** `ttsLongText` with fixed `speed: 1.0` (maintains cache keys and timing locks).
- **Polling:** Polls `getExportStatus` until `state: "completed"`.
- **Captions:** Captures `srtUrl` when returned; downloads SRT sidecar for precise burnt-in subtitles. Falls back to even-split timing only when no SRT is provided.

---

## 3. ElevenLabs Provider

ElevenLabs communicates over its standard REST API without SDK dependencies:

```dotenv
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
```

### Protocol & Behavior
- **Voices:** `GET https://api.elevenlabs.io/v2/voices` (all pages, up to 100 per request).
- **Synthesis:** `POST /v1/text-to-speech/{voice_id}/with-timestamps`
- **Model:** `eleven_multilingual_v2`
- **Language Code:** Sends locked project `videoLanguage` (`vi` or `en`).
- **Output:** `mp3_44100_128`
- **Alignment:** Character timestamps are parsed into word-timed SRT segments for caption generation.
- **Safety:** Synthesis POST calls are not automatically retried to prevent quota burn; completed clips stay cached. Desktop keys are stored securely using Electron `safeStorage`.

```bash
# Test probe
npx tsx --env-file=.env scripts/probe-tts.ts --provider elevenlabs
```
