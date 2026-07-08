/**
 * Deterministic authored font-size floor (vision-independent layout hardening).
 *
 * Pure-AUTHOR scenes write their own `fontSize` in bespoke SVG/CSS, and weaker
 * authoring models (notably Gemini) recurrently emit body/heading text at
 * 10–16px — visually unreadable on the 1080×1920 9:16 canvas at phone viewing
 * distance. The deterministic render grid can't see "too small" (it samples
 * pixel coverage, not glyph size) and the vision-QA pass is model-dependent and
 * unreliable, so a genuinely unreadable scene slips through to the user.
 *
 * Rather than depend on a model to self-correct, we clamp the deterministic
 * mistake in code: any literal `fontSize` below a readability FLOOR is raised to
 * the floor. The floor (18) is deliberately conservative — low enough that a
 * legitimately small chart axis-label / unit (commonly 16–22px) is at most
 * nudged a couple of px and never collides, but high enough to kill the 10–14px
 * band that is always too small to read. Non-literal sizes (a variable or an
 * expression) are left untouched; this is a pure string transform.
 */

/** Smallest readable on-canvas font size; literals below this are raised to it. */
export const MIN_READABLE_FONT_PX = 18;

/**
 * Raise every literal `fontSize` below `MIN_READABLE_FONT_PX` up to the floor.
 * Handles the two literal shapes authored code uses — a bare number
 * (`fontSize: 12`) and a px string (`fontSize: "12px"`); leaves variables,
 * expressions, and already-large sizes exactly as written.
 */
export function normalizeAuthoredFontSizes(code: string): string {
  // Bare numeric literal: fontSize: 12 / fontSize:12.5
  let out = code.replace(/(\bfontSize\s*:\s*)(\d+(?:\.\d+)?)\b(?!\s*px)/g, (full, head: string, num: string) => {
    const v = Number(num);
    return v < MIN_READABLE_FONT_PX ? `${head}${MIN_READABLE_FONT_PX}` : full;
  });
  // Px string literal: fontSize: "12px" / fontSize: '12px'
  out = out.replace(/(\bfontSize\s*:\s*)(["'])(\d+(?:\.\d+)?)px\2/g, (full, head: string, q: string, num: string) => {
    const v = Number(num);
    return v < MIN_READABLE_FONT_PX ? `${head}${q}${MIN_READABLE_FONT_PX}px${q}` : full;
  });
  return out;
}
