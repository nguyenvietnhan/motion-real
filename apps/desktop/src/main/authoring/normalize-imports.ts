/**
 * Deterministic authored-import normalizer (desktop-author-mode hardening).
 *
 * The authoring/reauthor model recurrently writes `import { useTheme } from
 * "@news/design"` (and other layout/motion symbols) when those symbols actually
 * live in `@news/blocks`. That trips the N4 admission gate ("No matching export
 * in @news/design for import useTheme"), the scene rolls back, and a fixable
 * defect (e.g. an N14 layout overflow) can never be repaired — the repair loop
 * then burns every attempt re-rendering unchanged code.
 *
 * Rather than hope the model self-corrects, we fix the deterministic mistake in
 * code: any `@news/blocks`-owned symbol imported from `@news/design` is moved to
 * a `@news/blocks` import. Pure string transform; leaves everything else as-is.
 */

/** Every value/type exported by `@news/blocks` (kept in sync with its index.ts). */
const BLOCKS_SYMBOLS = new Set<string>([
  // theme + timing context
  "ThemeProvider", "useTheme", "SceneTimingProvider", "useSceneDurationInFrames",
  // motion helpers
  "bezier", "easeOut", "frameRamp", "useReveal", "useRamp", "useFrameScale",
  "useSceneProgress", "useApproxSceneProgress", "useExactSceneProgress", "useTilt",
  "useKenBurnsScale", "useIntroZoom", "usePop",
  // frame + text + data blocks
  "Frame", "Content", "TitleBlock", "IdeaPanel", "Callout", "KeyPoints", "StatChip",
  // editorial blocks + viz primitives
  "HeaderBar", "Panel", "Tag", "Footer", "StatBlock", "CountUp", "BarChart", "Story", "Tone",
  // captions + surface-kit + fonts
  "Captions", "CAPTION_RENDER_BAND", "CAPTION_CANVAS",
  "surfaceBorder", "surfaceBorderWidth", "innerDivider", "surfaceRadius",
  "surfaceShadow", "blockSurface", "topRuleStyle", "chipStyle", "labelStyle",
  "LOADED_FONT_FAMILIES", "fontCoverageReport", "FontCoverage",
]);

/** The base identifier of a named-import clause: strips `type ` and `as alias`. */
function baseName(clause: string): string {
  return clause.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
}

/**
 * Move any `@news/blocks` symbol that was imported from `@news/design` into a
 * `@news/blocks` import. Returns the code unchanged when nothing is misplaced.
 */
export function normalizeAuthoredImports(code: string): string {
  return code.replace(
    /import\s*\{([^}]*)\}\s*from\s*["']@news\/design["'];?/g,
    (full, inner: string) => {
      const clauses = inner.split(",").map((s) => s.trim()).filter(Boolean);
      const misplaced = clauses.filter((c) => BLOCKS_SYMBOLS.has(baseName(c)));
      if (misplaced.length === 0) return full; // nothing to relocate
      const remaining = clauses.filter((c) => !BLOCKS_SYMBOLS.has(baseName(c)));
      const blocksLine = `import { ${misplaced.join(", ")} } from "@news/blocks";`;
      const designLine = remaining.length > 0 ? `import { ${remaining.join(", ")} } from "@news/design";` : "";
      return designLine ? `${blocksLine}\n${designLine}` : blocksLine;
    },
  );
}
