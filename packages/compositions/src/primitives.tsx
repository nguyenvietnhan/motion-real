import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { easing, sceneBackground, theme } from "@news/design";

/**
 * Shared layout + motion primitives. Scene components compose these instead of
 * hand-writing pixel coordinates, keeping the 9:16 safe-area and visual grammar
 * consistent across diverse layouts (the web analogue of math-tool's mvlib).
 */

export type SceneContext = {
  /** 0..1 progress through this scene's local timeline. */
  progress: number;
  headline: string;
  body?: string;
  eyebrow?: string;
};

/** Full-bleed scene background with the shared gradient + subtle grid. */
export const SceneFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <AbsoluteFill
      style={{
        background: sceneBackground(),
        color: theme.colors.fg,
        fontFamily: theme.fonts.body,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(90deg, rgba(246,241,230,.035) 1px, transparent 1px)," +
            "linear-gradient(0deg, rgba(246,241,230,.03) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
          opacity: 0.7,
          pointerEvents: "none",
        }}
      />
      {children}
    </AbsoluteFill>
  );
};

/** Standard content column with safe margins for vertical video. */
export const Content: React.FC<{ children: React.ReactNode; gap?: number }> = ({ children, gap = 40 }) => (
  <AbsoluteFill
    style={{
      padding: "140px 80px 180px",
      display: "flex",
      flexDirection: "column",
      gap,
    }}
  >
    {children}
  </AbsoluteFill>
);

/** Eyebrow + headline + body block, animated in with a blur-slide-up. */
export const StoryHeader: React.FC<{
  eyebrow?: string;
  headline: string;
  body?: string;
}> = ({ eyebrow, headline, body }) => {
  const frame = useCurrentFrame();
  const reveal = (delay: number) =>
    interpolate(frame, [delay, delay + 14], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: (t) => bezier(easing.out, t),
    });

  const headlineSize = headline.length > 42 ? 70 : headline.length > 24 ? 86 : 104;

  return (
    <div style={{ display: "grid", gap: 26, maxWidth: 920 }}>
      {eyebrow ? (
        <div
          style={{
            fontFamily: theme.fonts.mono,
            textTransform: "uppercase",
            letterSpacing: "0.2em",
            fontSize: 22,
            color: theme.colors.accent,
            opacity: reveal(0),
          }}
        >
          {eyebrow}
        </div>
      ) : null}
      <div
        style={{
          width: 160,
          height: 5,
          background: `linear-gradient(90deg, ${theme.colors.accent}, ${theme.colors.signal}, transparent)`,
          borderRadius: 3,
          transformOrigin: "left center",
          transform: `scaleX(${reveal(4)})`,
        }}
      />
      <h1
        style={{
          margin: 0,
          fontFamily: theme.fonts.display,
          fontWeight: 900,
          fontSize: headlineSize,
          lineHeight: 1.12,
          letterSpacing: "-0.01em",
          opacity: reveal(6),
          transform: `translateY(${(1 - reveal(6)) * 24}px)`,
          filter: `blur(${(1 - reveal(6)) * 6}px)`,
        }}
      >
        {headline}
      </h1>
      {body ? (
        <p
          style={{
            margin: 0,
            color: theme.colors.fg,
            opacity: 0.95 * reveal(12),
            fontSize: 42,
            lineHeight: 1.38,
            maxWidth: 900,
            transform: `translateY(${(1 - reveal(12)) * 18}px)`,
          }}
        >
          {body}
        </p>
      ) : null}
    </div>
  );
};

/** A framed visual panel that the scene's custom content sits inside. */
export const VisualFrame: React.FC<{ children: React.ReactNode; delay?: number }> = ({ children, delay = 10 }) => {
  const frame = useCurrentFrame();
  const reveal = interpolate(frame, [delay, delay + 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: (t) => bezier(easing.out, t),
  });
  return (
    <div
      style={{
        flex: 1,
        display: "grid",
        placeItems: "center",
        opacity: reveal,
        transform: `translateY(${(1 - reveal) * 30}px) scale(${0.96 + reveal * 0.04})`,
      }}
    >
      <div
        style={{
          width: 940,
          border: `2.5px solid rgba(199,167,90,0.35)`,
          background: "rgba(9,12,20,0.94)",
          boxShadow: "0 50px 120px rgba(0,0,0,0.9), inset 0 1px 4px rgba(255,255,255,0.2)",
          borderRadius: theme.radius.lg,
          overflow: "hidden",
          padding: 56,
        }}
      >
        {children}
      </div>
    </div>
  );
};

/** Cubic-bezier evaluator usable inside interpolate's easing option. */
export function bezier(p: [number, number, number, number], t: number): number {
  // Approximate cubic-bezier(p0x,p0y,p1x,p1y) for x=t via Newton-ish sampling.
  const [x1, y1, x2, y2] = p;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;
  let u = t;
  for (let i = 0; i < 5; i += 1) {
    const x = sampleX(u) - t;
    const d = (3 * ax * u + 2 * bx) * u + cx;
    if (Math.abs(d) < 1e-6) break;
    u -= x / d;
  }
  return sampleY(Math.min(1, Math.max(0, u)));
}

/** Hook giving 0..1 progress through the current scene. */
export function useSceneProgress(): number {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return durationInFrames > 1 ? frame / (durationInFrames - 1) : 0;
}
