# Render Workflow

## Artifact Locations

Generated project artifacts live under:

```text
VIDEO_TOOL_HOME/.video-tool/projects/<id>/
```

Shared caches live under:

```text
VIDEO_TOOL_HOME/.video-tool/cache/
```

Do not write scratch renders, specs, or screenshots to the repo root.

## Stills

Stills are the cheap visual pass. They use admitted authored scenes and a locked
spec without TTS, then render PNG frames for review/refine.

Use stills to catch obvious visual problems before spending TTS/render time.

## Draft

Draft render is the first MP4 preview for the user. It is faster and lower
quality than final render but follows the same timing path.

Always draft before full.

## Full

Full render is the deliverable MP4. It should run only after the user approves
the draft or explicitly asks to bypass the normal review.

## TTS

TTS provider and voice come from project/user settings:

- Vivibe is Vietnamese-only.
- ElevenLabs supports Vietnamese and English.
- Missing keys, endpoints, or voice ids stop the render.
- The system must not silently downgrade to `mock`, `none`, or another provider.

## Captions

Captions are derived centrally from narration and TTS timing. TikTok renders the
burned-in karaoke line. YouTube-format composition omits burned captions.

## Supported Local Checks

For source changes:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

PowerShell may block `npm.ps1`; use `npm.cmd` on Windows when needed.

