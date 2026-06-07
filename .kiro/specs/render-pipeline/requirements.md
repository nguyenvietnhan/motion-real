# Requirements Document

## Introduction

`render-pipeline` is the end-to-end engine of `news_remotion_tool`: it turns a
plain-text prompt into a finished Vietnamese 9:16 short-form news MP4 by letting
AI **author and parameterize real Remotion (React) scene components** rather than
filling the ~40 locked HyperFrames templates of `news_video_tool`. Visual
diversity is unlocked by giving AI authority over scenes; quality is kept stable
by a strict, enumerated **safety grid (N1–N28)** that mirrors
`math_video_tool`'s F1–F30 lint/oracle/review system.

These requirements are derived from `design.md` and are organized so that
**Phase 1 (PICK mode)** is independently shippable and ends by rendering one real
test video on an arbitrary topic. Requirements (or individual criteria) that
belong to later phases are explicitly marked **[Phase 2]** or **[Phase 3]**;
everything unmarked is **Phase 1**.

Scope is strictly `news_remotion_tool`. This feature does not modify
`math_video_tool`, which is referenced only as the proven reference design.

### Constraints and Assumptions

- **Remotion license**: free tier (individual / non-profit) is assumed and
  sufficient. A company-scale prompt-to-video product would need a paid license;
  this is recorded as an assumption, not a deliverable.
- **Fixed render contract**: FPS = 30, canvas 1080×1920 (9:16), styleId
  `clean-luxury-tech`, language `vi`, duration presets 60/90/120/180s. `duration`
  is a pacing target, not a wall-clock guarantee.
- **TTS provider**: Vivibe/LucyLab via `@news/tts`, configured through `.env`.
- **Determinism is mandatory**: scene visuals are pure functions of the frame.

## Glossary

- **VideoSpec / SceneSpec**: renderer-agnostic planner output (open `component`
  id + free `props`), defined in `@news/schema`.
- **LockedVideoSpec**: frame-accurate spec produced after TTS (per-scene
  `startFrame` / `durationInFrames`).
- **Registry**: `@news/compositions` map of registered scene components, each
  with a Zod prop schema, `promptGuide`, and `example`.
- **Safety grid**: enumerated checks `N1`–`N28` across four tiers (static lint /
  build+type / deterministic-render oracles / perceptual review).
- **Hard error**: blocks lock/render/done. **Warning**: advisory, does not block.

## Requirements

### Requirement 1: Prompt-to-spec planning (PICK mode)

**User Story:** As a creator, I want to give a topic prompt and a duration preset
and have AI plan a structured video spec using existing registered components, so
that I get a coherent news video without choosing layouts myself.

#### Acceptance Criteria

1. WHEN a user runs `create` with a prompt and a duration preset (60/90/120/180),
   THEN the system SHALL produce a `video-spec.json` conforming to the
   `VideoSpec` schema in `@news/schema`.
2. THE planner SHALL only emit `component` ids returned by `listComponents()`
   (PICK mode); it SHALL NOT invent component ids that are not in the registry.
3. THE planner SHALL be given the component catalog (id + `promptGuide` +
   `example` + prop schema) and the content contract as planning context.
4. WHEN the prompt lacks audience/context, THE planner SHALL assume the default
   Vietnamese 25–34 audience profile and build a hidden creative brief (audience,
   pain, angle, central tension, allowed evidence, tone, takeaway) without
   emitting that brief into the spec.
5. THE generated spec SHALL set `version: 1`, `styleId: "clean-luxury-tech"`,
   `ratio: "9:16"`, `language: "vi"`, and `duration` equal to the requested
   preset.
6. WHEN the AI planner is not configured (no API key) and mock planning is used,
   THE system SHALL produce a structurally valid spec without inventing sources,
   prices, benchmarks, or quotes.

### Requirement 2: Spec structural and per-component prop validation

**User Story:** As a maintainer, I want every spec validated against structural
rules and each component's own schema before any expensive step, so that invalid
specs fail fast and cheaply.

#### Acceptance Criteria

1. WHEN a spec is produced or loaded, THE system SHALL run
   `validateVideoSpecStructure` covering: scene count within `SCENE_BOUNDS` for
   the preset, scene `durationInSeconds` summing to the preset, sequential
   `scene-NN` ids, single-paragraph narration, and headline length limits.
2. IF a scene references a `component` id not present in the registry, THEN the
   system SHALL raise a hard error (`N2`) and SHALL NOT proceed to TTS.
3. WHEN validating a scene's `props`, THE system SHALL call
   `validateProps(componentId, props)` against that component's Zod schema and
   SHALL raise a hard error (`N3`) listing the failing field path on any
   missing, extra, or invalid field.
4. WHEN narration word counts fall below the `SCENE_PACING` minimum for the
   preset, THE system SHALL report a pacing issue.
5. IF any hard error is present, THEN the system SHALL return the aggregated
   issues to the planning loop and SHALL NOT lock timing or render.

### Requirement 3: Vietnamese and TTS content-rule enforcement

**User Story:** As an editor, I want on-screen and spoken text to follow the
Vietnamese/TTS rules, so that the video never shows unprofessional phonetic
spellings or unreadable numbers.

#### Acceptance Criteria

1. IF any display or narration field contains a phonetic spelling (e.g.
   `Ô pân A I`, `Gút gồ`, `Đíp xích`, `Giê mi nai`, `A Pê I`), THEN the system
   SHALL raise a hard error (`N6`).
2. IF any field contains a spaced abbreviation (`A I`, `A P I`, `G P T`,
   `L L M`), THEN the system SHALL raise a hard error (`N7`).
3. IF a narration field contains display-style numbers (`92%`, `$1.5M`, `2026`),
   THEN the system SHALL report that numbers must be spelled out naturally in
   Vietnamese for narration.
   > **Superseded (author-mode-v2, hướng B):** narration may now use DIGITS;
   > the TTS layer reads them as natural Vietnamese. N8 only warns on forms the
   > reader can't voice (`$`, `1.5M`). Display still stays compact.
4. IF a display field contains spelled-out numbers (e.g.
   `năm hai nghìn không trăm hai mươi sáu`), THEN the system SHALL report that
   display numbers must stay compact (`N8`, warning).
5. THE system SHALL reject specs that contain subtitle/caption/transcript/karaoke
   fields or any media payload (`assetRef`, image/logo URL, screenshot, demo,
   upload, auto-fetch instruction).

### Requirement 4: Evidence gate and no-hallucination

**User Story:** As an editor, I want the planner blocked from inventing facts, so
that the video only states what the prompt or supplied context actually contains.

#### Acceptance Criteria

1. THE content lint SHALL flag invented sources, dates, prices, percentages,
   benchmarks, or quotes that are not present in the prompt or supplied context
   as a hard error (`N9` invention class).
2. WHEN a scene uses a high-evidence component (e.g. metric/news/testimonial
   style) without supplied evidence, THE system SHALL report a template-fit
   warning (`N28`).
3. IF list-style payloads contain manual numbering (`1.`, `Bước 01`), THEN the
   system SHALL report a style warning, since components own their numbering.
4. WHEN `scene-01` opens with a greeting or a definition, THE system SHALL report
   a hook-quality warning (`N26`).
5. WHEN the final scene uses a generic CTA (subscribe/like/follow/comment or a
   vague "Bạn nghĩ sao?"), THE system SHALL report a CTA-quality warning (`N27`).

### Requirement 5: TTS synthesis and measured-duration locking

**User Story:** As a creator, I want narration synthesized with my configured
Vivibe voice and the timeline locked to the real audio length, so that scenes are
never cut off and timing matches the voice.

#### Acceptance Criteria

1. WHEN TTS runs, THE system SHALL synthesize narration per scene via
   `@news/tts` using the voice configured in `.env`.
2. IF Vivibe is configured but a required API key, endpoint, or voice id is
   missing, THEN the system SHALL stop and report the exact missing setting and
   SHALL NOT silently fall back to mock or a default voice.
3. THE system SHALL measure each scene's true audio duration and SHALL derive
   per-scene `durationInFrames` from the measured seconds via `secondsToFrames`
   (FPS = 30), not from the planner's target seconds.
4. WHEN locking produces a `LockedVideoSpec`, THE system SHALL pass
   `validateLockedTimings` (contiguous timeline, ends exactly at total
   `durationInFrames`) (`N12`); otherwise it SHALL raise a hard error.
5. IF the resulting `renderDuration` exceeds the requested preset but the voice
   is complete, uncut, and unrushed, THEN the system SHALL NOT rerender solely
   for being longer.
6. THE system SHALL produce one concatenated narration track and SHALL
   optionally mix BGM when a BGM source is configured.
7. WHEN a scene declares an `sfx` cue (`transition`/`alert`/`emphasis`/
   `success`), THE system SHALL place the corresponding cue, ducked under the
   narration; `none` SHALL add no cue.

### Requirement 6: Deterministic Remotion render to MP4

**User Story:** As a creator, I want the locked spec rendered to an MP4 through
Remotion, so that I get a finished 9:16 video file.

#### Acceptance Criteria

1. WHEN rendering, THE system SHALL render the `NewsVideo` composition driven by
   the locked spec passed as `inputProps`, deriving `durationInFrames`/`fps` via
   `calculateMetadata`.
2. THE renderer SHALL support both the Remotion CLI path and the Node
   `@remotion/renderer` path, and both SHALL produce identical output for the
   same locked spec.
3. WHEN a scene's `component` id resolves in the registry, THE composition SHALL
   render that component; IF it does not resolve, THEN a visible error panel
   SHALL render (a bug signal, since `N2` should have blocked it earlier).
4. THE system SHALL play the single mixed narration track over the timeline using
   Remotion's audio, without requiring manual frame-level audio padding.
5. WHEN rendering completes, THE system SHALL write the MP4 to
   `.video-tool/projects/<id>/renders/<id>.mp4` and report its path.

### Requirement 7: Determinism and caching

**User Story:** As a maintainer, I want renders to be reproducible and cached, so
that identical specs do not re-synthesize audio or re-render frames.

#### Acceptance Criteria

1. THE system SHALL forbid `Math.random`, `Date.now`/`Date`, network calls, and
   filesystem access inside scene component code; randomness SHALL come only from
   Remotion's `random(seed)`.
2. WHEN the same frame of the same locked spec is rendered twice, THE output
   SHALL be byte-identical (`N16`).
3. THE system SHALL cache TTS audio keyed by `text + voiceId + speed` and reuse
   it when narration is unchanged.
4. THE system SHALL cache renders keyed by a stable hash of the
   `LockedVideoSpec`; WHEN the locked spec is unchanged, THE system SHALL reuse
   the cached MP4.
5. WHEN any narration text changes, THE locked audio path SHALL change, THEREBY
   changing the spec hash and invalidating the render cache.

### Requirement 8: Safety grid runner (tiers and severity)

**User Story:** As a maintainer, I want a single runner that executes the safety
grid in tiers and enforces severity, so that hard defects block export while
advisory issues are surfaced but non-blocking.

#### Acceptance Criteria

1. THE system SHALL provide a static grid runner (Tier 1 + Tier 2) that runs on
   the spec before TTS/lock and returns a `SafetyReport` of issues with
   `check`, `severity`, optional `sceneId`/`path`, and `message`.
2. THE `SafetyReport.ok` SHALL be `false` if and only if at least one issue has
   severity `error`.
3. IF the static grid reports any hard error, THEN the pipeline SHALL NOT proceed
   to TTS, lock, or render.
4. WHEN Tier 2 build checks run, THE system SHALL fail hard on TypeScript
   typecheck failure (`N10`), Remotion bundle failure (`N11`), locked-timing
   failure (`N12`), or missing/empty scene audio (`N13`).
5. WHEN multiple tiers run, THE aggregate gate SHALL block if any requested tier
   contains an error, and SHALL list every issue across tiers.
6. WHEN a warning-severity issue is present without any error, THE system SHALL
   surface it but SHALL allow the pipeline to proceed.

### Requirement 9: Deterministic-render oracles **[Phase 2]**

**User Story:** As a maintainer, I want post-render oracles that inspect rendered
frames, so that layout, overflow, and motion defects are caught automatically.

#### Acceptance Criteria

1. THE system SHALL provide a render-tier runner that operates on rendered frames
   or per-scene stills and returns a `SafetyReport`.
2. THE render oracles SHALL include, at minimum: 9:16 safe-area/overflow (`N14`,
   hard), block overlap (`N15`, hard), determinism (`N16`, hard), text
   truncation (`N17`, hard), contrast/font availability (`N18`, warning),
   dead-air/blank frames (`N19`, warning), pacing (`N20`, warning),
   transition/flicker (`N21`, warning), audio-sync (`N22`, warning), and visual
   richness (`N23`, warning).
3. Each oracle SHALL have a non-vacuous self-test proving it fires on a known-bad
   input.

### Requirement 10: Perceptual review loop gate

**User Story:** As a creator, I want a mandatory keyframe review before a video is
declared done, so that defects invisible to automated checks are caught by eye.

#### Acceptance Criteria

1. WHEN a render completes, THE system SHALL extract one keyframe per scene and
   assemble a contact sheet under `.video-tool/projects/<id>/review/` (`N24`).
2. THE system SHALL NOT declare a project "done" until the self-critique
   checklist (safe-area, alignment, transitions, clutter, hook, CTA, audio,
   richness) is completed and recorded (`N25`).
3. WHEN the review gate passes, THE system SHALL report the MP4 path and stop;
   it SHALL NOT start extra screenshot/preview/QA loops unless the user asks.
4. IF the review checklist is incomplete, THEN the project SHALL be treated as
   not done (hard process gate).

### Requirement 11: Project storage and workspace hygiene

**User Story:** As a maintainer, I want each video stored as a self-contained
project with strict hygiene, so that the repo root stays clean and artifacts are
easy to manage.

#### Acceptance Criteria

1. THE system SHALL store all generated artifacts under
   `VIDEO_TOOL_HOME/.video-tool/` with each video in `projects/<id>/` containing
   brief, spec, lock, tts-manifest, audio, renders, review, and logs.
2. THE system SHALL keep shared regenerable caches under `cache/tts/` and
   `cache/renders/`.
3. THE system SHALL NOT write ad-hoc specs, screenshots, scratch files, or MP4s
   to the repository root.
4. THE system SHALL treat `node_modules`, `dist`, `cache/tts`, successful
   renders, and `.env` as user-owned runtime state and SHALL NOT delete them
   unless explicitly asked.
5. WHEN cleanup is uncertain, THE system SHALL quarantine artifacts under
   `.cleanup-quarantine/<timestamp>/` instead of deleting them.

### Requirement 12: CLI / Studio entry points and required checks

**User Story:** As a creator, I want clear commands to create, preview, render,
and diagnose projects, so that I can run the whole pipeline from the terminal.

#### Acceptance Criteria

1. THE system SHALL provide CLI verbs: `create <prompt> --duration`, `preview
   <id>`, `render <id>`, and `doctor`/`probe`, plus the existing `studio` script.
2. WHEN `doctor`/`probe` runs, THE system SHALL verify `.env` (Vivibe key/voice),
   ffmpeg availability, browser availability, and registry health, and report any
   missing item.
3. WHEN `preview <id>` runs, THE system SHALL open a Remotion player/Studio on the
   project's draft or locked spec.
4. THE project SHALL provide `npm run typecheck`, `npm test`, and `npm run build`,
   where `npm test` covers registry, validators, the static grid (`N1`–`N9`), and
   `lockSpec` timing, each oracle with a non-vacuous self-test.
5. WHEN a render is requested with no voice (visual draft / smoke), THE system
   SHALL render the bundled sample spec without requiring Vivibe.

### Requirement 13: AI AUTHOR mode and admission gate **[Phase 2]**

**User Story:** As a creator, I want AI to author brand-new scene components when
existing ones do not fit, so that visuals are not limited to the current catalog.

#### Acceptance Criteria

1. WHEN AI authors a new scene component, THE module SHALL export a default
   `registerComponent(...)` result, a named `schema` (Zod object), and a named
   `example` that parses against `schema`.
2. BEFORE an authored module is imported or executed, THE system SHALL run a
   static AST admission gate enforcing an import whitelist (`react`, `remotion`,
   `@news/design`, `@news/compositions`, `zod`) and a banned-API blacklist
   (`Math.random`, `Date.now`/`Date`, `fetch`/network, `fs`, `eval`/`Function`,
   `require`/dynamic import, `process`, `dangerouslySetInnerHTML`) (`N4`, `N5`).
3. IF an authored module imports outside the whitelist or references any banned
   API, THEN admission SHALL fail with the listed violations and the component
   SHALL NOT be registered.
4. AN authored component SHALL be referenceable by the planner only after it
   passes admission, a clean TypeScript typecheck, and registration.
5. AUTHORED scene code SHALL execute only within the Remotion render context
   (no Node `fs`/`process` access from scene code).

### Requirement 14: Phase-1 end-to-end test render

**User Story:** As the user, I want to render one real test video on an arbitrary
topic after Phase 1, so that I can confirm the pipeline produces a usable MP4.

#### Acceptance Criteria

1. WHEN Phase 1 is complete, THE system SHALL plan, validate, synthesize TTS,
   lock, render, and review one video on an arbitrary prompt end-to-end.
2. THE test render SHALL produce a playable 9:16 MP4 at
   `.video-tool/projects/<id>/renders/<id>.mp4` and a contact sheet under
   `review/`.
3. WHEN Vivibe is unavailable during the test, THE system SHALL still produce a
   no-voice visual draft from the bundled sample spec so the render path is
   verifiable.
4. THE Phase-1 path SHALL pass `npm run typecheck`, `npm test`, and
   `npm run build` before the test render is considered valid.
