/**
 * Pure pre-write rewrites for AI-authored scene modules.
 *
 * Models sometimes emit React Native style keys (`shadowColor`, …) inside web
 * `style={{…}}` objects. N10 typechecks against React's CSSProperties, which
 * rejects those keys (TS2353) and fails the full render at build-gate — after
 * expensive prepare/QA. Strip the known RN-only keys so shadow intent falls
 * through to valid CSS (`boxShadow` / `textShadow` / SVG `filter`) when present.
 */

/** React Native shadow / elevation keys that are not valid CSSProperties. */
export const REACT_NATIVE_STYLE_KEYS = [
  "shadowColor",
  "shadowOffset",
  "shadowOpacity",
  "shadowRadius",
  "elevation",
] as const;

/**
 * Remove known invalid React Native style property assignments from source.
 * Idempotent; leaves valid CSS (`boxShadow`, `textShadow`) untouched.
 */
export function stripReactNativeStyleKeys(source: string): string {
  let out = source;
  for (const key of REACT_NATIVE_STYLE_KEYS) {
    // Property assignment: `shadowColor: <expr>` optional trailing comma/ws.
    // Does not touch string contents that merely mention the name in comments
    // only if the key is a bare identifier followed by colon (style object shape).
    out = out.replace(new RegExp(`\\b${key}\\s*:\\s*[^,}\\n]+,?\\s*`, "g"), "");
  }
  return out;
}

/** Apply all authored-source normalizers before persist / typecheck. */
export function normalizeAuthoredSource(source: string): string {
  return stripReactNativeStyleKeys(source);
}
