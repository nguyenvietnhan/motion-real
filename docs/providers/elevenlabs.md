# ElevenLabs Provider Notes

The app uses ElevenLabs over its REST API without an SDK dependency.

```dotenv
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
```

Provider contract:

- Voices: `GET https://api.elevenlabs.io/v2/voices` (all pages, up to 100 per request).
- Synthesis: `POST /v1/text-to-speech/{voice_id}/with-timestamps`.
- Model: `eleven_multilingual_v2` (fixed for this release).
- Language: the project's locked `videoLanguage` (`vi` or `en`) is sent as
  `language_code`.
- Output: `mp3_44100_128`.
- Character alignment is grouped into word-timed SRT segments for the central caption track.

The synthesis POST is not automatically retried: an ambiguous network failure
may already have consumed provider quota. Completed scene clips remain cached,
so a user-triggered retry only generates missing clips. Missing credentials or
voice ids stop the render; the provider is never silently changed to mock/none.
The TTS cache identity includes language, so Vietnamese and English clips never
collide even when text/voice/model are otherwise identical.

Desktop API keys are encrypted with Electron `safeStorage`. CLI usage reads the
environment variables above. Run a live, temporary probe with:

```bash
npx tsx --env-file=.env scripts/probe-tts.ts --provider elevenlabs
```
