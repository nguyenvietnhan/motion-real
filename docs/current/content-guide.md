# Content Guide

This guide describes what authored video content should say and show.

## Audience

Default audience: busy Vietnamese viewers, roughly 25-34, practical and
tech-aware. They care about time, money, leverage, risk, career movement, and
business consequences.

English videos should be natural English throughout, except proper names and
technical terms.

## Story Shape

Use one clear editorial tension:

- misconception vs reality;
- opportunity vs risk;
- speed vs trust;
- old workflow vs new workflow;
- cheap now vs expensive later;
- human judgment vs automation.

A good arc:

```text
hook -> context/stakes -> twist/insight -> takeaway
```

## Hook And Ending

Scene 1 must start directly. No greetings, generic questions, or definitions.

The final scene should end with a topic-specific CTA or decision question. Do
not use generic subscribe/like/follow/comment endings.

## Evidence

Never invent:

- numbers;
- dates;
- prices;
- percentages;
- benchmarks;
- quotes;
- sources;
- release claims.

If a fact is not supplied or verified, express the idea without pretending to
have data.

## Language And TTS

- Vietnamese projects may use Vivibe or ElevenLabs.
- English projects require ElevenLabs.
- Vivibe + English is invalid.
- Do not silently change provider or voice.
- Keep brand/model names in their natural form.
- Do not write phonetic spellings.
- Do not space abbreviations: write `AI`, `API`, `GPT`, `LLM`.
- Write numbers as digits in display text and narration.

## Visual Guidance

Every scene should have one main idea.

Choose the visual form from the content shape:

- single number -> large type, bar, gauge, unit grid;
- comparison -> split frame, scorecard, balance metaphor;
- change over time -> diff, rewrite, moving marker, before/after;
- process -> pipeline, steps, branch, loop;
- list -> hand-built rows or tiles;
- relationship -> nodes, stack, matrix, hub;
- sharp statement -> strong headline or one bespoke metaphor.

Avoid repeating the same centered text card across the whole video. Signature
beats should include bespoke SVG/CSS imagery that only makes sense for that
topic.

Clean text/list scenes are valid when they fit the idea. They should be a choice,
not the default fallback for every scene.

## Motion

Motion should help the idea. Each content plan scene should name a
`motionProgression`: a short non-code intent for what changes across early,
middle, and late moments of the scene.

Prefer bounded, frame-derived motion that supports the beat across useful scene
duration and then settles or resolves cleanly:

- staged reveals tied to scene progress;
- line, chart, path, or relationship drawing across the scene;
- focus shifts between important elements;
- slow bounded background depth;
- a final hold only after the main beat has landed.

Do not animate only the first 1-3 seconds of a long scene and then leave the
rest as a static slide. Deliberately static statement beats remain valid when
stillness is the point.

Avoid:

- perpetual oscillation;
- `Math.sin(frame)` loops;
- `frame % n` loops;
- non-clamped endless interpolation;
- motion added only to keep pixels moving.
