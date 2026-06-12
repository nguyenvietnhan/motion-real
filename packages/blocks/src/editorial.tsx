import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { onColor, type Theme } from "@news/design";
import { CONTENT_ZONE, rectHeight, rectWidth } from "@news/schema";
import { useTheme } from "./theme-context.js";
import { useInZone, ZoneProvider } from "./zone-context.js";
import { useReveal, useRamp, usePop, useTilt, frameRamp } from "./motion.js";
import {
  blockSurface,
  surfaceBorder,
  surfaceBorderWidth,
  innerDivider,
  surfaceRadius,
  topRuleStyle,
  chipStyle,
  labelStyle,
} from "./chrome.js";

/**
 * Editorial "boxed" blocks + authored-viz primitives. Despite the file name,
 * these are NOT editorial-only: every visual decision (border, radius, fill,
 * shadow, top-rule, chip, label case) reads from the resolved language tokens via
 * the surface-kit, so the SAME blocks render the editorial print look, the galaxy
 * dark look, or any future language. Layout + type scale + motion stay here
 * (invariant); only the surface grammar comes from the theme. All deterministic
 * (frame-derived).
 */

export type Tone = "accent" | "signal" | "blue" | "red" | "yellow" | "green" | "violet" | "neutral";

/**
 * Resolve a tone to a concrete color FROM THE THEME — never a fixed PRINT.* hex,
 * so the semantic series is the language's own (editorial = print hues, galaxy =
 * neon). `accent`/`signal` follow the project dominant; the named hues map to the
 * language's tuned series; `neutral` is muted.
 */
function toneColor(theme: Theme, tone: Tone): string {
  switch (tone) {
    case "signal":
      return theme.colors.signal;
    case "blue":
      return theme.colors.blue;
    case "red":
      return theme.colors.red;
    case "yellow":
      return theme.colors.yellow;
    case "green":
      return theme.colors.green;
    case "violet":
      return theme.colors.violet;
    case "neutral":
      return theme.colors.muted;
    default:
      return theme.colors.accent;
  }
}

/** A small mono label chip — solid (editorial) or outline (galaxy), per the language. */
export const Tag: React.FC<{ children: React.ReactNode; tone?: Tone; solid?: boolean }> = ({
  children,
  tone = "accent",
  solid = true,
}) => {
  const theme = useTheme();
  const c = toneColor(theme, tone);
  // `solid={false}` forces the outline treatment regardless of language; otherwise
  // the language's own chip style decides.
  const chip = solid ? chipStyle(theme, c, onColor) : { background: "transparent", color: theme.colors.fg, border: surfaceBorder(theme), borderRadius: surfaceRadius(theme, "sm") };
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: theme.fonts.mono,
        fontWeight: 800,
        fontSize: 24,
        ...labelStyle(theme),
        padding: "8px 16px",
        whiteSpace: "nowrap",
        ...chip,
      }}
    >
      {children}
    </span>
  );
};

/** Top label bar: accent eyebrow chip + section label + right meta. Wipes in. */
export const HeaderBar: React.FC<{ eyebrow: string; label?: string; meta?: string }> = ({
  eyebrow,
  label,
  meta,
}) => {
  const theme = useTheme();
  const r = useReveal(0, 16);
  const radius = surfaceRadius(theme, "md");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        border: surfaceBorder(theme),
        borderRadius: radius,
        background: theme.surface.panelFill,
        overflow: "hidden",
        clipPath: `inset(0 ${(1 - r) * 100}% 0 0)`,
      }}
    >
      <span
        style={{
          fontFamily: theme.fonts.mono,
          fontWeight: 800,
          fontSize: 28,
          ...labelStyle(theme),
          letterSpacing: "0.16em",
          background: theme.colors.accent,
          color: onColor(theme.colors.accent),
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          borderRight: innerDivider(theme),
        }}
      >
        {eyebrow}
      </span>
      <span
        style={{
          fontFamily: theme.fonts.mono,
          fontSize: 26,
          ...labelStyle(theme),
          color: theme.colors.muted,
          padding: "16px 22px",
          display: "flex",
          alignItems: "center",
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
        }}
      >
        {label ?? ""}
      </span>
      {meta ? (
        <span
          style={{
            fontFamily: theme.fonts.mono,
            fontSize: 26,
            ...labelStyle(theme),
            letterSpacing: "0.1em",
            color: theme.colors.fg,
            padding: "16px 24px",
            display: "flex",
            alignItems: "center",
            whiteSpace: "nowrap",
          }}
        >
          {meta}
        </span>
      ) : null}
    </div>
  );
};

/** A framed content panel with an optional accent top-rule + optional title tag. */
export const Panel: React.FC<{
  children: React.ReactNode;
  title?: string;
  tone?: Tone;
  delay?: number;
}> = ({ children, title, tone = "accent", delay = 6 }) => {
  const theme = useTheme();
  const c = toneColor(theme, tone);
  const r = useReveal(delay);
  const rule = topRuleStyle(theme, c);
  return (
    <div
      data-nrt-block="panel"
      style={{
        ...blockSurface(theme, { accent: c, size: "md" }),
        opacity: r,
        transform: `translateY(${(1 - r) * 22}px)`,
        overflow: "hidden",
      }}
    >
      {rule ? <div style={rule} /> : null}
      <div style={{ padding: "30px 34px", display: "grid", gap: 18 }}>
        {title ? (
          <div style={{ display: "flex" }}>
            <Tag tone={tone}>{title}</Tag>
          </div>
        ) : null}
        <div style={{ fontSize: 42, lineHeight: 1.3, color: theme.colors.fg, overflowWrap: "anywhere" }}>{children}</div>
      </div>
    </div>
  );
};

/**
 * Deterministically shrink a hero number's font when its string is long, so a
 * big value never balloons past its container. Pure function of the final string
 * length (so it doesn't jitter while a `CountUp` animates).
 */
function heroFontSize(text: string, base = 190, comfortable = 4, min = 84): number {
  const len = text.length;
  if (len <= comfortable) return base;
  return Math.max(min, Math.round((base * comfortable) / len));
}

/** Big number reveal: huge value + accent unit + label, framed with a sidebar. */
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
  const radius = surfaceRadius(theme, "md");
  return (
    <div
      data-nrt-block="stat"
      style={{
        display: "flex",
        ...blockSurface(theme, { accent: c, size: "md" }),
        opacity: r,
        transform: `translateY(${(1 - r) * 24}px)`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: 20,
          background: c,
          borderRight: innerDivider(theme),
          borderTopLeftRadius: radius,
          borderBottomLeftRadius: radius,
        }}
      />
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
        <div style={{ fontFamily: theme.fonts.mono, fontSize: 32, ...labelStyle(theme), letterSpacing: "0.06em", color: theme.colors.muted }}>
          {label}
        </div>
      </div>
    </div>
  );
};

/**
 * `CountUp` — a number that counts up to `to` over the entrance, with optional
 * `prefix`/`suffix`. Deterministic (frame ramp). Font auto-shrinks for long
 * values (computed from the FINAL string).
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
  const pop = usePop(1.0, 1.26, 0.26, 0.5);
  const shown = (to * t).toFixed(decimals);
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
 * `BarChart` — horizontal bars that grow in on entrance. `items` are
 * `{ label, value 0..1, tone? }`. Deterministic. Track + bar are language-styled.
 */
export const BarChart: React.FC<{ items: Array<{ label: string; value: number; tone?: Tone }> }> = ({ items }) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const trackRadius = surfaceRadius(theme, "sm");
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
            <div style={{ height: 40, border: surfaceBorder(theme), borderRadius: trackRadius, background: theme.colors.bgElevated, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct * 100}%`, background: c, borderRadius: trackRadius }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** Bottom strip: small mono left + right meta. The horizontal separator is the
 *  global divider drawn by the composition (so it's present on EVERY video). */
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
      <span style={{ fontFamily: theme.fonts.mono, fontSize: 24, ...labelStyle(theme), letterSpacing: "0.12em", color: theme.colors.muted }}>
        {left}
      </span>
      {right ? (
        <span style={{ fontFamily: theme.fonts.mono, fontSize: 24, ...labelStyle(theme), letterSpacing: "0.1em", color: theme.colors.muted }}>
          {right}
        </span>
      ) : null}
    </div>
  );
};

/**
 * Vertical clearance kept between a `Story`'s content and the global
 * CaptionDivider (drawn at CONTENT_ZONE.bottom). Authored content must stay this
 * many px above the divider, so it reads as a deliberate beat above the line.
 */
const STORY_DIVIDER_CLEARANCE = 24;

/**
 * `Story` — full-frame editorial layout inside the content zone: a `HeaderBar`
 * pinned at the top, the main content centred in the middle, and an optional
 * `Footer` at the bottom of the content zone. The content zone is INVARIANT
 * across languages (same constant the divider + N14 oracles read), so only the
 * blocks Story holds change look — never where content sits.
 */
export const Story: React.FC<{
  eyebrow: string;
  label?: string;
  meta?: string;
  footer?: { left: string; right?: string };
  gap?: number;
  children: React.ReactNode;
}> = ({ eyebrow, label, meta, footer, gap = 28, children }) => {
  const tilt = useTilt();
  const insideZone = useInZone();
  const zone = CONTENT_ZONE;
  // Defensive nesting guard (same as Content): when a model wraps a Story inside
  // another full-zone wrapper (e.g. <Content><Story/></Content> or a doubled
  // Story), the inner one must NOT re-apply the absolute zone offset — that
  // double-counts (left+left, top+top) and shoves content toward the
  // bottom-right, out of the zone. Inside an existing zone we render IN-FLOW
  // (fill the parent) so the layout stays put; only the OUTERMOST zone wrapper
  // positions absolutely against the canvas.
  const positioning: React.CSSProperties = insideZone
    ? { width: "100%", height: "100%" }
    : { position: "absolute", top: zone.top, left: zone.left, width: rectWidth(zone), height: rectHeight(zone) };
  const body = (
    <div
      style={{
        ...positioning,
        boxSizing: "border-box",
        paddingBottom: STORY_DIVIDER_CLEARANCE,
        display: "flex",
        flexDirection: "column",
        gap,
      }}
    >
      <HeaderBar eyebrow={eyebrow} label={label} meta={meta} />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          justifyContent: "safe center",
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
  // The outermost zone wrapper marks the zone as occupied so any nested
  // Content/Story renders in-flow instead of re-offsetting.
  return insideZone ? body : <ZoneProvider>{body}</ZoneProvider>;
};
