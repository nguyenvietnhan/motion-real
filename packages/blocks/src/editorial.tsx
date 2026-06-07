import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { onColor, PRINT } from "@news/design";
import { CONTENT_ZONE, rectHeight, rectWidth } from "@news/schema";
import { useTheme } from "./theme-context.js";
import { useReveal, useRamp, usePop, useTilt, frameRamp } from "./motion.js";
import { chromeBorder, chromeBorderWidth, chromeShadow } from "./chrome.js";

/**
 * Editorial "boxed" blocks for the LIGHT print look: ink-on-cream, bold borders,
 * vivid accent fills, mono labels, decorative rules — plus animated entrances
 * and two authored-visualization primitives (`CountUp`, `BarChart`). Compose
 * these for structured, visualized scenes. All deterministic (frame-derived).
 */

export type Tone = "accent" | "signal" | "blue" | "red" | "yellow" | "green" | "violet" | "neutral";

function toneColor(theme: ReturnType<typeof useTheme>, tone: Tone): string {
  switch (tone) {
    case "signal":
      return theme.colors.signal;
    case "blue":
      return PRINT.blue;
    case "red":
      return PRINT.red;
    case "yellow":
      return PRINT.yellow;
    case "green":
      return PRINT.green;
    case "violet":
      return PRINT.violet;
    case "neutral":
      return theme.colors.muted;
    default:
      return theme.colors.accent;
  }
}

/** A small mono uppercase chip on a solid accent fill. */
export const Tag: React.FC<{ children: React.ReactNode; tone?: Tone; solid?: boolean }> = ({
  children,
  tone = "accent",
  solid = true,
}) => {
  const theme = useTheme();
  const c = toneColor(theme, tone);
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: theme.fonts.mono,
        fontWeight: 800,
        fontSize: 24,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        padding: "8px 16px",
        background: solid ? c : "transparent",
        color: solid ? onColor(c) : theme.colors.fg,
        border: chromeBorder(theme),
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
};

/** Top label bar: solid accent eyebrow chip + section label + right meta. Wipes in. */
export const HeaderBar: React.FC<{ eyebrow: string; label?: string; meta?: string }> = ({
  eyebrow,
  label,
  meta,
}) => {
  const theme = useTheme();
  const r = useReveal(0, 16);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        border: chromeBorder(theme),
        background: theme.colors.panel,
        clipPath: `inset(0 ${(1 - r) * 100}% 0 0)`,
      }}
    >
      <span
        style={{
          fontFamily: theme.fonts.mono,
          fontWeight: 800,
          fontSize: 28,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          background: theme.colors.accent,
          color: onColor(theme.colors.accent),
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          borderRight: `${chromeBorderWidth(theme)}px solid ${PRINT.ink}`,
        }}
      >
        {eyebrow}
      </span>
      <span
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: 26,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: theme.colors.muted,
          padding: "16px 22px",
          display: "flex",
          alignItems: "center",
          flex: 1,
        }}
      >
        {label ?? ""}
      </span>
      {meta ? (
        <span
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: 26,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: theme.colors.fg,
            padding: "16px 24px",
            display: "flex",
            alignItems: "center",
          }}
        >
          {meta}
        </span>
      ) : null}
    </div>
  );
};

/** A framed, bordered content panel with a top accent rule + optional title tag. */
export const Panel: React.FC<{
  children: React.ReactNode;
  title?: string;
  tone?: Tone;
  delay?: number;
}> = ({ children, title, tone = "accent", delay = 6 }) => {
  const theme = useTheme();
  const c = toneColor(theme, tone);
  const r = useReveal(delay);
  return (
    <div
      style={{
        border: chromeBorder(theme),
        background: theme.colors.panel,
        opacity: r,
        transform: `translateY(${(1 - r) * 22}px)`,
        boxShadow: chromeShadow(theme, c),
      }}
    >
      <div style={{ height: 12, background: c, borderBottom: `${chromeBorderWidth(theme)}px solid ${PRINT.ink}` }} />
      <div style={{ padding: "30px 34px", display: "grid", gap: 18 }}>
        {title ? (
          <div style={{ display: "flex" }}>
            <Tag tone={tone}>{title}</Tag>
          </div>
        ) : null}
        <div style={{ fontSize: 42, lineHeight: 1.3, color: theme.colors.fg }}>{children}</div>
      </div>
    </div>
  );
};

/**
 * Deterministically shrink a hero number's font when its string is long, so a
 * big value (e.g. "110000", "180-190 B$") never balloons past its container and
 * collides with a sibling label. Pure function of the final string length, so
 * it does not jitter while a `CountUp` animates (the size is computed from the
 * final value). Comfortable up to `comfortable` chars; shrinks ~1/length after.
 */
function heroFontSize(text: string, base = 190, comfortable = 4, min = 84): number {
  const len = text.length;
  if (len <= comfortable) return base;
  return Math.max(min, Math.round((base * comfortable) / len));
}

/** Big number reveal: huge ink value + accent unit + label, framed with a sidebar. */
export const StatBlock: React.FC<{ value: string; unit?: string; label: string; tone?: Tone }> = ({
  value,
  unit,
  label,
  tone = "accent",
}) => {
  const theme = useTheme();
  const c = toneColor(theme, tone);
  const r = useReveal(4);
  const valueFont = heroFontSize(value);
  return (
    <div
      style={{
        display: "flex",
        border: chromeBorder(theme),
        background: theme.colors.panel,
        opacity: r,
        transform: `translateY(${(1 - r) * 24}px)`,
        boxShadow: chromeShadow(theme, c),
      }}
    >
      <div style={{ width: 20, background: c, borderRight: `${chromeBorderWidth(theme)}px solid ${PRINT.ink}` }} />
      <div style={{ padding: "36px 40px", display: "grid", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
          <span
            style={{
              fontFamily: theme.fonts.display,
              fontWeight: 900,
              fontSize: valueFont,
              lineHeight: 0.9,
              color: theme.colors.fg,
              letterSpacing: "-0.03em",
            }}
          >
            {value}
          </span>
          {unit ? (
            <span style={{ fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 46, color: c }}>{unit}</span>
          ) : null}
        </div>
        <div style={{ fontFamily: theme.fonts.mono, fontSize: 32, letterSpacing: "0.06em", color: theme.colors.muted }}>
          {label}
        </div>
      </div>
    </div>
  );
};

/**
 * `CountUp` — an authored-viz primitive: a number that counts up to `to` over
 * the entrance, with optional `prefix`/`suffix`. Deterministic (frame ramp).
 * The font auto-shrinks for long values (computed from the FINAL string) so a
 * large count never overruns a sibling label.
 */
export const CountUp: React.FC<{
  to: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  tone?: Tone;
}> = ({ to, prefix = "", suffix = "", decimals = 0, tone = "accent" }) => {
  const theme = useTheme();
  const c = toneColor(theme, tone);
  const t = useRamp(4, 30);
  // One-time "zoom in then back out" emphasis right as the count finishes — made
  // clearly visible (a strong, slightly slow pop) so the stat reads as a beat.
  const pop = usePop(1.0, 1.26, 0.26, 0.5);
  const shown = (to * t).toFixed(decimals);
  // Size from the FINAL string (prefix + full value) so the font is stable
  // while counting and never overflows for a long number.
  const valueFont = heroFontSize(`${prefix}${to.toFixed(decimals)}`);
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 12, maxWidth: "100%", transform: `scale(${pop.toFixed(4)})`, transformOrigin: "left center" }}>
      <span style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: valueFont, lineHeight: 0.9, color: theme.colors.fg, letterSpacing: "-0.03em" }}>
        {prefix}
        {shown}
      </span>
      {suffix ? <span style={{ fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 46, color: c }}>{suffix}</span> : null}
    </span>
  );
};

/**
 * `BarChart` — an authored-viz primitive: horizontal bars that grow in on
 * entrance. `items` are `{ label, value 0..1, tone? }`. Deterministic.
 */
export const BarChart: React.FC<{ items: Array<{ label: string; value: number; tone?: Tone }> }> = ({ items }) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ display: "grid", gap: 22 }}>
      {items.map((it, i) => {
        const c = toneColor(theme, it.tone ?? (i % 2 === 0 ? "accent" : "signal"));
        const grow = frameRamp(frame, fps, 8 + i * 6, 26);
        const pct = Math.min(1, Math.max(0, it.value)) * grow;
        return (
          <div key={i} style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: theme.fonts.mono, fontSize: 28, color: theme.colors.fg }}>
              <span>{it.label}</span>
              <span style={{ color: c, fontWeight: 800 }}>{Math.round(pct * 100)}%</span>
            </div>
            <div style={{ height: 40, border: chromeBorder(theme), background: theme.colors.bg }}>
              <div style={{ height: "100%", width: `${pct * 100}%`, background: c }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** Bottom strip: small mono left + right meta. The horizontal separator is the
 *  global divider drawn by the composition (so it's present on EVERY video, even
 *  when a scene doesn't use a Footer) — the Footer itself no longer draws one,
 *  to avoid a double line. */
export const Footer: React.FC<{ left: string; right?: string }> = ({ left, right }) => {
  const theme = useTheme();
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        paddingTop: 16,
      }}
    >
      <span style={{ fontFamily: theme.fonts.mono, fontSize: 24, letterSpacing: "0.12em", textTransform: "uppercase", color: theme.colors.muted }}>
        {left}
      </span>
      {right ? (
        <span style={{ fontFamily: theme.fonts.mono, fontSize: 24, letterSpacing: "0.1em", textTransform: "uppercase", color: theme.colors.muted }}>
          {right}
        </span>
      ) : null}
    </div>
  );
};

/**
 * `Story` — full-frame editorial layout inside the content zone: a `HeaderBar`
 * pinned at the top, the main content centred in the middle, and an optional
 * `Footer` at the bottom of the content zone.
 */
export const Story: React.FC<{
  eyebrow: string;
  label?: string;
  meta?: string;
  footer?: { left: string; right?: string };
  gap?: number;
  children: React.ReactNode;
}> = ({ eyebrow, label, meta, footer, gap = 28, children }) => {
  // Ambient "living card": the scene's floating blocks (in ONE parent wrapper)
  // slowly tilt in 3D from one lean to the other across the scene. This is the
  // always-on subtle life. EMPHASIS (a whole-scene zoom) is NOT here — it is an
  // AI-chosen, per-scene decision applied by the composition (scene.emphasis).
  const tilt = useTilt();
  return (
    <div
      style={{
        position: "absolute",
        top: CONTENT_ZONE.top,
        left: CONTENT_ZONE.left,
        width: rectWidth(CONTENT_ZONE),
        height: rectHeight(CONTENT_ZONE),
        display: "flex",
        flexDirection: "column",
        gap,
      }}
    >
      <HeaderBar eyebrow={eyebrow} label={label} meta={meta} />
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap,
          transform: `perspective(1600px) rotateY(${tilt.toFixed(3)}deg)`,
          transformOrigin: "center center",
          transformStyle: "preserve-3d",
        }}
      >
        {children}
      </div>
      {footer ? <Footer left={footer.left} right={footer.right} /> : null}
    </div>
  );
};
