/**
 * @motionreal/theme — single neutral runtime theme for render internals.
 *
 * `@motionreal/blocks` resolves a `Theme` off `useTheme`. Authored scenes decide
 * their own visuals and must not import this package. See `theme.ts` for the
 * shape and cross-model token defense (typed aliases + Proxy fallback).
 */
export * from "./theme.js";
