# Authoring Contract — AUTHOR-mode scenes

How to write Remotion scene `.tsx` modules that pass admission and look on-brand.
This is the contract enforced by the admission gate (N4/N5), the static grid
(N1–N9), and the render oracles (N14/N18–N22/N28–N30; N15/N17/N23 are exported
but not auto-run — see CLAUDE.md "The Safety Grid").

## Where authored scenes live

- One module per distinct visual:
  `VIDEO_TOOL_HOME/.video-tool/projects/<id>/authored/<scene-name>.tsx`.
- Files starting with `_` (e.g. the generated `_entry.tsx`) are reserved.
- `manifest.json` lists ordered scenes referencing the authored component ids.

## Required exports (every module)

```tsx
import React from "react";
import { useCurrentFrame, interpolate } from "remotion";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";

export const schema = z.object({ /* this scene's props */ });
type Props = z.infer<typeof schema>;

const Scene: React.FC<SceneComponentProps<Props>> = ({ headline, body, eyebrow, props }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", inset: 0, background: "#0B0E14", color: "#F2F5F8" }}>
      <div style={{ position: "absolute", top: 160, left: 80, right: 80, opacity: enter }}>
        <h1 style={{ fontSize: 84, fontWeight: 800, margin: 0 }}>{headline}</h1>
        {/* bespoke imagery / SVG here */}
      </div>
    </div>
  );
};

export const example: Props = { /* a valid sample payload */ };
export default registerComponent<Props>({
  id: "my-scene",            // a literal string id, referenced by the manifest
  displayName: "My Scene",
  promptGuide: "when to use this scene",
  schema,
  Component: Scene,
  example,
});
```

- MUST export `default` (the `registerComponent(...)` result), `schema`, and
  `example`; `example` MUST satisfy `schema`.
- MUST call `registerComponent({ id: "..." })` with a **literal** string id.
- `schema` describes ONLY this scene's bespoke `props` payload. Do NOT declare
  `headline`, `eyebrow`, `body`, or `image` in it — those are framework-level
  fields the master composition passes top-level (destructured as `({ headline,
  body, eyebrow, props })`), not inside `props`. Declaring them in `schema`
  reads them off the (empty) `props` and trips a phantom N3 `expected string,
  received undefined`. (The N3 check is tolerant of this slip — it validates the
  merged top-level + props view — but keep `schema` props-only.)

## TSX syntax self-check

Every returned module must be complete TypeScript/TSX that can be parsed before
the admission gate runs. Self-check it as if a TypeScript parser is about to read
the file:

- Imports/exports are valid, JSX tags are closed, and `()`, `{}`, `[]`, commas,
  and quotes are balanced.
- Inside object literals, especially `style={{ ... }}`, write only valid
  `key: value` properties or valid spreads. Do not put bare expressions/calls
  such as `foo("bar")`, `condition && ...`, loose JSX, or stray tokens inside an
  object literal.
- React inline CSS uses camelCase keys with explicit values, such as
  `justifyContent: "flex-start"`, `alignItems: "center"`, and
  `backgroundColor: "#111827"`. Do not write raw `.css` syntax or kebab-case
  properties inside the style object.
- Any helper, motion value, or math value used by JSX must be declared as valid
  TypeScript before use. Do not leave natural-language notes or pseudocode inside
  the `.tsx` block.

## Import whitelist (N4)

Only these may be imported: `react`, `remotion`, `@news/compositions`, `zod`.
Nothing else (no `node:*`, no third-party packages, no relative imports outside
the file). In particular **`@news/blocks` and `@news/theme` are OFF the whitelist**
— the layout-block toolkit was deleted, so there is no `Frame`/`TitleBlock`/
`KeyPoints`/`useTheme` to import; importing either package fails N4 and blocks the
render. Write every container, card, list, and figure as raw JSX/SVG by hand.

**The one exception — images.** If a scene carries an `image`, import
`{ SceneImage } from "@news/compositions"` and render
`<SceneImage imageRef={image.ref} alt={image.alt} />`. This is the ONLY sanctioned
way to show a picture (no `<img>`/`Img`/`staticFile`); it keeps the user-attached +
crawled-image feature working without re-opening the block toolkit.

## Banned APIs (N5) — scenes are pure functions of the frame

No `Math.random`, `Date`/`Date.now`, `fetch`/`XMLHttpRequest`, `eval`/`Function`,
`require`/dynamic `import()`, `fs`/`child_process`/`process`,
`window.location`/`document.cookie`, or `dangerouslySetInnerHTML`. For randomness
use Remotion's `random(seed)`; for animation use `useCurrentFrame()` +
`interpolate`/`spring`.

## Build everything as raw JSX/SVG (no block toolkit)

There is no library of containers to compose — you write the whole scene by hand.
That is deliberate: reusing a fixed set of blocks made every video look the same,
so the toolkit was removed to force bespoke, varied scenes.

- **Background**: a full-bleed `<div style={{ position: "absolute", inset: 0 }}>`
  with your own color/gradient.
- **Cards / framed boxes**: a `<div>` with inline `padding`, `border`,
  `borderRadius`, `background` — style it yourself.
- **Big numbers / stats**: a large `<div>` (80–160px) animated by `interpolate`
  (count-up). Evidence-gated — only real/supplied numbers, never invented.
- **Lists / recaps**: build the rows yourself; if you want numbering, render the
  index in JSX (nothing adds it for you).
- **Comparisons**: a flex row of two hand-built panels.
- **Figures / diagrams / metaphors**: bespoke deterministic `<svg>` (path, circle,
  rect, gradient, mask). Drawn silhouettes, icons, glyphs, charts, diagrams and
  metaphors are all encouraged — the media ban is ONLY for real/external assets
  (photos, screenshots, logos, uploads, image/video URLs, auto-fetch), never for
  things you draw yourself.

Hard-code colors, fonts, spacing, and radii directly — there is no theme/token to
read. `Captions` are NOT yours to render (the composition owns them centrally for
TikTok; YouTube-format output omits the burned caption layer).

## Layout zones (from `@news/schema`)

These zones describe the stable TikTok/9:16 production path. `@news/schema` also
has `geometry("youtube")` for the in-progress YouTube path; long-form
author-by-segment + true 16:9 main-video production is still pending Group J.

- `CONTENT_ZONE` — top safe margin → ~62% height. Primary content lives here;
  position your content into it. N14 flags content outside it (advisory warning).
- `CAPTION_BAND` — ~64%–84% height; the burned-in single-line caption renders
  here. Do not place authored content here.
- `UI_RESERVE` — bottom ~16% + a right action-rail column; keep it empty (the
  host platform paints its own UI there).
- Keep authored content clear of the caption band: leave a gap above where the
  single-line caption burns in, so your visuals never collide with the karaoke
  text. N14 flags content that drifts into the caption clearance gap — **advisory
  now (a warning), not a hard block** — but it is still the right thing for the
  viewer, so respect it. (No divider line is drawn anymore; if you want a
  separator, draw your own.)
- **Balance the zone.** A scene with only a short title + one line reads
  top-heavy / half-empty. Give a sparse beat a confident anchor (a bold stat, a
  small bespoke diagram) or let one element own the zone — don't leave a tiny
  block floating at the top. (Overcrowding is the opposite failure, warned by N30.)

## Design freedom (post-freeform-pivot, R1/D2)

> **You decide ALL visuals in code, and hard-code every value.** The full LOOK
> guidance lives in `docs/design-language.md` — but it is no longer a set of
> look-rules to obey. There is no design system and no layout-block toolkit
> anymore (`@news/design` and the `@news/blocks` layout blocks were deleted). You
> choose your own colors, background, gradient, layout, corners, fonts, and
> bespoke SVG/CSS, and write them as literals — there is no theme/token to read.
>
> The only things that HARD-block a render are render-integrity, not look: the
> scene must build + register (N2/N11), use no banned/remote API and be a pure
> function of the frame (N5/N9/N16 determinism). Everything that shapes the LOOK
> — content in the layout zones (N14), high text contrast (N18), the minimum type
> sizes — is now **advisory (a warning)**, surfaced for the refine loop, never a
> gate. They still exist for the VIEWER (legible text, content that doesn't fly
> off-frame), so respect them by default — but they will not stop your video.
> Everything else is your call. Aim for SÁNG TẠO — don't make every scene or
> every video look like one template.

**Colors / radii / fonts — hard-code them.** Pick a palette per video and write
the hex/px/font-family directly in the JSX. Two things to keep for the viewer:
high text contrast against the background you chose (N18), and content inside the
content-zone (the LAYOUT ZONES section). There is no token system to consult.

**Font sizes (readability — strongly advised for the viewer).** The canvas is 1080×1920 viewed
on a phone, so text must be large. Primary content — headlines, body copy, list
items, stat values — should be roughly `40px+` (headlines far larger); never set
primary text below `32px`. Only genuinely secondary marks (chart axis labels,
units, fine captions inside a bespoke diagram) may go smaller, and never below
`18px` — anything under that is unreadable and is raised to the floor
deterministically before render, so don't rely on tiny text to fit content
(condense the content instead).

## Captions

Single-line Vietnamese captions are generated centrally from each scene's
`narration` (timed from the TTS SRT). TikTok burns them in; the YouTube-format
composition omits the burned caption layer. Do not author captions in props or
render your own subtitle text. The active TikTok word is highlighted with a
smooth eased ramp (word-paged karaoke) — also produced centrally, never authored.

**On-screen text ≠ narration.** Because the full spoken sentence already runs in
the burned caption band, the text you DRAW on the scene must be the condensed
idea, not the sentence: a `headline` is a short phrase (≈3–7 words), `body`/labels
are a few keywords. Do NOT copy the whole `narration` into `headline`/`body`/a
`Panel` — that double-prints the line and crowds the frame. Let the caption tell
the full line; keep the scene airy with one or two large text marks.

## When to visualize vs. when to keep it simple (R18)

> The menu of visual FORMS and the count/shape mechanics live in
> `docs/visualization-playbook.md` — **run EVERY scene through it.** This section
> is only the contract-level rules; don't restate the playbook here.

- Before coding, make a one-line **visual plan** per scene: idea → content shape
  → chosen form. **Decompose the narration/headline for an embedded number,
  relationship, change, or process** — if one exists, prefer a visual that carries
  it (e.g. "X nhanh hơn Y" is a two-rate divergence → a line chart, not a
  sentence), and prefer a form not used yet in this video.
- **Visuals must EARN their place and FIT the content** — pick the form from the
  meaning. **Do NOT lazily reuse one arrangement for everything**: a video that is
  10× the same centered title + text panel is a FAIL. Vary the form, layout, and
  rhythm; don't repeat one arrangement back-to-back. **Compose the layout to fit
  the actual item COUNT and content SHAPE** (the playbook's core rule) — never
  force every idea into one mould.
- **Author bespoke, topic-specific imagery for the signature beat(s)** — custom
  SVG/CSS built for THIS topic (e.g. a memory bar shrinking under a GPU-capacity
  line), not a generic chart. Bespoke code is the whole point of AUTHOR mode. Do
  NOT bootstrap by copying a previous project's authored components and swapping
  text.
- **Dare to draw the metaphor — don't just drop text on the scene.** Turn an
  abstract idea into a concrete self-drawn shape: "AI speeds up" → a progress bar
  shooting past a mark; "risk" → a cracked block / broken line; "connection" →
  nodes joined by paths; "growth" → rising bars or an upward path. As a countable
  floor, a video should carry **at least 1–2 scenes with a self-drawn
  graphic/metaphor**, not be all text-cards. (Editorial guidance, not an oracle.)
- A clean text/list scene is a DELIBERATE choice for genuinely text content
  (definition/recap/CTA) — never a default for a scene you didn't design, and
  never the only mode. Diversity is advisory (the playbook nudges it; there is no
  hard "variety" oracle). Layout-correctness checks (overflow /
  caption-clearance) are warnings for refine, not hard gates; admission/security
  and render-integrity are what block.

## Motion

Every scene needs deliberate, tasteful motion — content must neither just "pop" in
fully formed nor sit frozen. The rules:

- **Entrances settle.** Drive entrances with `useCurrentFrame()` +
  `interpolate(..., { extrapolateRight: "clamp" })` or `spring()` so they ease in
  and reach a steady state — never just snap to fully-formed.
- **Ambient "living card" tilt (optional).** If you want subtle life, compute one
  small rotation angle from the frame and apply it to the ONE parent wrapper that
  holds the scene's floating elements — never per-child — so they move together as
  a unit. Tie it to a slight left→right lean over the scene, not a queasy drift.
- **No perpetual oscillation / no unbounded motion.** Never animate off
  `Math.sin(frame)`, `frame % n`, a non-clamped `interpolate`, or a looping
  pulse. Monotonic motion that resolves by (or at) the scene end is fine; a
  shape that keeps bouncing forever reads as a bug.
- **One-time emphasis (zoom).** For an important figure, do a single visible
  "zoom in then settle" pop with `interpolate`/`spring` that returns to scale 1.0
  before the midpoint, so it never trips N14 (which samples the midpoint still).
- **SVG transforms: scale/rotate about a point correctly.** CSS `transform-origin`
  is unreliable on SVG nodes — use `translate(cx cy) scale|rotate(...) translate(-cx -cy)`,
  or animate `opacity` + a small `translate`. Never combine an attribute
  `transform` with a CSS `transformOrigin`.
- **Captions are smooth karaoke on TikTok.** The caption track highlights the
  spoken word with an EASED scale + color ramp (not a hard snap). It is generated
  centrally; do not author it. YouTube-format output does not burn this layer in.
- Stagger multiple elements so a scene assembles, but finish well before the hold.

## Duration target (rather over than under)

- Each project carries a soft target duration (the brief's `duration`); the N28
  oracle warns (advisory) if the finished video lands outside `target ± 20s`.
- **Rather over than under**: if you must miss, miss long. A video briefed at
  ~2 minutes should land ~120–140s, never ~70s. Add scenes / richer narration to
  reach the target rather than padding holds with silence.
- Free pacing still holds: scene count and per-scene length are not fixed presets,
  and a naturally longer Vietnamese render is fine. The target is a floor on
  substance, not a straitjacket.

## Render workflow (stills → draft → USER REVIEW → full)

Never jump straight to the expensive full render — this is mandatory every time,
not just while iterating:

1. **Stills** (mock voice, free) — eyeball layout/alignment per scene.
2. **Draft** (`renderProject(..., { quality: "draft" })`) — a fast preview at
   **10 fps**, half-res, ultrafast x264, max concurrency, with identical timing
   (motion is fps-aware). Use it (plus the render oracles + keyframe review) to
   catch MOTION/PACING bugs cheaply. Drafts write to `<id>.draft.mp4` and never
   touch the full-quality render cache.
3. **User review** — report the draft path to the user and let them watch + give
   feedback. In the desktop flow, hidden no-TTS stills/refine may run before this
   point; the user should only see the refined draft MP4. Do NOT proceed to full
   on your own.
4. **Full** (`quality: "full"`) — the final, rendered at **30 fps**, only AFTER
   the user approves the draft (or explicitly asks to skip it) and the oracles
   are clean. TTS is cached, so the final render mostly just re-encodes (at full
   resolution).

## Transitions & timing

- Set `transitionToNext` per scene in the manifest (`slide` default; `fade` for
  recap/CTA). The lock makes the transition overlap land on a silent breath gap
  so no speech is clipped — you do not manage timing yourself.
- Real timing follows the measured Vietnamese TTS; a longer render than any
  target is fine when the voice is complete and unrushed.
