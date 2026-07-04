/**
 * Internal bridge for per-project theme propagation in the composition runtime.
 *
 * The context lives in `@motionreal/blocks` (the lowest React-aware layer), while
 * `video.tsx` imports this file relatively so the master composition shares that
 * same runtime instance. Authored scenes do not import this module or read theme
 * tokens from `@motionreal/compositions`.
 */
export { ThemeProvider, useTheme } from "@motionreal/blocks";
