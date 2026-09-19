/**
 * Pure pre-write rewrites for AI-authored scene modules.
 *
 * - Expand / strip React Native style keys (shadow*, elevation, paddingHorizontal…).
 * - Rewrite system/OS font stacks to product brand fonts (Inter / Be Vietnam Pro).
 *
 * Admission still bans residual RN keys as defense-in-depth.
 */

import ts from "typescript";

/** React Native keys that are never valid CSSProperties (strip or expand). */
export const REACT_NATIVE_STYLE_KEYS = [
  "shadowColor",
  "shadowOffset",
  "shadowOpacity",
  "shadowRadius",
  "elevation",
  "paddingHorizontal",
  "paddingVertical",
  "marginHorizontal",
  "marginVertical",
] as const;

export type ReactNativeStyleKey = (typeof REACT_NATIVE_STYLE_KEYS)[number];

const RN_KEY_SET: ReadonlySet<string> = new Set(REACT_NATIVE_STYLE_KEYS);

/** True when `name` is a known React Native-only style property. */
export function isReactNativeStyleKey(name: string): boolean {
  return RN_KEY_SET.has(name);
}

/**
 * True when this object literal is a React `style={{…}}` / `style: {…}` value.
 * RN key strip/admission must NOT run on arbitrary data objects (e.g. Material
 * `{ elevation: 8, title: "…" }` copy models).
 */
export function isCssStyleObjectLiteral(node: ts.ObjectLiteralExpression): boolean {
  let cur: ts.Node = node;
  // Unwrap parentheses / as / satisfies.
  while (cur.parent) {
    const p = cur.parent;
    if (ts.isParenthesizedExpression(p) || ts.isAsExpression(p)) {
      cur = p;
      continue;
    }
    if (typeof (ts as { isSatisfiesExpression?: (n: ts.Node) => boolean }).isSatisfiesExpression === "function") {
      if ((ts as { isSatisfiesExpression: (n: ts.Node) => boolean }).isSatisfiesExpression(p)) {
        cur = p;
        continue;
      }
    }
    break;
  }
  const p = cur.parent;
  if (!p) return false;
  if (ts.isJsxExpression(p)) {
    const attr = p.parent;
    if (ts.isJsxAttribute(attr)) {
      const n = attr.name;
      return (ts.isIdentifier(n) ? n.text : n.getText()) === "style";
    }
    return false;
  }
  if (ts.isPropertyAssignment(p)) {
    return propertyNameText(p.name) === "style";
  }
  return false;
}

const SHADOW_STRIP_KEYS = new Set([
  "shadowColor",
  "shadowOffset",
  "shadowOpacity",
  "shadowRadius",
  "elevation",
]);

const EXPAND_PAIRS: Record<string, [string, string]> = {
  paddingHorizontal: ["paddingLeft", "paddingRight"],
  paddingVertical: ["paddingTop", "paddingBottom"],
  marginHorizontal: ["marginLeft", "marginRight"],
  marginVertical: ["marginTop", "marginBottom"],
};

/** Brand stacks already vendored for Remotion render. */
export const BRAND_FONT_STACK = 'Inter, "Be Vietnam Pro", sans-serif';
export const BRAND_MONO_STACK = '"Cascadia Mono", monospace';

/**
 * Remove / expand RN style keys via TS AST. Idempotent.
 */
export function stripReactNativeStyleKeys(source: string): string {
  const sf = ts.createSourceFile(
    "authored.tsx",
    source,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    ts.ScriptKind.TSX,
  );

  type Edit = { start: number; end: number; text: string };
  const edits: Edit[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node) && isCssStyleObjectLiteral(node)) {
      for (const prop of node.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const name = propertyNameText(prop.name);
        if (!name || !isReactNativeStyleKey(name)) continue;

        const range = propertyRemovalRange(prop, source, sf);
        const expand = EXPAND_PAIRS[name];
        const valueText = simpleStyleValueText(prop.initializer, sf);
        if (expand && valueText !== null) {
          const [a, b] = expand;
          // range often includes the trailing comma — put a comma after the
          // expanded pair so the next sibling stays valid.
          const needsComma = range.end > prop.getEnd() || /,\s*$/.test(source.slice(range.start, range.end));
          edits.push({
            start: range.start,
            end: range.end,
            text: `${a}: ${valueText}, ${b}: ${valueText}${needsComma ? "," : ""}`,
          });
        } else if (SHADOW_STRIP_KEYS.has(name) || expand) {
          // Nested shadowOffset / non-simple expand value → drop property.
          edits.push({ start: range.start, end: range.end, text: "" });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (edits.length === 0) return source;
  edits.sort((a, b) => b.start - a.start);
  let out = source;
  let lastStart = Infinity;
  for (const e of edits) {
    if (e.end > lastStart) continue;
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    lastStart = e.start;
  }
  return out;
}

/**
 * Rewrite fontFamily values toward brand stacks (AST property values only).
 */
export function normalizeAuthoredFonts(source: string): string {
  const sf = ts.createSourceFile(
    "authored.tsx",
    source,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    ts.ScriptKind.TSX,
  );

  type Edit = { start: number; end: number; text: string };
  const edits: Edit[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const name = propertyNameText(node.name);
      if (name === "fontFamily" && ts.isStringLiteralLike(node.initializer)) {
        const raw = node.initializer.text;
        const next = rewriteFontStack(raw);
        if (next !== raw) {
          const q = ts.isStringLiteral(node.initializer) && node.initializer.getText(sf).startsWith("'") ? "'" : '"';
          edits.push({
            start: node.initializer.getStart(sf),
            end: node.initializer.getEnd(),
            text: `${q}${next.replace(/\\/g, "\\\\").replace(new RegExp(q, "g"), `\\${q}`)}${q}`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (edits.length === 0) return source;
  edits.sort((a, b) => b.start - a.start);
  let out = source;
  for (const e of edits) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

/** Map a fontFamily string to brand defaults. */
export function rewriteFontStack(value: string): string {
  const v = value.trim().toLowerCase();
  if (!v) return BRAND_FONT_STACK;
  if (v.includes("inter") || v.includes("be vietnam")) return value.trim();
  if (v.includes("cascadia") || v === "monospace" || v.includes("mono")) {
    if (v.includes("cascadia")) return value.trim();
    return BRAND_MONO_STACK;
  }
  // system-ui, -apple-system, Segoe UI, Arial, sans-serif-only, etc.
  if (
    v.includes("system-ui") ||
    v.includes("apple-system") ||
    v.includes("blinkmacsystemfont") ||
    v.includes("segoe") ||
    v.includes("roboto") ||
    v.includes("helvetica") ||
    v.includes("arial") ||
    v === "sans-serif" ||
    v.startsWith("sans-serif")
  ) {
    return BRAND_FONT_STACK;
  }
  // Unknown custom → brand body (bold product consistency).
  return BRAND_FONT_STACK;
}

/** Kebab-case SVG attributes emitted by LLMs -> React camelCase equivalents. */
export const SVG_KEBAB_TO_CAMEL: Record<string, string> = {
  "stroke-width": "strokeWidth",
  "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-miterlimit": "strokeMiterlimit",
  "stroke-opacity": "strokeOpacity",
  "stop-color": "stopColor",
  "stop-opacity": "stopOpacity",
  "fill-opacity": "fillOpacity",
  "fill-rule": "fillRule",
  "clip-path": "clipPath",
  "clip-rule": "clipRule",
  "font-size": "fontSize",
  "font-family": "fontFamily",
  "font-weight": "fontWeight",
  "text-anchor": "textAnchor",
  "dominant-baseline": "dominantBaseline",
  "alignment-baseline": "alignmentBaseline",
  "marker-start": "markerStart",
  "marker-mid": "markerMid",
  "marker-end": "markerEnd",
  "pointer-events": "pointerEvents",
};

/**
 * Normalize kebab-case SVG attributes on JSX elements to React camelCase.
 * Idempotent. Prevents N10/N11 build/typecheck failures from raw SVG authoring.
 */
export function normalizeSvgJsxAttributes(source: string): string {
  const sf = ts.createSourceFile(
    "authored.tsx",
    source,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    ts.ScriptKind.TSX,
  );

  type Edit = { start: number; end: number; text: string };
  const edits: Edit[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node)) {
      const attrName = ts.isIdentifier(node.name) ? node.name.text : node.name.getText(sf);
      const camel = SVG_KEBAB_TO_CAMEL[attrName];
      if (camel) {
        edits.push({
          start: node.name.getStart(sf),
          end: node.name.getEnd(),
          text: camel,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (edits.length === 0) return source;
  edits.sort((a, b) => b.start - a.start);
  let out = source;
  for (const e of edits) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

/** Apply all authored-source normalizers before persist / typecheck. */
export function normalizeAuthoredSource(source: string): string {
  let cur = stripReactNativeStyleKeys(source);
  cur = normalizeAuthoredFonts(cur);
  cur = normalizeSvgJsxAttributes(cur);
  return cur;
}

function simpleStyleValueText(expr: ts.Expression, sf: ts.SourceFile): string | null {
  if (ts.isNumericLiteral(expr) || ts.isStringLiteralLike(expr) || ts.isIdentifier(expr)) {
    return expr.getText(sf);
  }
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expr.operand)
  ) {
    return expr.getText(sf);
  }
  return null;
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return null;
}

function propertyRemovalRange(
  prop: ts.ObjectLiteralElementLike,
  text: string,
  sf: ts.SourceFile,
): { start: number; end: number } {
  let start = prop.getStart(sf);
  let end = prop.getEnd();

  let i = end;
  while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
  if (text[i] === ",") {
    end = i + 1;
    return { start, end };
  }

  let j = start - 1;
  while (j >= 0 && (text[j] === " " || text[j] === "\t" || text[j] === "\n" || text[j] === "\r")) {
    j--;
  }
  if (j >= 0 && text[j] === ",") {
    start = j;
  }

  return { start, end };
}
