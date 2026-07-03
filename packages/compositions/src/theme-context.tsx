/**
 * Per-project theme propagation.
 *
 * The context now LIVES in `@motionreal/blocks` (the lowest React-aware layer) so
 * blocks, this package's master composition, and authored scenes all share ONE
 * context instance. This module re-exports it for back-compat — existing
 * imports of `useTheme`/`ThemeProvider` from `@motionreal/compositions` keep working
 * and resolve to the exact same context as `@motionreal/blocks`.
 */
export { ThemeProvider, useTheme } from "@motionreal/blocks";
