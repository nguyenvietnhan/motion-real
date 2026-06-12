import React from "react";
import { onColor, type Theme } from "@news/design";
import { useTheme } from "./theme-context.js";
import { useReveal } from "./motion.js";
import { blockSurface, topRuleStyle, chipStyle, surfaceRadius, surfaceBorderWidth } from "./chrome.js";

/**
 * Text blocks — `TitleBlock`, `IdeaPanel`, `Callout`. Every visual decision
 * (border, radius, fill, shadow, top-rule, chip style) reads from the resolved
 * language's tokens via the surface-kit, so the SAME block renders the editorial
 * print look, the galaxy dark look, or any future language — never a hard-coded
 * `4px solid ink` / squared corner / accent drop. Layout + type scale stay here
 * (they're invariant); only the surface grammar comes from the theme.
 */

/** Pick a tone color off the theme (accent default; emphasis ⇒ signal). */
function emphasisColor(theme: Theme, emphasis?: boolean): string {
  return emphasis ? theme.colors.signal : theme.colors.accent;
}

/**
 * `TitleBlock` — a FRAMED headline card. The frame treatment (border/radius/
 * shadow) and the optional accent top-rule are language-driven: editorial draws a
 * bold squared border + solid top-rule + hard offset; galaxy draws a rounded
 * glassy card + glow and no top-rule.
 */
export const TitleBlock: React.FC<{ headline: string; kicker?: string; body?: string }> = ({ headline, body }) => {
  const theme = useTheme();
  const r = useReveal(2);
  const headlineSize = headline.length > 42 ? 76 : headline.length > 24 ? 92 : 108;
  const rule = topRuleStyle(theme, theme.colors.accent);
  return (
    <div
      data-nrt-block="title"
      style={{
        ...blockSurface(theme, { accent: theme.colors.accent, size: "lg" }),
        opacity: r,
        transform: `translateY(${(1 - r) * 22}px)`,
        overflow: "hidden", // keep the top-rule + content inside rounded corners
      }}
    >
      {rule ? <div style={rule} /> : null}
      <div style={{ padding: "38px 42px", display: "grid", gap: 18 }}>
        <h1
          style={{
            margin: 0,
            fontFamily: theme.fonts.display,
            fontWeight: 900,
            fontSize: headlineSize,
            lineHeight: 1.04,
            letterSpacing: "-0.02em",
            color: theme.colors.fg,
            // Long single words (URLs, model names) wrap instead of overflowing
            // the card's right edge — the truncation defect the N17 oracle exists
            // to catch. Layout-level guard so it never reaches a render.
            overflowWrap: "anywhere",
          }}
        >
          {headline}
        </h1>
        {body ? <p style={{ margin: 0, color: theme.colors.muted, fontSize: 40, lineHeight: 1.32, overflowWrap: "anywhere" }}>{body}</p> : null}
      </div>
    </div>
  );
};

/** `IdeaPanel` — a titled, framed panel for a key idea. Surface + chip are language-driven. */
export const IdeaPanel: React.FC<{ title?: string; children: React.ReactNode; emphasis?: boolean }> = ({
  title,
  children,
  emphasis,
}) => {
  const theme = useTheme();
  const r = useReveal(6);
  const c = emphasisColor(theme, emphasis);
  const rule = topRuleStyle(theme, c);
  return (
    <div
      data-nrt-block="idea"
      style={{
        ...blockSurface(theme, { accent: c, size: "md" }),
        opacity: r,
        transform: `translateY(${(1 - r) * 18}px)`,
        overflow: "hidden",
      }}
    >
      {rule ? <div style={{ ...rule, height: 10 }} /> : null}
      <div style={{ padding: "32px 36px", display: "grid", gap: 16 }}>
        {title ? (
          <span
            style={{
              alignSelf: "start",
              fontFamily: theme.fonts.mono,
              fontWeight: 800,
              fontSize: 24,
              letterSpacing: theme.surface.labelTracking,
              textTransform: theme.surface.labelUppercase ? "uppercase" : "none",
              padding: "6px 14px",
              ...chipStyle(theme, c, onColor),
            }}
          >
            {title}
          </span>
        ) : null}
        <div style={{ fontSize: 44, lineHeight: 1.3, color: theme.colors.fg, overflowWrap: "anywhere" }}>{children}</div>
      </div>
    </div>
  );
};

/** `Callout` — a sharp statement with a thick accent left bar. Surface is language-driven. */
export const Callout: React.FC<{
  children: React.ReactNode;
  tone?: "accent" | "signal" | "danger";
}> = ({ children, tone = "accent" }) => {
  const theme = useTheme();
  const r = useReveal(4);
  const color = tone === "danger" ? theme.colors.red : tone === "signal" ? theme.colors.signal : theme.colors.accent;
  const radius = surfaceRadius(theme, "md");
  const barWidth = Math.max(12, surfaceBorderWidth(theme) * 4 || 18);
  return (
    <div
      data-nrt-block="callout"
      style={{
        ...blockSurface(theme, { accent: color, size: "md" }),
        borderLeft: `${barWidth}px solid ${color}`,
        // A rounded language keeps the left bar tucked inside the corner.
        borderTopLeftRadius: radius,
        borderBottomLeftRadius: radius,
        padding: "28px 36px",
        fontSize: 48,
        fontWeight: 800,
        lineHeight: 1.24,
        color: theme.colors.fg,
        opacity: r,
        transform: `translateX(${(1 - r) * -22}px)`,
        overflowWrap: "anywhere",
      }}
    >
      {children}
    </div>
  );
};
