/**
 * Deterministic authored-import normalizer (desktop-author-mode hardening).
 *
 * Post-freeform-pivot the layout blocks were deleted and `@news/blocks` /
 * `@news/theme` were dropped from the authored-import whitelist (admission N4):
 * an authored scene writes 100% bespoke JSX/SVG and imports only `react`,
 * `remotion`, `@news/compositions`, `zod`. The ONE authored-facing symbol that
 * survives is `SceneImage` (the sanctioned image block), now re-exported from
 * `@news/compositions`.
 *
 * Models trained on the old contract still write `import { SceneImage } from
 * "@news/blocks"` — which now fails N4 and kills an image scene. So the only
 * useful re-home left is: route `SceneImage` from `@news/blocks`/`@news/theme`
 * onto `@news/compositions`. Every OTHER symbol from those modules (Frame,
 * TitleBlock, useTheme, …) is intentionally NOT rescued — those blocks are gone,
 * and a scene that reaches for them SHOULD fail N4 so the model rewrites it as
 * raw JSX. Pure string transform; leaves everything else as-is.
 */

/** The base identifier of a named-import clause: strips `type ` and `as alias`. */
function baseName(clause: string): string {
  return clause.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
}

/**
 * Re-home a stray `SceneImage` import. The model may still write
 * `import { SceneImage } from "@news/blocks"` (or `@news/theme`), but those
 * modules are no longer whitelisted — `SceneImage` lives behind
 * `@news/compositions` now. Pull `SceneImage` out of any such import onto a
 * `@news/compositions` line; leave the rest of that import untouched (it will
 * fail N4 on its own, which is correct — those blocks no longer exist for
 * authored code). Returns the code unchanged when there's nothing to re-home.
 */
export function normalizeAuthoredImports(code: string): string {
  const moved = code.replace(
    /import\s*\{([^}]*)\}\s*from\s*["']@news\/(?:blocks|theme)["'];?/g,
    (full, inner: string) => {
      const clauses = inner.split(",").map((s) => s.trim()).filter(Boolean);
      const hasSceneImage = clauses.some((c) => baseName(c) === "SceneImage");
      if (!hasSceneImage) return full; // nothing we can rescue — leave it to fail N4
      const rest = clauses.filter((c) => baseName(c) !== "SceneImage");
      const lines = [`import { SceneImage } from "@news/compositions";`];
      // Preserve any other symbols on their original (now-dead) import so the N4
      // violation still surfaces them, rather than silently dropping the line.
      if (rest.length > 0) lines.push(full.replace(inner, ` ${rest.join(", ")} `));
      return lines.join("\n");
    },
  );
  return normalizeColorInterpolation(normalizeRemotionImports(normalizeRemotionAliases(normalizeCompositionRemotionImports(moved))));
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

const REMOTION_ALIAS_REWRITES: Record<string, string> = {
  // Remotion's public API is interpolateColors. Models often hallucinate the
  // singular form from other animation libraries; normalize it deterministically
  // instead of spending a retry on a stale API typo.
  interpolateColor: "interpolateColors",
};

const REMOTION_SYMBOLS_OFTEN_MISIMPORTED_FROM_COMPOSITIONS = new Set([
  "AbsoluteFill",
  "Easing",
  "Sequence",
  "Series",
  "interpolate",
  "interpolateColor",
  "interpolateColors",
  "random",
  "spring",
  "useCurrentFrame",
  "useVideoConfig",
]);

function normalizeRemotionAliases(code: string): string {
  let out = code;
  let changed = false;
  for (const [from, to] of Object.entries(REMOTION_ALIAS_REWRITES)) {
    const re = new RegExp(`\\b${from}\\b`, "g");
    if (re.test(out)) {
      out = out.replace(re, to);
      changed = true;
    }
  }
  return changed && /\binterpolateColors\b/.test(out) ? ensureNamedImport(out, "remotion", ["interpolateColors"]) : out;
}

/**
 * Models sometimes put Remotion helpers on `@news/compositions` because that
 * module is the authored registry import. Move only known Remotion primitives
 * back to `remotion`; leave registry/types/SceneImage on @news/compositions.
 */
function normalizeCompositionRemotionImports(code: string): string {
  const moved: string[] = [];
  const out = code.replace(
    /import\s*\{([^}]*)\}\s*from\s*["']@news\/compositions["'];?/g,
    (full, inner: string) => {
      const clauses = inner.split(",").map((s) => s.trim()).filter(Boolean);
      const keep: string[] = [];
      for (const clause of clauses) {
        if (REMOTION_SYMBOLS_OFTEN_MISIMPORTED_FROM_COMPOSITIONS.has(baseName(clause))) moved.push(clause);
        else keep.push(clause);
      }
      if (moved.length === 0 || keep.length === clauses.length) return full;
      return keep.length > 0 ? `import { ${keep.join(", ")} } from "@news/compositions";` : "";
    },
  );
  return moved.length > 0 ? ensureNamedImport(out, "remotion", moved) : out;
}

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

/**
 * Find the index of the bracket that closes the one at `openIdx`, skipping
 * string/template literals (whose contents may contain unbalanced brackets).
 * Tracks all three bracket kinds so a `)` inside `[...]`/`{...}` doesn't close a
 * `(` early. Returns -1 if unbalanced (caller then leaves the code untouched).
 */
function matchBracket(code: string, openIdx: number): number {
  const open = code[openIdx]!;
  const close = open === "(" ? ")" : open === "[" ? "]" : "}";
  let depth = 0;
  let quote = ""; // "", '"', "'", or "`"
  for (let i = openIdx; i < code.length; i++) {
    const c = code[i]!;
    if (quote) {
      if (c === "\\") { i++; continue; } // skip escaped char
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Split a call's argument string on TOP-LEVEL commas (ignoring nested brackets/strings). */
function splitTopLevelArgs(s: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) { args.push(s.slice(start, i)); start = i + 1; }
  }
  args.push(s.slice(start));
  return args;
}

/**
 * Does an `interpolate` output-range argument carry COLORS (not numbers)? True
 * only for an array literal whose contents show a clear color signal — a hex
 * literal (`#1E9CB0`) or a theme color read (`theme.colors.accent`, `.colors.x`).
 * Deliberately conservative: anything ambiguous returns false so a numeric
 * interpolate is NEVER rewritten (which would itself break — interpolateColors
 * can't take numbers).
 */
function isColorOutputRange(arg: string): boolean {
  const s = arg.trim();
  if (!s.startsWith("[")) return false; // must be an inline array literal
  return /#[0-9a-fA-F]{3,8}\b/.test(s) || /\.colors\./.test(s);
}

/**
 * Rewrite `interpolate(t, range, [colorA, colorB], …)` → `interpolateColors(…)`.
 *
 * Remotion's `interpolate` has a `string[]` output overload, so passing colors
 * type-checks CLEAN (N10 can't catch it) but throws at RENDER time:
 * `Cannot interpolate "#6177e5" because … is not a supported scale/translate/
 * rotate value`. The model recurrently reaches for `interpolate` to cross-fade a
 * color; the correct API is `interpolateColors` (identical `(number, number[],
 * string[])` signature). Since a typecheck can't see it and the render crash is
 * NOT agent-fixable by re-prompting reliably, fix the deterministic mistake in
 * code: swap the callee for color-valued calls and ensure the import exists.
 *
 * Conservative by construction: only a STANDALONE `interpolate(` call whose 3rd
 * arg is an array literal containing a hex/`.colors.` signal is rewritten. A
 * numeric interpolate, a `foo.interpolate`, or an ambiguous range is left as-is.
 */
function normalizeColorInterpolation(code: string): string {
  const CALLEE = "interpolate";
  let out = "";
  let i = 0;
  let rewrote = false;
  while (i < code.length) {
    const idx = code.indexOf(`${CALLEE}(`, i);
    if (idx === -1) { out += code.slice(i); break; }
    // STANDALONE only: the char before must not continue an identifier or be a
    // `.` (so `interpolateColors(` and `obj.interpolate(` are both skipped).
    const prev = idx > 0 ? code[idx - 1]! : "";
    if (/[\w$.]/.test(prev)) {
      out += code.slice(i, idx + CALLEE.length + 1);
      i = idx + CALLEE.length + 1;
      continue;
    }
    const open = idx + CALLEE.length; // index of "("
    const close = matchBracket(code, open);
    if (close === -1) { out += code.slice(i); break; } // unbalanced ⇒ leave rest as-is
    const args = splitTopLevelArgs(code.slice(open + 1, close));
    if (args.length >= 3 && isColorOutputRange(args[2]!)) {
      out += `${code.slice(i, idx)}interpolateColors${code.slice(open, close + 1)}`;
      rewrote = true;
    } else {
      out += code.slice(i, close + 1);
    }
    i = close + 1;
  }
  return rewrote ? ensureInterpolateColorsImport(out) : out;
}

/** Ensure `interpolateColors` is imported from "remotion" (add to an existing import, else a new line). */
function ensureInterpolateColorsImport(code: string): string {
  return ensureNamedImport(code, "remotion", ["interpolateColors"]);
}

function ensureNamedImport(code: string, moduleName: string, names: string[]): string {
  const needed = names.filter(Boolean);
  if (needed.length === 0) return code;
  const importRe = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${escapeRegExp(moduleName)}["'];?`);
  const m = importRe.exec(code);
  if (m) {
    const clauses = m[1]!.split(",").map((s) => s.trim()).filter(Boolean);
    const seen = new Set(clauses.map(baseName));
    for (const name of needed) {
      if (!seen.has(baseName(name))) {
        clauses.push(name);
        seen.add(baseName(name));
      }
    }
    return code.replace(importRe, `import { ${clauses.join(", ")} } from "${moduleName}";`);
  }
  return `import { ${needed.join(", ")} } from "${moduleName}";\n${code}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
