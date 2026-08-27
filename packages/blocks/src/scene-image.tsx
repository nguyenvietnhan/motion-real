import React from "react";
import { Img, staticFile } from "remotion";
import type { SceneImageRole } from "@motionreal/schema";
import { useTheme } from "./theme-context.js";

/**
 * `SceneImage` — the ONE sanctioned way an authored scene shows an image. The
 * scene's first-class `image` field (≤1 per scene; see `SceneImageSchema`) flows
 * here; authored `.tsx` is BANNED from importing `Img`/`staticFile` directly
 * (admission N5), so every image on screen passes through this block and its
 * local-only ref guard.
 *
 * `imageRef` is a project-relative path to a LOCAL asset, resolved via Remotion
 * `staticFile` against the project root (exactly like narration audio) — never
 * a remote URL — so re-renders stay offline and byte-stable (N16).
 *
 * SELF-FITTING (the block owns the image's size, not the author): hero media
 * fills the content column, support media is slightly inset, and logo/icon
 * media stays compact. Height always follows the image's TRUE aspect ratio.
 * Photo chrome is drawn ON hero/support images so it HUGS the picture —
 * the bug a `width:auto` intrinsic layout caused (a 800px image floating in a
 * 1000px column left a gap each side). Crawled article images are almost always
 * landscape/square so the height stays modest; `maxHeight` + an `object-fit`
 * fallback guard only the rare very-tall portrait (it letterboxes within the cap
 * instead of pushing past the content zone). This is why authored scenes must
 * NOT wrap it in a fixed-height /
 * overflow:hidden box: the model can't know an asset's aspect ratio, so any box
 * it guesses either letterboxes (contain) or crops (cover). Here the image
 * decides its own shape and the chrome follows. Pure CSS intrinsic sizing — no
 * runtime measurement, so it stays deterministic (N16) and SSR-safe.
 */
export const SceneImage: React.FC<{
  /**
   * Project-relative local asset path, e.g. "assets/<sha>.png". Named
   * `imageRef` (NOT `ref`) because React reserves `ref` — a `ref` prop would be
   * intercepted by React and never reach this component.
   */
  imageRef: string;
  /** Accessibility/review alt text (not rendered as an on-screen caption). */
  alt?: string;
  /** Hero/support media fills the visual field; logos/icons stay compact. */
  role?: SceneImageRole;
  /** Vertical cap for the image in canvas px (keeps it inside the content zone). */
  maxHeight?: number;
  /**
   * Optional style for the OUTER centering wrapper (margins, alignment). The
   * image's own size + chrome are owned by the block and are NOT overridable —
   * passing `width/height:100%` here only affects the wrapper, never the image,
   * so an authored fixed box can't re-introduce letterboxing.
   */
  style?: React.CSSProperties;
}> = ({ imageRef, alt, role = "hero", maxHeight = 720, style }) => {
  const theme = useTheme();
  const compact = role === "logo" || role === "icon";
  const width = role === "hero" ? "100%" : role === "support" ? "86%" : "auto";
  const compactMaxWidth = role === "icon" ? 180 : 420;
  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        ...style,
      }}
    >
      <Img
        src={staticFile(imageRef)}
        alt={alt}
        style={{
          display: "block",
          // Hero/support media uses the visual field; compact transparent brand
          // marks keep their intrinsic aspect without photo chrome.
          width,
          height: "auto",
          maxWidth: compact ? compactMaxWidth : undefined,
          maxHeight: compact ? Math.min(maxHeight, compactMaxWidth) : maxHeight,
          objectFit: "contain",
          border: compact ? "none" : `1px solid ${theme.surface.borderColor}`,
          borderRadius: compact ? 0 : theme.radius.md,
          // Neutral plate behind a transparent PNG so it sits on the panel
          // surface rather than showing the backdrop through it.
          backgroundColor: compact ? "transparent" : theme.colors.panel,
        }}
      />
    </div>
  );
};
