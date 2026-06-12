import React from "react";
import { Img, staticFile } from "remotion";
import { useTheme } from "./theme-context.js";
import { surfaceBorder, surfaceRadius } from "./chrome.js";

/**
 * `SceneImage` — the ONE sanctioned way an authored scene shows an image. The
 * scene's first-class `image` field (≤1 per scene; see `SceneImageSchema`) flows
 * here; authored `.tsx` is BANNED from importing `Img`/`staticFile` directly
 * (admission N5), so every image on screen passes through this block and its
 * local-only ref guard.
 *
 * `imageRef` is a project-relative path to a LOCAL asset, resolved via Remotion
 * `staticFile()` against the project root (exactly like narration audio) — never
 * a remote URL — so re-renders stay offline and byte-stable (N16). The image is
 * fitted with `object-fit: contain` inside a bounded, bordered box so it never
 * crops the subject and stays inside the content zone (the N14 pixel oracle
 * still guards real overflow). Frame-pure: no time/random, so it's deterministic.
 *
 * Compose it inside `<Content>` (or a `Story`/`Panel`) like any other block. The
 * `data-nrt-block` tag lets the N15 layout probe measure it.
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
  /** Max height of the image box in canvas px (kept inside the content zone). */
  maxHeight?: number;
  style?: React.CSSProperties;
}> = ({ imageRef, alt, maxHeight = 720, style }) => {
  const theme = useTheme();
  return (
    <div
      data-nrt-block="scene-image"
      style={{
        width: "100%",
        maxHeight,
        border: surfaceBorder(theme),
        borderRadius: surfaceRadius(theme, "md"),
        background: theme.colors.panel,
        overflow: "hidden",
        display: "grid",
        placeItems: "center",
        ...style,
      }}
    >
      <Img
        src={staticFile(imageRef)}
        alt={alt}
        style={{
          width: "100%",
          height: "100%",
          maxHeight,
          objectFit: "contain",
          // A neutral plate behind the fitted image so a transparent/letterboxed
          // image sits on the language's panel surface, not a hard color.
          backgroundColor: theme.colors.panel,
        }}
      />
    </div>
  );
};
