# Vivibe / LucyLab Provider Notes

> Vivibe is exposed in the desktop UI as a Vietnamese-only provider. The app
> keeps this limitation visible anywhere the user selects a provider. Selecting
> English switches the create screen to ElevenLabs; Vivibe + English is also
> rejected by backend validation and the TTS boundary.

Ported from `news_video_tool` (the `@news/tts` client is the same code). Status:
probed against a real key on 2026-05-22.

Configure via `.env` (either naming style is accepted):

```dotenv
VIVIBE_API_KEY=          # or VIETNAMESE_API_KEY
VIVIBE_VOICE_ID=         # or VIETNAMESE_VOICEID
VIVIBE_BASE_URL=https://api.lucylab.io/json-rpc
LUCYLAB_POLL_INTERVAL_MS=2000
LUCYLAB_POLL_TIMEOUT_MS=300000
```

Base URL:

```text
https://api.lucylab.io/json-rpc
```

Voice list request:

```json
{ "method": "getUserVoices", "input": { "limit": 100, "page": 1 } }
```

TTS request:

```json
{
  "method": "ttsLongText",
  "input": { "text": "Xin chào, đây là giọng nói AI", "userVoiceId": "YOUR_VOICE_ID", "speed": 1.0 }
}
```

Speed is fixed at `1.0` so TTS cache keys, render timing, and project retries
stay consistent.

Observed `ttsLongText` response:

```json
{ "result": { "projectExportId": "...", "characterCount": 39, "blockCount": 1 } }
```

Polling request:

```json
{ "method": "getExportStatus", "input": { "projectExportId": "..." } }
```

Completed polling response:

```json
{
  "result": {
    "jobId": "...",
    "state": "completed",
    "url": "https://public.ttsapi.app/projects/.../..._final.wav",
    "srtUrl": "https://public.ttsapi.app/projects/.../..._final.srt"
  }
}
```

The adapter captures `srtUrl` when the provider returns one: the SRT is
downloaded next to the audio and drives the burned-in caption timing (see
`audio/captions.ts`). If no SRT is available, captions fall back to even-split
timing. Audio is downloaded from `url`. If a key, endpoint, or voice id is
missing, the pipeline stops and reports the exact missing setting rather than
falling back to a lower-quality voice.
