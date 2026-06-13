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
  const moved = code.replace(
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
  return normalizeRemotionImports(moved);
}

/**
 * Symbols a model imports from "remotion" that NO LONGER EXIST in the installed
 * version, mapped to a deterministic fix. The recurrent one is `Extrapolate`: old
 * Remotion exposed an `Extrapolate` enum (`Extrapolate.CLAMP`) for interpolate's
 * extrapolate options; current Remotion takes the bare string `"clamp"` instead,
 * so an `import { Extrapolate } from "remotion"` fails admission (N4: "No matching
 * export in remotion for import Extrapolate") and the whole scene rolls back. The
 * model trained on the old API keeps writing it, so fix it in code: rewrite the
 * `Extrapolate.X` member usages to their string literal, then drop the dead import.
 */
const REMOTION_MEMBER_REWRITES: Record<string, Record<string, string>> = {
  Extrapolate: { CLAMP: '"clamp"', EXTEND: '"extend"', IDENTITY: '"identity"' },
};

/**
 * Rewrite removed-symbol member accesses (e.g. `Extrapolate.CLAMP` → `"clamp"`)
 * and strip those symbols from any `remotion` named import, so authored code using
 * a stale Remotion API admits + renders instead of rolling back. Other remotion
 * imports are left untouched. Pure string transform.
 */
function normalizeRemotionImports(code: string): string {
  let out = code;
  // 1) Rewrite member accesses of removed symbols to their replacement literal.
  // The `(?<![\w$.])` guard requires the symbol to be a STANDALONE identifier, not
  // a member of something else: without it, `\b` matches after a dot too, so a
  // `foo.Extrapolate.CLAMP` would mangle to `foo."clamp"`. (A string literal that
  // merely contains "Extrapolate.CLAMP" is still matched — fully avoiding that
  // needs a real parser; it's vanishingly unlikely in authored Remotion code.)
  for (const [sym, members] of Object.entries(REMOTION_MEMBER_REWRITES)) {
    out = out.replace(new RegExp(`(?<![\\w$.])${sym}\\.([A-Za-z_$][\\w$]*)`, "g"), (full, member: string) => {
      const repl = members[member];
      return repl ?? full; // an unknown member is left as-is (don't silently mangle)
    });
  }
  // 2) Drop the now-dead removed symbols from any remotion named import.
  const removable = new Set(Object.keys(REMOTION_MEMBER_REWRITES));
  return out.replace(
    /import\s*\{([^}]*)\}\s*from\s*["']remotion["'];?/g,
    (full, inner: string) => {
      const clauses = inner.split(",").map((s) => s.trim()).filter(Boolean);
      const kept = clauses.filter((c) => !removable.has(baseName(c)));
      if (kept.length === clauses.length) return full; // nothing removed
      // Drop the import entirely when only removed symbols were imported.
      return kept.length > 0 ? `import { ${kept.join(", ")} } from "remotion";` : "";
    },
  );
}
