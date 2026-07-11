/**
 * Pure pre-write rewrites for AI-authored scene modules.
 *
 * Models sometimes emit React Native style keys (`shadowColor`, …) inside web
 * `style={{…}}` objects. N10 typechecks against React's CSSProperties, which
 * rejects those keys (TS2353) and fails the full render at build-gate — after
 * expensive prepare/QA. Strip the known RN-only keys (AST-safe) so remaining
 * valid CSS (`boxShadow` / `textShadow` / SVG `filter`) is left untouched.
 *
 * Does NOT convert RN shadows to boxShadow (web/RN models differ). Admission
 * also bans residual RN keys as defense-in-depth.
 */

import ts from "typescript";

/** React Native shadow / elevation keys that are not valid CSSProperties. */
export const REACT_NATIVE_STYLE_KEYS = [
  "shadowColor",
  "shadowOffset",
  "shadowOpacity",
  "shadowRadius",
  "elevation",
] as const;

export type ReactNativeStyleKey = (typeof REACT_NATIVE_STYLE_KEYS)[number];

const RN_KEY_SET: ReadonlySet<string> = new Set(REACT_NATIVE_STYLE_KEYS);

/** True when `name` is a known React Native-only style property. */
export function isReactNativeStyleKey(name: string): boolean {
  return RN_KEY_SET.has(name);
}

/**
 * Remove known invalid React Native style property assignments via TS AST.
 * Idempotent; leaves valid CSS (`boxShadow`, `textShadow`) and string/comment
 * contents untouched. Unparseable source is returned unchanged (admission N4
 * handles syntax).
 */
export function stripReactNativeStyleKeys(source: string): string {
  // Parse as a full TSX module. TypeScript still builds a usable AST when the
  // buffer is a fragment or has soft errors — do not no-op on parseDiagnostics
  // (that left RN keys in place for any imperfect model output).
  const sf = ts.createSourceFile(
    "authored.tsx",
    source,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    ts.ScriptKind.TSX,
  );

  const ranges: Array<{ start: number; end: number }> = [];

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        const name = objectLiteralPropertyName(prop);
        if (name && isReactNativeStyleKey(name)) {
          ranges.push(propertyRemovalRange(prop, source, sf));
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (ranges.length === 0) return source;

  // Remove from the end so earlier offsets stay valid.
  ranges.sort((a, b) => b.start - a.start);
  let out = source;
  let lastStart = Infinity;
  for (const { start, end } of ranges) {
    if (end > lastStart) continue; // overlap guard
    out = out.slice(0, start) + out.slice(end);
    lastStart = start;
  }
  return out;
}

/** Apply all authored-source normalizers before persist / typecheck. */
export function normalizeAuthoredSource(source: string): string {
  return stripReactNativeStyleKeys(source);
}

function objectLiteralPropertyName(prop: ts.ObjectLiteralElementLike): string | null {
  if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop) || ts.isMethodDeclaration(prop)) {
    return propertyNameText(prop.name);
  }
  // Spread / non-name forms: leave alone.
  return null;
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return null;
}

/**
 * Expand a property node range to include the adjacent comma so the object
 * literal stays syntactically valid after removal.
 */
function propertyRemovalRange(
  prop: ts.ObjectLiteralElementLike,
  text: string,
  sf: ts.SourceFile,
): { start: number; end: number } {
  // Leading trivia (whitespace/newlines before this prop) stays with the prior
  // sibling so we don't glue tokens; we only remove the property itself + comma.
  let start = prop.getStart(sf);
  let end = prop.getEnd();

  // Prefer trailing comma after this property.
  let i = end;
  while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
  if (text[i] === ",") {
    end = i + 1;
    return { start, end };
  }

  // Last property (or no trailing comma): drop the preceding comma.
  let j = start - 1;
  while (j >= 0 && (text[j] === " " || text[j] === "\t" || text[j] === "\n" || text[j] === "\r")) {
    j--;
  }
  if (j >= 0 && text[j] === ",") {
    start = j;
  }

  return { start, end };
}
