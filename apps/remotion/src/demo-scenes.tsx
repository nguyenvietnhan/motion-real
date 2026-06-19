import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";

/**
 * App-local DEMO scenes for the Studio preview + no-voice sample draft. These are
 * NOT built-in templates (pure AUTHOR mode keeps `@news/compositions` template-
 * free) — they live in the app and exist only so `render --sample` / Studio show
 * real visuals without a per-project authored bundle. Importing this module
 * registers them.
 *
 * Post-freeform-pivot the layout blocks were deleted, so these demos are written
 * as raw JSX/CSS — the SAME shape an authored scene now takes (bespoke <div>/<svg>,
 * theme tokens hard-coded, motion via useCurrentFrame + interpolate).
 */

const FG = "#F2F5F8";
const MUTED = "#9AA7B4";
const ACCENT = "#6CC7FF";
const BG = "#0B1020";
const DISPLAY = "Inter, system-ui, sans-serif";

/** Eased fade+rise entrance that settles by frame ~16 (deterministic, frame-pure). */
function useEnter(): number {
  const frame = useCurrentFrame();
  return interpolate(frame, [0, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}

/** Shared full-bleed dark stage with the content lifted into the upper zone. */
const Stage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(120% 80% at 50% 12%, #15203A 0%, ${BG} 70%)`,
      padding: 96,
      paddingBottom: 560,
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      gap: 40,
    }}
  >
    {children}
  </AbsoluteFill>
);

const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontFamily: DISPLAY, fontSize: 30, letterSpacing: 6, color: ACCENT, fontWeight: 700 }}>{children}</div>
);

const Headline: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h1 style={{ fontFamily: DISPLAY, fontSize: 86, lineHeight: 1.05, color: FG, margin: 0, fontWeight: 800 }}>{children}</h1>
);

const heroSchema = z.object({ callout: z.string().optional() });
type HeroProps = z.infer<typeof heroSchema>;
const DemoHero: React.FC<SceneComponentProps<HeroProps>> = ({ headline, body, props }) => {
  const enter = useEnter();
  return (
    <Stage>
      <div style={{ opacity: enter, transform: `translateY(${(1 - enter) * 28}px)`, display: "flex", flexDirection: "column", gap: 28 }}>
        <Eyebrow>TIN</Eyebrow>
        <Headline>{headline}</Headline>
        {body ? <p style={{ fontFamily: DISPLAY, fontSize: 40, lineHeight: 1.3, color: MUTED, margin: 0 }}>{body}</p> : null}
        {props.callout ? (
          <div style={{ alignSelf: "flex-start", marginTop: 12, padding: "16px 28px", borderRadius: 14, background: ACCENT, color: BG, fontFamily: DISPLAY, fontSize: 36, fontWeight: 800 }}>
            {props.callout}
          </div>
        ) : null}
      </div>
    </Stage>
  );
};
export const demoHero = registerComponent<HeroProps>({
  id: "demo-hero",
  displayName: "Demo Hero",
  promptGuide: "Sample/Studio hook scene.",
  schema: heroSchema,
  Component: DemoHero,
  example: { callout: "Tự do có kỷ luật" },
});

const pointsSchema = z.object({ points: z.array(z.string()).min(1).max(6) });
type PointsProps = z.infer<typeof pointsSchema>;
const DemoPoints: React.FC<SceneComponentProps<PointsProps>> = ({ headline, props }) => {
  const enter = useEnter();
  return (
    <Stage>
      <Headline>{headline}</Headline>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 16 }}>
        {props.points.map((pt, i) => {
          const step = interpolate(enter, [i / props.points.length, 1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <div key={i} style={{ opacity: step, transform: `translateX(${(1 - step) * 24}px)`, display: "flex", gap: 24, alignItems: "center" }}>
              <span style={{ fontFamily: DISPLAY, fontSize: 44, fontWeight: 800, color: ACCENT, minWidth: 56 }}>{i + 1}</span>
              <span style={{ fontFamily: DISPLAY, fontSize: 42, color: FG }}>{pt}</span>
            </div>
          );
        })}
      </div>
    </Stage>
  );
};
export const demoPoints = registerComponent<PointsProps>({
  id: "demo-points",
  displayName: "Demo Key Points",
  promptGuide: "Sample/Studio enumerated-list scene.",
  schema: pointsSchema,
  Component: DemoPoints,
  example: { points: ["Một", "Hai", "Ba"] },
});

const ideaSchema = z.object({ idea: z.string(), label: z.string().optional() });
type IdeaProps = z.infer<typeof ideaSchema>;
const DemoIdea: React.FC<SceneComponentProps<IdeaProps>> = ({ headline, props }) => {
  const enter = useEnter();
  return (
    <Stage>
      <Headline>{headline}</Headline>
      <div style={{ opacity: enter, transform: `scale(${0.96 + enter * 0.04})`, transformOrigin: "left center", borderLeft: `8px solid ${ACCENT}`, paddingLeft: 36, marginTop: 16 }}>
        {props.label ? <Eyebrow>{props.label}</Eyebrow> : null}
        <p style={{ fontFamily: DISPLAY, fontSize: 56, lineHeight: 1.2, color: FG, margin: "12px 0 0", fontWeight: 700 }}>{props.idea}</p>
      </div>
    </Stage>
  );
};
export const demoIdea = registerComponent<IdeaProps>({
  id: "demo-idea",
  displayName: "Demo Idea Panel",
  promptGuide: "Sample/Studio single-idea scene.",
  schema: ideaSchema,
  Component: DemoIdea,
  example: { idea: "Một ý chính", label: "Ý" },
});

const ctaSchema = z.object({ question: z.string() });
type CtaProps = z.infer<typeof ctaSchema>;
const DemoCta: React.FC<SceneComponentProps<CtaProps>> = ({ headline, props }) => {
  const enter = useEnter();
  return (
    <Stage>
      <div style={{ opacity: enter, transform: `translateY(${(1 - enter) * 28}px)`, display: "flex", flexDirection: "column", gap: 28, alignItems: "center", textAlign: "center" }}>
        <Headline>{headline}</Headline>
        <p style={{ fontFamily: DISPLAY, fontSize: 46, lineHeight: 1.3, color: ACCENT, margin: 0, fontWeight: 700 }}>{props.question}</p>
      </div>
    </Stage>
  );
};
export const demoCta = registerComponent<CtaProps>({
  id: "demo-cta",
  displayName: "Demo CTA",
  promptGuide: "Sample/Studio closing CTA scene.",
  schema: ctaSchema,
  Component: DemoCta,
  example: { question: "Bạn sẽ xây lưới an toàn nào trước?" },
});
