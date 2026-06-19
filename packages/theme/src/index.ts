/**
 * @news/theme — the single neutral theme the freeform engine ships.
 *
 * Replaces the deleted multi-language `@news/design`: ONE neutral look so
 * `@news/blocks` still resolves a `Theme` off `useTheme()`, while authored scenes
 * decide all their own visuals in code. See `theme.ts` for the shape + the
 * cross-model 2-layer defense (typed aliases + Proxy fallback).
 */
export * from "./theme.js";
