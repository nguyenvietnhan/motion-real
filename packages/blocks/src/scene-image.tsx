import React from "react";
import { Img, staticFile } from "remotion";
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
 * SELF-FITTING (the block owns the image's size, not the author): the `<img>`
 * FILLS the content column width (`width:100%`) and lets its height follow the
 * image's TRUE aspect ratio (`height:auto`). The frame (border + radius) is drawn
 * ON the image element itself, so it HUGS the picture with NO empty side gaps —
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
 *
 * `data-nrt-block` tags the wrapper so the N15 layout probe can measure it.
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
  /** Vertical cap for the image in canvas px (keeps it inside the content zone). */
  maxHeight?: number;
  /**
   * Optional style for the OUTER centering wrapper (margins, alignment). The
   * image's own size + chrome are owned by the block and are NOT overridable —
   * passing `width/height:100%` here only affects the wrapper, never the image,
   * so an authored fixed box can't re-introduce letterboxing.
   */
  style?: React.CSSProperties;
}> = ({ imageRef, alt, maxHeight = 720, style }) => {
  const theme = useTheme();
  return (
    <div
      data-nrt-block="scene-image"
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
          // FILL the content column width; height follows the image's true aspect
          // ratio. This is the fix for the empty side gaps a `width:auto` intrinsic
          // layout caused (an 800px image floated in a ~1000px column, hairline-
          // framed, leaving a gap each side). `maxHeight` + `objectFit:contain`
          // only kick in for a rare very-tall portrait, letterboxing it WITHIN the
          // cap instead of pushing past the content zone.
          width: "100%",
          height: "auto",
          maxHeight,
          objectFit: "contain",
          border: `1px solid ${theme.surface.borderColor}`,
          borderRadius: theme.radius.md,
          // Neutral plate behind a transparent PNG so it sits on the panel
          // surface rather than showing the backdrop through it.
          backgroundColor: theme.colors.panel,
        }}
      />
    </div>
  );
};
