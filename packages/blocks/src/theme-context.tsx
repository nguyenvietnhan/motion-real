import React, { createContext, useContext } from "react";
import { theme as defaultTheme, type Theme } from "@motionreal/theme";

/**
 * Per-project theme propagation. This context lives in `@motionreal/blocks` — the
 * lowest React-aware layer — so blocks, the master composition, and authored
 * scenes all share ONE context instance without `@motionreal/compositions` and
 * `@motionreal/blocks` importing each other (the dependency rule is
 * design → blocks → compositions, no cycles).
 *
 * Outside a provider (Studio defaults, unit tests) it falls back to the default
 * theme so components always render.
 */
const ThemeContext = createContext<Theme>(defaultTheme);

export const ThemeProvider: React.FC<{ theme: Theme; children: React.ReactNode }> = ({ theme, children }) => (
  <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
);

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
