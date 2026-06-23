# Design Language — news_remotion_tool

> **Post-freeform-pivot (R1/D2).** This used to be a binding LOOK contract that
> forced every scene to read all visuals from a multi-language design system
> (`@news/design`, now DELETED). That leash is gone. The AI authoring a scene now
> decides **all** of its own visuals in code — colors, background, layout, corners,
> bespoke SVG/CSS. This doc is no longer a set of look-rules to obey; it is a map
> of the few real invariants + the OPTIONAL toolkit, and a note on where styling
> is headed.

## The system in one line

**The AI is free; the system keeps only a thin "survival" layer.** A scene is
on-brand because the model designs it well, not because the engine clamps it into
one frozen look. There is ONE neutral theme today (`@news/theme`) — a dark base,
near-white ink, one accent, medium corners — but it is NOT authored-facing: it
exists only so the render runtime + `SceneImage` resolve `useTheme()` internally.
An authored scene cannot import it (off the N4 whitelist) and hard-codes whatever
it wants.

## What is actually invariant (viewer rules, mostly advisory)

These exist for the **viewer**, not for a look. Most of them are advisory
warnings surfaced to the hidden refine loop. The actual hard blockers are
admission/security and render-integrity: N4/N5, N2, N9, N11, N12/N13, N16,
duplicate scene id, and empty spec.

- **Content stays readable in the intended frame** (`@news/schema/zones` /
  `geometry(format)`). TikTok primary content lives in the upper/middle band; the
  caption band + bottom/right platform-UI reserve stay clear. Layout oracles are
  warnings, not gates.
- **High text contrast** (N18): whatever background the scene chooses, its text
  should read clearly on it. The most common real defect on a phone screen.
- **Minimum type sizes**: primary text large (≈40px+ on the 1080×1920 canvas),
  nothing below the 18px floor — readability on a phone matters even when the
  oracle is advisory.
- **Determinism**: scenes are pure functions of the frame (no `Math.random`/
  `Date`/IO; see the banned-API list in the authoring contract). Enforced by N5 +
  the admission gate.
- **Captions**: TikTok has one shared single-line karaoke band, generated
  centrally from narration — never authored in scene props. YouTube-format output
  omits this burned-in layer.

That is the whole binding set. There is no "read every color from the theme"
rule, no required polarity, no required corner geometry, no forbidden hard-coded
hex. The AI **may** hard-code colors and design freely.

## What VARIES — i.e. everything else (the AI decides)

- The whole palette, background, gradient, mood — chosen in scene code.
- Corner geometry, borders, shadows, surface grammar — the scene's call.
- Layout and visual form — adapt to the content's count + shape; vary it across
  scenes (the menu of forms lives in `docs/visualization-playbook.md`).
- Bespoke imagery (SVG/CSS) for the signature beats — the whole point of AUTHOR
  mode.

The only steady "diversity" expectation is editorial, not enforced: a video that
is 10× the same title-over-list reads as lazy. Vary the form. (There is no hard
"variety" oracle; layout/contrast checks are warnings that help refine.)

## No toolkit — hard-code everything (raw JSX/SVG)

There is no layout-block library and no authored-facing theme. A scene writes
**100% raw JSX/SVG/CSS by hand** and hard-codes every color, radius, font, and
spacing as a literal — there are no `@news/blocks`/`@news/theme` imports to reach
for (both are off the N4 whitelist; importing either blocks the render). The
layout blocks were deleted on purpose: reusing them made every video look the
same.

Practical building blocks you write yourself:

- **Background**: a full-bleed `<div style={{ position: "absolute", inset: 0 }}>`
  with your own color/gradient.
- **Cards / panels**: a `<div>` with inline `padding`/`border`/`borderRadius`/
  `background`.
- **Big numbers, lists, comparisons, diagrams**: hand-built `<div>`/`<svg>`,
  animated by `useCurrentFrame()` + `interpolate`/`spring`.

The ONE authored-facing import beyond react/remotion/zod is
`{ SceneImage } from "@news/compositions"` — the image feature (see Imagery rules).

## Motion (still disciplined — a viewer rule, not a look rule)

Motion discipline survives the pivot because janky motion hurts the viewer.
When it suits the content, **prefer a visual progression across much of the
scene** over one entrance followed by a long frozen hold. That progression can
be a staged reveal, a continuing draw, a developing relationship, or a shift of
focus between elements. This is guidance, not a quota: an intentionally static
scene is valid, and there is no need to move every element.

- **Entrances settle** (springs / clamped ramps, fps-aware) — `useCurrentFrame()`
  + `interpolate(..., { extrapolateRight: "clamp" })` or `spring()`.
- **A scene may keep evolving after the entrance** through a few bounded,
  purposeful phases rather than ambient movement for its own sake.
- **Ambient "living card" tilt** on the ONE parent wrapper (a small frame-derived
  rotation), never per-child — alive, not jittery.
- **No perpetual oscillation / unbounded motion** — never animate off
  `Math.sin(frame)`, `frame % n`, or a non-clamped `interpolate`. Monotonic motion
  that resolves by scene end is fine; a forever-bouncing shape reads as a bug.
- **One-time emphasis zoom** that settles to scale 1.0 before the midpoint.
- **Transitions**: new projects use authored boundary-level transition modules,
  ~0.5s, DOM/SVG/CSS only, receiving both scene layers (`from` and `to`). They
  should preserve visual continuity with the two scenes, not clear to a random
  full-frame color interstitial. Legacy projects may still use the built-in
  deterministic DOM presentations (slide/wipe/clock-wipe/zoom). No WebGL
  transitions (non-deterministic in render).

## Imagery rules (a viewer/legal rule, not a look rule)

- Bespoke imagery = deterministic **SVG/CSS only** (charts, meters, diagrams,
  metaphors, silhouettes, icons, glyphs) — **encouraged**, the heart of AUTHOR
  mode. The ban is ONLY real/external media — **photos, screenshots, logos,
  uploads, image/video URLs, auto-fetch** (N9, breaks offline + determinism). The
  one sanctioned real image is a user-attached asset via `<SceneImage>`.
- **Evidence gate**: only visualize numbers/sources actually supplied — never
  invent data to fill a chart.

## Where styling is headed (FUTURE — not built yet)

> This is the **project owner's intended direction**, recorded so the docs point
> forward instead of back at the deleted system. It is **not implemented** today
> (spec open item O1 deferred it), and it is **guidance, not a constraint** — the
> opposite of the old `@news/design` leash.

The plan: ship a few **named styles**, each owning (a) its own swapped-in
**background** and (b) its own **design/prompt guidance file**. When the user
picks a style, that style's guidance is fed to the AI as a *suggestion of
direction* and its background is swapped in — the AI still decides the actual
scene visuals freely. A style nudges the look; it never clamps it back into a
fixed template. Until that lands, there is one neutral theme and full AI freedom.

> **Rule for anyone touching this:** any change that would make a style (or the
> theme, or an oracle) *force* the AI's scene visuals — rather than merely guide
> them — is the old mistake returning. STOP and confirm with the project owner
> first.
