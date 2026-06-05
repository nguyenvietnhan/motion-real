# AI Content Guide

This guide is for any AI that plans video content for `news_remotion_tool`. The
contract is narrow: produce a valid `VideoSpec` (`video-spec.json`); the app
owns the React components, visual rendering, TTS, locking, and MP4 export.

Adapted from `news_video_tool`'s content guide. The stack changed (open Remotion
component registry instead of ~40 fixed templates), but the Vietnamese / TTS /
evidence / story / pacing rules are unchanged and are enforced by
`packages/pipeline/src/safety/content-rules.ts` (N6–N9, N26, N27).

## Operating Mode

- As the planner, return only a `VideoSpec` JSON object. Do not choose TTS
  providers, write render commands, capture screenshots, or run tests.
- Emit only `component` ids returned by `listComponents()` (PICK mode). Never
  invent a component id that is not in the registry. Authored (AUTHOR-mode) ids
  are referenceable only after they pass admission + registration.
- Preserve the configured TTS provider/voice. If Vivibe is configured, use it;
  do not silently fall back to `mock`/`none` unless the user asks for no voice.
- If TTS config is missing a key/endpoint/voice, stop and report the exact
  setting. Do not substitute a lower-quality voice.
- After the final MP4 renders and the review gate passes, stop and report the
  output path. No extra screenshot/preview/QA loops unless asked.

## Output Contract

- Return JSON only. No Markdown, comments, HTML, CSS, or JS.
- `version: 1`, `styleId: "clean-luxury-tech"`, `ratio: "9:16"`,
  `language: "vi"`.
- `duration` is the target pacing preset and must equal the brief: `60`, `90`,
  `120`, or `180`.
- Scene ids are sequential: `scene-01`, `scene-02`, … and scene
  `durationInSeconds` must sum exactly to the requested duration.
- After natural Vietnamese TTS, the locked spec / render may show a longer
  `renderDuration` than the preset. That is NOT a planner error or a rerender
  reason when the voice is complete, natural, uncut, and unrushed.
- Each scene supplies `component`, `headline`, optional `body`/`eyebrow`,
  `narration`, `props` (matching that component's Zod schema), and optional
  `sfx` (`none`/`transition`/`alert`/`emphasis`/`success`).
- Do not generate subtitles, transcripts, captions, or karaoke.
- Do not add media: no `assetRef`, logo URL, image URL, screenshot, video demo,
  upload field, or auto-fetch instruction.
- Validation is strict. Missing/invalid props, unknown component ids, or
  out-of-bounds scene counts fail before render — they are not padded,
  truncated, or replaced with fake fallback content.

## Pacing

- `60s`: 10–14 scenes, target 12.
- `90s`: 14–18 scenes, target 16.
- `120s`: 18–22 scenes, target 20.
- `180s`: 24–28 scenes, target 26.
- Narration should sound natural at a professional Vietnamese pace. Word counts
  are a guide, not permission to overload a short scene (N20 flags scenes that
  are too short for their narration).

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
- Never invent facts, numbers, release dates, quotes, benchmarks, or source
  names (evidence gate, N9).

## Vietnamese And TTS

- Narration and display text are Vietnamese. Prefer natural Vietnamese terms
  when a clear equivalent exists (`chi phí điện toán`, `quy trình tự động`,
  `thị giác máy tính`).
- Keep English for brand/product/model names, abbreviations, and precise
  technical keywords (`OpenAI`, `Google`, `AI`, `API`, `DeepSeek`, `Claude`,
  `GPT`, `Gemini`, `YouTube`, `LLM`, `token`, `prompt`, `agent`, `cache`,
  `benchmark`, `SDK`, `GPU`).
- No phonetic spellings in any field: `Ô pân A I`, `Gút gồ`, `Đíp xích`,
  `Giê mi nai`, `A Pê I` (N6). The TTS layer handles pronunciation.
- No spaced/punctuated abbreviations: write `AI`, `API`, `GPT`, `LLM`, never
  `A I`, `A P I`, `G P T`, `L L M` (N7).
- Keep numbers compact in display fields so viewers can scan: `92%`, `$1.5M`,
  `2026`, `128K token`, `4/5`. Write the same values as natural Vietnamese words
  in narration (N8). Never write spoken-out numbers in display fields (use
  `2026`, not `năm hai nghìn không trăm hai mươi sáu`).

## Component Selection

- The registry is open and extensible: read each component's `promptGuide`,
  `schema`, and `example` from `listComponents()` and pick the most specific
  honest fit, then optimize for variety.
- **Evidence gate:** do not upgrade weak context into a high-evidence component
  (a metric/number/quote/source component used without supplied evidence is a
  template-fit warning, N28). If the number, source, quote, or date is not
  supplied or verified, choose a safe editorial component instead.
- Scene-01 should open with a hook component (e.g. `hero-announcement`); the
  final scene should be a CTA component (e.g. `final-cta`).
- Avoid repeating the same component in adjacent scenes. Use a varied mix; a 60s
  video should use several distinct components. Semantic fit always wins over a
  diversity quota.
- Do not manually number items inside list-style payloads (`insight-stack`,
  step lists); components own their numbering and layout rhythm.
- Use the real item count for list payloads; do not add filler items to fill a
  grid. Components adapt to shorter payloads.

## Checklist Before Returning JSON

- JSON parses with no Markdown wrapper.
- `duration` is the exact requested preset; scene ids sequential; durations sum
  to the preset.
- Every `component` id exists in the registry; every `props` satisfies its Zod
  schema.
- Scene-01 is a hook (not greeting/definition); final scene is a topic-specific
  CTA.
- No subtitles/captions; no media fields/`assetRef`/URLs.
- No phonetic display text; no spaced abbreviations.
- Display numbers compact; narration spells numbers naturally.
- No manually numbered list items.
- No invented facts/sources/numbers/quotes.
- If audience/context was unspecified, the default 25–34 Vietnamese profile
  shaped the tone; the hidden creative brief was used but not emitted.
