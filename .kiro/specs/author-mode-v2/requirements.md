# Requirements Document

## Introduction

`author-mode-v2` evolves `news_remotion_tool` from the PICK-mode pipeline
(planner chooses one of a fixed set of registered scene components) into a
**pure AUTHOR-mode** pipeline: for every video, the AI **writes brand-new
Remotion (React) scene code** — the Manim-spirit "freedom" — composing a small
library of reusable, slot-based **layout blocks** for on-brand consistency.
Quality is held by the enumerated safety grid (admission gate + render oracles +
review loop). This supersedes the PICK-mode parts of the `render-pipeline` spec;
that spec is kept as historical record.

This version also fixes two concrete defects observed in the first AUTHOR render
(hard slide-like scene cuts; rushed/clipped voice at scene boundaries), adds real
scene transitions, frees the rigid pacing model, makes each project a
self-contained, resumable unit, and refactors the package layout to scale.

It also adopts a set of **design-direction preferences** that shape how the AI
authors every scene (Requirements 15–18): drop the fixed top-left
eyebrow+headline header convention; bias primary content toward an upper
**content zone** so the bottom stays clear for short-platform UI; **burn in
Vietnamese captions** so the video is comprehensible with sound off; use a
**squared (un-rounded), clearly-delineated** block language on a **neutral
default background** that stays legible across dark / bright / glare viewing
conditions; and make bespoke per-scene imagery a deliberate choice (plain
text/list layouts are first-class — not every scene needs to be "visualized").

> **Caption-rule reversal (deliberate).** Earlier project rules (`N9`,
> `AGENTS.md`, `docs/ai-content-guide.md`, `designNotes`) hard-banned subtitles /
> captions. Requirement 16 intentionally **supersedes** that ban: burned-in
> captions are now a required feature. Those rules and the N9 caption clause are
> updated for consistency (Requirements 13.3, 16).

Scope is strictly `news_remotion_tool`. `math_video_tool` / `news_video_tool`
remain reference designs only and are not modified.

### Constraints and Assumptions

- **Fixed render contract**: FPS = 30, canvas 1080×1920 (9:16), language `vi`.
- **Determinism is mandatory**: scene/block visuals are pure functions of the
  frame; randomness only via Remotion `random(seed)`.
- **TTS**: Vivibe/LucyLab via `@news/tts`, configured in `.env`. Voice is real;
  never silently downgraded.
- **AI authority**: the external authoring AI is driven in-session (no AI API
  key); it writes scene `.tsx` that pass the admission gate.
- **Remotion license**: free tier (individual / non-profit) assumed.

## Glossary

- **Authored scene**: an AI-written `.tsx` module under `projects/<id>/authored/`
  that self-registers exactly one scene component (default `registerComponent`
  result + `schema` + `example`).
- **Block**: a reusable, slot-based layout primitive in `@news/blocks` (e.g.
  `IdeaPanel`, `KeyPoints`, `Callout`, `StatChip`, `Frame`, `Content`,
  `StoryHeader`) that authored scenes compose. A block is an empty themed
  container the AI fills; it is NOT a content template.
- **Admission gate**: the static AST check (`admitAuthoredComponent`, N4/N5) that
  every authored scene must pass before it is bundled or executed.
- **Manifest**: `projects/<id>/manifest.json`, the per-project spec (theme
  dominant color, ordered scenes with authored component id + props + narration).
- **Transition window**: the overlap region between two scenes where a
  `TransitionSeries.Transition` plays; designed to coincide with a silent breath
  gap in the narration so no speech is clipped.
- **Content zone**: the vertical band (top safe margin → ~62% of canvas height)
  where a scene's primary content must live, so it is not covered by the bottom
  caption band or platform UI on short-video apps.
- **Caption band**: the lower-middle band (~64%–84% of height, with horizontal
  margins clearing the right-side action rail) reserved for burned-in captions.
- **Platform-UI reserve**: the bottom ~16% and a right-edge column kept clear of
  content/captions because TikTok / Reels / Shorts overlay their own UI there.
- **Caption cue**: a `{ startFrame, endFrame, text }` segment (derived from
  narration + TTS timing) baked into the locked spec and rendered in the caption
  band; deterministic (frame-driven), not a live transcript.
- **Hard error / Warning**: hard blocks render/done; warning is advisory.

## Requirements

### Requirement 1: Pure AUTHOR-mode authority (remove PICK)

**User Story:** As the creator, I want every video's scenes to be brand-new
AI-authored code, so that videos are genuinely diverse and not reused templates.

#### Acceptance Criteria

1. THE system SHALL remove PICK-mode: the fixed scene templates
   (`packages/compositions/src/scenes/*`) and the planner catalog/mock/prompt
   (`packages/pipeline/src/planner/*`) SHALL be deleted.
2. THE registry SHALL be populated only by AUTHORED scene modules that
   self-register; importing `@news/compositions` SHALL NOT auto-register any
   built-in scene templates.
3. A scene component id SHALL be referenceable by a manifest ONLY after its
   authored module passes the admission gate and registers successfully.
4. THE system SHALL NOT contain any "choose a template" guidance path.

### Requirement 2: Reusable slot-based block library (`@news/blocks`)

**User Story:** As the authoring AI, I want reusable themed containers to drop my
ideas into, so I don't re-code boilerplate and can spend effort on bespoke
imagery while staying on-brand.

#### Acceptance Criteria

1. THE system SHALL provide a new package `@news/blocks` exporting slot-based
   layout blocks including at least `Frame`, `Content`, `StoryHeader`,
   `IdeaPanel`, `KeyPoints`, `Callout`, and `StatChip`.
2. EACH block SHALL be a generic container (accepts children/props), SHALL pull
   color/spacing/type from the active per-project theme, and SHALL respect the
   9:16 safe area; blocks SHALL NOT hard-code video-specific content.
3. BLOCKS SHALL be deterministic (no `Math.random`/`Date`/network/fs) and SHALL
   pass the same forbidden-API lint as authored scenes.
4. THE admission whitelist SHALL include `@news/blocks` so authored scenes may
   import blocks.
5. WHEN a video needs a key-points / recap summary, THE authoring AI SHALL be
   able to compose `KeyPoints`/`IdeaPanel` without writing new container code.

### Requirement 3: Real scene transitions

**User Story:** As a viewer, I want smooth transitions between scenes, so the
video does not feel like hard-cut slides.

#### Acceptance Criteria

1. THE master composition SHALL render scenes via `@remotion/transitions`
   `TransitionSeries` with a `TransitionSeries.Transition` between adjacent
   scenes.
2. THE default presentation SHALL be `slide()`; recap/CTA boundaries MAY use
   `fade()`. Timing SHALL be deterministic (`linearTiming`/`springTiming`).
3. `@remotion/transitions` SHALL be added pinned to the installed Remotion
   version (`4.0.472`).
4. Transitions SHALL be frame-deterministic so determinism (N16) still holds.

### Requirement 4: Natural narration with breathing room

**User Story:** As a viewer, I want a natural pause between scenes, so the voice
is not rushed or clipped at boundaries.

#### Acceptance Criteria

1. THE TTS assembly SHALL insert a configurable silent breath gap between
   consecutive scene narration clips.
2. THE TTS text preparation SHALL NOT convert a sentence-final period into a
   comma; sentence-final intonation SHALL be preserved.
3. THE breath gap duration SHALL be a single shared constant in `@news/schema`
   reused by TTS, lock, and the composition.

### Requirement 5: Transition-aware locked timing (audio stays in sync)

**User Story:** As a maintainer, I want the video length to equal the narration
length even with overlapping transitions, so audio never drifts.

#### Acceptance Criteria

1. THE narration SHALL be one continuous top-level audio track (outside the
   transition sequences).
2. WHEN transitions of `T` frames are used between `n` scenes, THE lock SHALL
   size sequences so the total video frames equal the assembled audio length
   (speech segments + `(n-1)` breath gaps), so each transition overlap coincides
   with a silent breath gap and no speech is clipped.
3. `validateLockedTimings` SHALL pass for the transition-aware timeline (N12).

### Requirement 6: Free pacing

**User Story:** As the creator, I want flexible video length and scene count, so
I am not boxed into rigid presets.

#### Acceptance Criteria

1. THE structural validation SHALL NOT enforce fixed scene-count bounds or a
   fixed duration preset; scene count and total duration SHALL be free.
2. THE system SHALL still require sequential `scene-NN` ids and single-paragraph
   narration per scene.
3. `duration` SHALL be treated as an optional pacing target, not a hard
   constraint; a longer measured `renderDuration` SHALL NOT be an error.
4. THE content guidance SHALL still recommend a strong hook first and a
   topic-specific recap/CTA last (advisory, not blocking).

### Requirement 7: Layout & quality oracles wired before free authoring

**User Story:** As a maintainer, I want automated guardrails on AI-authored
layout, so free-coded scenes that overflow, overlap, or desync are caught.

#### Acceptance Criteria

1. THE render-tier oracles SHALL be wired into the render loop: `N14`
   safe-area/overflow + caption-clearance (hard), `N18` contrast, `N19`
   dead-air, `N20` pacing, `N21` transition/flicker, `N22` audio-sync, `N28`
   duration target, `N29` captions, and `N30` content density (advisory
   warnings). `N15` overlap, `N17` truncation (rect/box-fed), and `N23`
   richness (multi-frame; masked by the always-on ambient tilt) are exported +
   self-tested but NOT auto-run, because a flat midpoint still lacks the inputs
   they need; they are available to callers that supply those inputs.
2. EACH oracle SHALL ship a non-vacuous self-test proving it fires on a
   known-bad input.
3. THE oracles SHALL be available BEFORE pure free authoring is enabled in the
   pipeline (delivered alongside PICK removal, not after).
4. WHEN a hard oracle reports an error, THE pipeline SHALL NOT declare the
   project "done".

### Requirement 8: Self-contained project unit

**User Story:** As the creator, I want each video fully inside its own folder, so
deleting the folder removes everything and nothing scratch is left behind.

#### Acceptance Criteria

1. EACH project SHALL store its manifest, authored scenes, audio, locked spec,
   renders, and review artifacts under `projects/<id>/`.
2. DELETING `projects/<id>/` SHALL remove the entire video (only shared,
   regenerable caches may live outside).
3. PROCESS scratch (generated bundle entry, ffmpeg concat lists, temp frames)
   SHALL be auto-removed when a render completes.
4. THE system SHALL NOT write scratch specs/scripts/MP4s to the repo root.

### Requirement 9: Resumable and shared caching

**User Story:** As the creator, I want re-renders and interrupted runs to reuse
work already done, so I never re-synthesize identical voice or re-render
unchanged output.

#### Acceptance Criteria

1. TTS audio SHALL be cached keyed by `text + voiceId + speed`; unchanged
   narration on a re-render SHALL reuse the cached clip without re-synthesizing.
2. IF TTS synthesis is interrupted, THEN a subsequent run SHALL resume only the
   missing/unfinished scene clips (already-synthesized clips SHALL be reused).
3. RENDER output SHALL be cached keyed by a stable hash of the locked spec; an
   unchanged locked spec SHALL reuse the cached MP4.
4. THE caches SHALL be shared by default; a `--no-cache` flag SHALL force fresh
   synthesis/render.
5. WHEN narration text changes, THE affected scene's TTS key SHALL change,
   invalidating only that clip and the render hash.

### Requirement 10: Productionized AUTHOR render path (no scratch runner)

**User Story:** As the creator, I want simple commands to scaffold and render an
authored project, so I don't depend on ad-hoc scripts.

#### Acceptance Criteria

1. THE system SHALL generate a per-project Remotion entry that imports the
   project's authored scenes (registering them) and the master composition, then
   bundle THAT entry for render.
2. BEFORE bundling, EVERY authored scene SHALL pass the admission gate; a
   rejected scene SHALL block the render with its violations.
3. THE CLI SHALL provide `author scaffold <id>` (create project skeleton +
   empty manifest) and `render <id>` (admit → TTS → lock → bundle → render →
   review → clean). A FULL render SHALL require a prior draft for the project
   (draft-first); `render <id> --draft` produces the low-res preview and
   `--force-full` overrides the gate.
4. THE pipeline SHALL run end-to-end from a manifest + authored scenes without a
   hand-written runner script.

### Requirement 11: Scalable, standard file structure

**User Story:** As a maintainer, I want a clean layered package structure, so the
codebase scales and stays stable.

#### Acceptance Criteria

1. THE packages SHALL be layered with single responsibilities:
   `@news/schema` (contract + shared timing constants), `@news/design` (tokens +
   color/motion), `@news/blocks` (slot-based blocks), `@news/compositions`
   (registry + theme context + master composition), `@news/pipeline`
   (orchestration), `apps/remotion` (Studio host).
2. `@news/pipeline/src` SHALL be grouped by concern (e.g. `authoring/`,
   `render/`, `audio/`, `safety/`, `store/`, `cli/`).
3. SHARED timing constants (FPS, transition frames, breath gap) SHALL live in
   `@news/schema` as the single source of truth.
4. THE dependency graph SHALL have no import cycles.

### Requirement 12: Determinism preserved

**User Story:** As a maintainer, I want renders reproducible, so caching and
review stay valid.

#### Acceptance Criteria

1. AUTHORED scenes and blocks SHALL be pure functions of the frame; `Math.random`
   / `Date` / network / fs SHALL be forbidden (admission gate + lint).
2. RENDERING the same locked spec frame twice SHALL be byte-identical (N16).
3. TRANSITIONS SHALL derive only from frame-based timing functions.

### Requirement 13: Authoring contract documentation

**User Story:** As the authoring AI, I want a clear contract, so authored scenes
reliably pass admission and look on-brand.

#### Acceptance Criteria

1. THE system SHALL provide an authoring guide (steering doc) describing the
   required exports, the import whitelist (incl. `@news/blocks`), the banned
   APIs, the available blocks, the content-zone / caption-band / platform-UI
   reserve layout zones, the squared/neutral design language, and the
   safe-area/design rules.
2. THE guide SHALL state that scenes compose blocks for text/structure and
   author code only for bespoke imagery, AND that a plain text/list layout is a
   valid first-class choice (per Requirement 18).
3. `AGENTS.md` and `docs/ai-content-guide.md` SHALL be updated to reflect
   AUTHOR-only mode (no PICK/template language), AND to reflect the design
   direction: captions are now REQUIRED (the prior no-caption rule and the N9
   caption clause SHALL be removed/inverted), content lives in the content zone,
   and the squared/neutral look is the default.

### Requirement 14: Migration safety

**User Story:** As a maintainer, I want each change wave verified, so the repo is
never left broken.

#### Acceptance Criteria

1. AFTER each wave, `npm run typecheck`, `npm test`, and `npm run build` SHALL
   pass.
2. PICK-era tests (template registry tests, planner tests) SHALL be removed or
   rewritten for AUTHOR mode.
3. NEW capabilities (blocks, transitions timing, oracles, resumable cache) SHALL
   each ship with tests/self-tests.

### Requirement 15: Vertical content placement & layout zones

**User Story:** As the creator, I want content placed in the upper part of the
frame and the bottom kept clear, so short-platform UI and captions never cover
the message — and I want the old top-left header convention gone.

#### Acceptance Criteria

1. THE system SHALL define shared layout-zone constants in `@news/schema`:
   a **content zone** (top safe margin → ~62% of the 1920px height), a
   **caption band** (~64%–84% of height), and a **platform-UI reserve**
   (bottom ~16% + a right-edge action-rail column).
2. AUTHORED scenes' primary content SHALL be placed within the content zone;
   the `Content` block SHALL default its column to the content zone (not the
   full frame) and SHALL bias content toward the upper/middle rather than
   pinning it to the very top.
3. THE fixed top-left `eyebrow` + big-`headline` header convention (the current
   `StoryHeader` layout) SHALL be removed; no block SHALL render a default
   small-uppercase eyebrow above a left-pinned headline at the top-left corner.
4. THE safe-area oracle (N14) SHALL treat content rendered inside the caption
   band or platform-UI reserve as an error (content must stay in the content
   zone), distinct from the caption track which is allowed in the caption band.

### Requirement 16: Burned-in captions for sound-off comprehension

**User Story:** As a viewer scrolling with sound off, I want on-screen captions,
so I can understand the video without audio.

#### Acceptance Criteria

1. THE rendered MP4 SHALL include burned-in Vietnamese captions derived from
   each scene's `narration`; captions SHALL render as a **single line** at a
   time within the caption band (no multi-line stacks). The active word SHALL be
   highlighted with a smooth eased ramp (word-paged karaoke), timed from the TTS.
2. CAPTION cues (`{ startFrame, endFrame, text }`) SHALL be baked into the
   locked spec so caption rendering is a pure function of the frame
   (deterministic, N16-safe); captions SHALL NOT be fetched or computed at
   render time from the network.
3. CAPTION timing SHALL be derived from the TTS provider's per-scene SRT
   (Vivibe `srtUrl`, captured and used) when available; WHEN no SRT is available
   (e.g. mock/none provider), THE system SHALL fall back to splitting the scene
   narration into single-line cues distributed evenly across the scene's speech
   frames.
4. CAPTION text SHALL be segmented into short single-line cues that fit the
   caption band width at the caption font size (long sentences split into
   sequential cues); a cue SHALL NOT overflow or be truncated/ellipsized.
5. THE prior caption ban SHALL be lifted: the N9 caption clause, `AGENTS.md`,
   `docs/ai-content-guide.md`, and `designNotes` SHALL no longer forbid
   captions. (Media/asset bans remain; word-paged karaoke highlight is now in scope.)
6. CAPTIONS SHALL be styled for legibility across lighting (high-contrast fill
   plus a paper halo/outline behind the ink text, no caption box) and SHALL stay
   within the caption band, clear of the platform-UI reserve, below the global
   content/caption divider line.

### Requirement 17: Squared, clearly-delineated design on a neutral base

**User Story:** As the creator, I want a clean angular look on a neutral
background, so blocks read clearly in any lighting and match my taste.

#### Acceptance Criteria

1. THE design tokens SHALL use a squared language: corner radius SHALL default
   to `0` (or a single near-zero hairline value); blocks SHALL NOT render
   pill/rounded-card shapes by default.
2. EACH content block SHALL be visually delineated as a distinct unit (e.g. via
   a bold ink border, an accent top-rule, a hard offset shadow, or clear
   separation) rather than floating ambiguously.
3. THE default theme SHALL provide a **light, warm cream paper base** (paper
   ≈ `#F2ECDC` with near-black ink text and bold ink borders) chosen for
   legibility across dark / bright / glare viewing conditions; the base SHALL NOT
   be heavily tinted by the per-project dominant hue, and SHALL NOT be dark. The
   dominant color SHALL drive accents / data-viz, not the base wash.
4. THE contrast oracle (N18, where wired) SHALL still pass for foreground text
   and captions on the cream base for any allowed dominant.

### Requirement 18: Selective visualization (not every scene is "visualized")

**User Story:** As the creator, I want some scenes to be simple text/lists, so
the video isn't forced to over-illustrate every point.

#### Acceptance Criteria

1. THE authoring contract SHALL state that a plain text or enumerated-list
   layout (e.g. composing `KeyPoints` / `IdeaPanel`) is a valid, first-class
   scene — bespoke imagery is NOT required on every scene.
2. THE contract SHALL give guidance on WHEN to author bespoke imagery (a
   concept benefits from a diagram/visual metaphor/data viz) vs. WHEN a clean
   text/list scene is the honest, stronger choice (enumerations, definitions,
   takeaways, recaps).
3. THE guidance SHALL discourage decorative visuals that add no meaning
   (visual filler), while still encouraging variety across the video.
4. NO oracle SHALL hard-fail a scene merely for being text/list-only; richness
   (N23, advisory) MAY still flag a video that is monotonous overall.
