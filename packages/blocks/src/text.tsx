import React from "react";
import { withAlpha, onColor, PRINT } from "@news/design";
import { useTheme } from "./theme-context.js";
import { useReveal } from "./motion.js";

/**
 * `TitleBlock` — a FRAMED headline card (editorial print look): bold ink border,
 * near-white panel, a solid accent top rule, an offset accent shadow, animated
 * in with a spring. NOT a bare big-headline-top-left + subtitle.
 */
export const TitleBlock: React.FC<{ headline: string; kicker?: string; body?: string }> = ({ headline, body }) => {
  const theme = useTheme();
  const r = useReveal(2);
  const headlineSize = headline.length > 42 ? 76 : headline.length > 24 ? 92 : 108;
  return (
    <div
      style={{
        border: `4px solid ${PRINT.ink}`,
        background: theme.colors.panel,
        boxShadow: `12px 12px 0 ${theme.colors.accent}`,
        opacity: r,
        transform: `translateY(${(1 - r) * 22}px)`,
      }}
    >
      <div style={{ height: 14, background: theme.colors.accent, borderBottom: `4px solid ${PRINT.ink}` }} />
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
          }}
        >
          {headline}
        </h1>
        {body ? <p style={{ margin: 0, color: theme.colors.muted, fontSize: 40, lineHeight: 1.32 }}>{body}</p> : null}
      </div>
    </div>
  );
};

/** `IdeaPanel` — a titled, framed panel for a key idea (bold border + accent rule). */
export const IdeaPanel: React.FC<{ title?: string; children: React.ReactNode; emphasis?: boolean }> = ({
  title,
  children,
  emphasis,
}) => {
  const theme = useTheme();
  const r = useReveal(6);
  const c = emphasis ? theme.colors.signal : theme.colors.accent;
  return (
    <div
      style={{
        border: `4px solid ${PRINT.ink}`,
        background: theme.colors.panel,
        boxShadow: `10px 10px 0 ${withAlpha(c, 0.9)}`,
        opacity: r,
        transform: `translateY(${(1 - r) * 18}px)`,
      }}
    >
      <div style={{ height: 10, background: c, borderBottom: `4px solid ${PRINT.ink}` }} />
      <div style={{ padding: "32px 36px", display: "grid", gap: 16 }}>
        {title ? (
          <span
            style={{
              alignSelf: "start",
              fontFamily: theme.fonts.mono,
              fontWeight: 800,
              fontSize: 24,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              background: c,
              color: onColor(c),
              padding: "6px 14px",
              border: `3px solid ${PRINT.ink}`,
            }}
          >
            {title}
          </span>
        ) : null}
        <div style={{ fontSize: 44, lineHeight: 1.3, color: theme.colors.fg }}>{children}</div>
      </div>
    </div>
  );
};

/** `Callout` — a sharp statement with a thick accent left bar on a tinted panel. */
export const Callout: React.FC<{
  children: React.ReactNode;
  tone?: "accent" | "signal" | "danger";
}> = ({ children, tone = "accent" }) => {
  const theme = useTheme();
  const r = useReveal(4);
  const color = tone === "danger" ? PRINT.red : tone === "signal" ? theme.colors.signal : theme.colors.accent;
  return (
    <div
      style={{
        border: `4px solid ${PRINT.ink}`,
        borderLeft: `18px solid ${color}`,
        background: theme.colors.panel,
        padding: "28px 36px",
        fontSize: 48,
        fontWeight: 800,
        lineHeight: 1.24,
        color: theme.colors.fg,
        opacity: r,
        transform: `translateX(${(1 - r) * -22}px)`,
      }}
    >
      {children}
    </div>
  );
};
