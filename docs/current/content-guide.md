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

Motion should help the idea. A content plan scene may name a
`motionProgression`: a short non-code motion intent. It should distinguish the
tempo of the motion instead of forcing every element to move for the whole
scene. Missing or generic motion intent is treated as authoring guidance debt,
not as a reason to fail an otherwise safe story plan.

Use three motion types:

- Quick entrance/reveal/pop: titles, labels, cards, markers, icons, or callouts
  enter quickly and naturally, usually settling in about 0.2-0.8 seconds or a
  small early part of the scene. They may then hold still for readability.
- Semantic progression: line, chart, path, relationship, timeline, process,
  before/after, map, focus-shift, or cause/effect visuals can use full scene
  progress when the beat itself develops over time. Give these beats a clear
  final hold once the idea lands.
- Continuous living motion: wave, shimmer, pulse, signal flow, walking cycle,
  orbit, vibration, or subtle ambient depth can continue after the entrance by
  using deterministic phase/period motion. Keep it small, bounded, purposeful,
  and away from text readability.

The safest default is a quick entrance followed by a readable final hold. Do not
stretch a simple text/card reveal across the whole scene just to avoid stillness.
Deliberately static statement beats remain valid when stillness is the point.

Avoid:

- meaningless perpetual oscillation;
- unbounded `Math.sin(frame)` or `frame % n` loops with no phase/period intent;
- non-clamped endless interpolation;
- random or non-deterministic motion;
- large layout-shifting motion that covers or shakes readable text;
- motion added only to keep pixels moving.

Deterministic periodic motion is allowed when it is bounded and meaningful, for
example `phase = (frame % periodFrames) / periodFrames` followed by a small
`Math.sin(phase * Math.PI * 2)` pulse.
