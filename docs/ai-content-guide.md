# AI Content Guide

This guide is for any AI that authors video content for `news_remotion_tool`. The
contract: write brand-new Remotion (React) scene modules AND produce a project
manifest; the app owns admission, TTS, locking, captions, and MP4 export.

Adapted from `news_video_tool`'s content guide. The stack changed (pure AUTHOR
mode — every scene is raw JSX/SVG written by hand, no block library or fixed
templates), but the Vietnamese / TTS / evidence / story rules are unchanged and
are enforced by `packages/pipeline/src/safety/content-rules.ts` (N6–N9, N26, N27).

## Operating Mode

- Author one `.tsx` scene module per distinct visual under the project's
  `authored/` dir (each self-registers via `registerComponent` and exports
  `default`/`schema`/`example`), and fill `manifest.json` referencing those
  authored component ids with Zod-valid `props` + narration.
- Write every scene as **raw JSX/SVG by hand** — there is no block toolkit to
  compose (it was deleted). Build containers/cards/lists/figures from `<div>`/
  `<svg>` + inline style; the one authored-facing import is `{ SceneImage } from
  "@news/compositions"` for the image feature. A plain text/list scene is a valid
  first-class choice.
- **Vary the visual form; don't repeat one arrangement.** For each scene pick a
  form that fits the content from `docs/visualization-playbook.md`, and author
  bespoke topic-specific imagery for the signature beats. Reusing one project's
  components for the next video (swapping only text) is a FAIL — a video that is
  mostly the same arrangement repeated is lazy.
- A manifest may reference an authored id only AFTER its module passes the
  admission gate (import whitelist + banned-API blacklist + required exports).
- Preserve the configured TTS provider/voice. If Vivibe is configured, use it;
  do not silently fall back to `mock`/`none` unless the user asks for no voice.
- If TTS config is missing a key/endpoint/voice, stop and report the exact
  setting. Do not substitute a lower-quality voice.
- **Always render a low-res DRAFT first and show it to the user** before the full
  render; only do the full-quality render after they approve (or ask to skip).
- After the final MP4 renders and the review gate passes, stop and report the
  output path. No extra screenshot/preview/QA loops unless asked.

## Output Contract

- The AUTHOR manifest carries `title`, optional `hashtags`, `theme.dominant`,
  and ordered scenes. The desktop backend injects `format`, `durationTier`, and
  `videoLanguage` from the user's UI choice; the renderer derives the rest.
  `styleId: "clean-luxury-tech"` is a legacy discriminator, not a look;
  `ratio` is derived from `format`; `language` is `vi` or `en`.
- Current format status: TikTok 9:16 is the stable end-to-end production path.
  YouTube 16:9 has schema/prompt/thumbnail plumbing, but long-form
  author-by-segment + true 16:9 main-video production is still pending Group J.
- **Free pacing**: there is NO fixed duration preset and NO scene-count bound.
  `duration` is an optional pacing target only; scene count and total length are
  free. Use as many scenes as the story needs.
- Scene ids are sequential: `scene-01`, `scene-02`, … Real timing follows the
  measured selected-provider TTS, so the locked render may be longer than any target —
  that is NOT an error when the voice is complete, natural, uncut, and unrushed.
- Each scene supplies `component` (an admitted authored id), `headline`,
  optional `body`/`eyebrow`, `narration`, `props` (matching that component's Zod
  schema), optional `sfx`, and optional `transitionToNext` (`slide`/`fade`).
- **Captions are generated for you**, centrally, in the selected video language
  captions from each scene's `narration` (timed from the TTS SRT). TikTok burns
  them in as word-paged karaoke; YouTube-format output omits the burned caption
  layer. Do NOT author captions/subtitles in props.
- Do not add real/external media: no `assetRef`, logo URL, image URL, screenshot,
  video demo, upload field, or auto-fetch. This does NOT restrict things you DRAW
  in SVG/CSS — figure/avatar silhouettes, icons, glyphs, diagrams, charts and
  metaphors are encouraged where they aid clarity or polish.
- Validation is strict. Missing/invalid props, unknown (un-admitted) component
  ids, or banned APIs fail before render — they are not padded or replaced with
  fake fallback content.

## Layout & design

> The LOOK is owned by `docs/design-language.md`; the menu of visual FORMS and
> the count/shape composition rules by `docs/visualization-playbook.md`. Read
> both — don't rely on this section to restate them. The only layout rules that
> matter for the content contract:

- Put a scene's primary content in the upper **content zone** (position it there
  yourself in raw JSX). The bottom **caption band** + **platform-UI reserve** must
  stay clear so short-platform UI and the burned-in captions never cover the
  message.
- **Balance the content zone.** A scene with only a short title + one line reads
  top-heavy / half-empty. Either give a sparse beat a confident visual anchor (a
  bold stat, a small bespoke diagram, a metaphor) or let one element own the zone
  — don't leave a tiny block floating at the top. (The flip side, overcrowding, is
  what N30 warns about.)
- Do NOT render a small-uppercase eyebrow above a left-pinned headline in the
  top-left corner; build a clean framed headline instead.
- Selective visualization: decompose each scene's narration/headline for an
  embedded number, relationship, change, or process, and author bespoke imagery
  that carries it (per the playbook). A clean text/list block is a deliberate
  choice for definitions/recaps/CTAs — not a default, and not meaningless
  decoration.

## Pacing

- Pacing is FREE: choose the scene count the story needs (a 45–90s short is often
  8–18 scenes; longer explainers more). There is no hard scene-count bound in
  the parser; a 1–2 scene reply is still treated as degenerate/truncated.
- Narration should sound natural at a professional Vietnamese pace. N20 flags
  scenes that are too short for their narration; the per-scene narration floor
  guards against too-fast cuts.
- **Hit the brief's duration tier (rather over than under).** TikTok tiers map to
  roughly 45s / 90s / 150s; YouTube tiers are reserved for the pending long-form
  path. N28 warns (advisory) if the finished video falls outside target ±20s. If
  you must miss, miss LONG — reach the target with more scenes / richer narration,
  never by padding holds with silence.

## Story Rules

- Default audience (no extra context): Vietnamese viewers age 25–34 — busy,
  practical, tech-aware, caring about work leverage, money, time, risk, career
  movement, business upside, opportunity cost. Sharp, useful, tech-editorial
  voice; no teen slang, childish jokes, empty hype, or academic lectures.
- Before writing scenes, silently build a hidden creative brief (target viewer,
  practical pain, main angle, central tension, allowed evidence, emotional tone,
  final takeaway). Do not output it.
- Every video needs one clear editorial tension: misconception vs reality,
  hidden cost vs shiny benefit, old vs new workflow, speed vs trust, opportunity
  vs risk, cheap-now vs expensive-later, or human judgment vs automation.
- If the prompt is thin, create interest through framing and consequences, not
  invented facts. Reveal a tradeoff, decision rule, or practical warning.
- Open with a direct hook in the first 3s. No greetings (`Xin chào`,
  `Hôm nay chúng ta sẽ`) and no generic questions (`Bạn có biết...`). Never open
  with a definition (`... là gì?`). Use a warning, paradox, specific outcome,
  uncomfortable truth, or surprising consequence (N26).
- Scene-01 headline and narration must not be the same sentence; narration adds
  a different layer.
- Build a clear arc: hook → context/stakes → twist/insight → takeaway. Break the
  middle into micro-sections; every 10–15s add a meaningful turn. Avoid
  mechanical `Tiếp theo`.
- End with a topic-specific CTA: a decision/tradeoff question or memorable
  takeaway tied to the exact subject. No generic subscribe/like/follow/comment
  or vague `Bạn nghĩ sao?` closers (N27).
- Narration must add depth beyond the headline, not just read the on-screen
  words.
- Keep display headlines short and scannable, ideally under 8 Vietnamese words,
  in natural title/sentence case (not full uppercase). Keep acronyms/model names
  uppercase only when that is their normal spelling (`AI`, `API`, `GPT`, `LLM`,
  `GPU`).
- Prefer concrete nouns, named entities, dates, prices, and percentages **when
  supplied by the prompt**.
- Do not **fabricate** facts, numbers, release dates, quotes, benchmarks, or
  source names, and never present an invented figure as fact (evidence gate,
  N9). The prompt is research material, not a verbatim script: enriching it with
  context you genuinely know/verify to be true is welcome and often sharpens the
  story — just keep anything you can't stand behind as real out of the video.

## Video Language And TTS

- `videoLanguage` applies to title, hashtags, display text, narration, CTA, and
  generated captions. Do not mix languages except for proper names and technical
  terms that naturally remain untranslated.
- For Vietnamese, prefer natural Vietnamese terms when a clear equivalent exists
  (`chi phí điện toán`, `quy trình tự động`, `thị giác máy tính`). Keep English
  for brand/product/model names, abbreviations, and precise
  technical keywords (`OpenAI`, `Google`, `AI`, `API`, `DeepSeek`, `Claude`,
  `GPT`, `Gemini`, `YouTube`, `LLM`, `token`, `prompt`, `agent`, `cache`,
  `benchmark`, `SDK`, `GPU`).
- For English, all authored viewer-facing strings must be natural English; do
  not leave Vietnamese text in scene props or JSX/SVG.
- No phonetic spellings in any field: `Ô pân A I`, `Gút gồ`, `Đíp xích`,
  `Giê mi nai`, `A Pê I` (N6). The TTS layer handles pronunciation.
- No spaced/punctuated abbreviations: write `AI`, `API`, `GPT`, `LLM`, never
  `A I`, `A P I`, `G P T`, `L L M` (N7).
- Keep numbers as **digits** in BOTH display and narration. Vietnamese uses forms
  such as `110.000`, `920 triệu`, and `ngày 5 tháng 6 năm 2026`; its TTS layer
  normalizes digits into natural Vietnamese speech. English keeps English number,
  currency, magnitude, and date conventions and is not passed through the
  Vietnamese number normalizer.
- Vivibe may only render Vietnamese projects. English projects require
  ElevenLabs; an invalid pairing is blocked before scaffold and again at TTS.

## Authoring Scenes

- Author each distinct visual as a `.tsx` module of **raw JSX/SVG written by
  hand** (no block toolkit). Keep it deterministic (no `Math.random`/`Date`/
  network/fs; use Remotion `random(seed)`).
- **Evidence gate:** do not invent a metric/number/quote/source to justify a
  data-heavy visual. If the number, source, quote, or date is not supplied or
  verified, choose a safe editorial layout (a clean title / hand-built list / a
  single statement).
- Scene-01 opens with a strong hook; the final scene is a topic-specific CTA.
- Vary the visual approach across scenes; avoid repeating the same layout back
  to back. Semantic fit always wins over novelty.
- If a list needs numbering, render the index yourself in JSX. Use the real item
  count; do not pad to fill a grid.

## Checklist Before Returning

- Every authored scene module passes admission (whitelisted imports —
  `react`/`remotion`/`@news/compositions`/`zod`, plus `SceneImage` from
  `@news/compositions` for images — no banned APIs, exports
  `default`/`schema`/`example`, one literal `registerComponent` id).
- Manifest scene ids are sequential; every `component` is an admitted authored
  id; every `props` satisfies its Zod schema.
- Scene-01 is a hook (not greeting/definition); final scene is a topic-specific
  CTA.
- Content sits in the content zone; the bottom band stays clear; no top-left
  eyebrow header; squared/neutral look.
- No media fields/`assetRef`/URLs; no caption/subtitle text in props (captions
  are generated centrally).
- No phonetic display text; no spaced abbreviations; numbers written as digits
  in both display and narration (the TTS reads them; no hand-spelled years).
- No manually numbered list items; no invented facts/sources/numbers/quotes.
- If audience/context was unspecified, the default 25–34 Vietnamese profile
  shaped the tone; the hidden creative brief was used but not emitted.
