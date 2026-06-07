import React from "react";
import { useVideoConfig } from "remotion";

/**
 * Per-scene timing context. Inside a `TransitionSeries.Sequence`,
 * `useCurrentFrame()` is sequence-relative but `useVideoConfig().durationInFrames`
 * is the WHOLE composition — so a block can't know its own scene's length. The
 * master composition wraps each scene in `<SceneTimingProvider>` carrying the
 * scene's `durationInFrames`, letting effects (e.g. the per-scene tilt) sync
 * exactly to when the scene ends. Falls back to the composition duration when no
 * provider is present (e.g. render-free block tests).
 */
const SceneTimingContext = React.createContext<{ durationInFrames: number } | null>(null);

export const SceneTimingProvider: React.FC<{ durationInFrames: number; children: React.ReactNode }> = ({
  durationInFrames,
  children,
}) => {
  const value = React.useMemo(() => ({ durationInFrames }), [durationInFrames]);
  return <SceneTimingContext.Provider value={value}>{children}</SceneTimingContext.Provider>;
};

/** The current scene's duration in frames (falls back to the composition duration). */
export function useSceneDurationInFrames(): number {
  const ctx = React.useContext(SceneTimingContext);
  const { durationInFrames } = useVideoConfig();
  return ctx?.durationInFrames ?? durationInFrames;
}
