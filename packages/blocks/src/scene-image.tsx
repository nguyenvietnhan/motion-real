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
 * a remote URL — so re-renders stay offline and byte-stable (N16).
 *
 * SELF-FITTING (the block owns the image's size, not the author): the `<img>` is
 * laid out at its INTRINSIC aspect ratio, capped to the content column width
 * (`maxWidth:100%`) and a vertical cap (`maxHeight`), with `width/height:auto`.
 * The frame (border + radius) is drawn ON the image element itself, so it HUGS
 * the picture exactly — no letterbox gap around a portrait, no crop of a wide
 * chart. This is why authored scenes must NOT wrap it in a fixed-height /
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
          // Intrinsic sizing capped to the column width + a vertical limit, so
          // the image lays out at its TRUE aspect ratio and the frame hugs it.
          maxWidth: "100%",
          maxHeight,
          width: "auto",
          height: "auto",
          border: surfaceBorder(theme),
          borderRadius: surfaceRadius(theme, "md"),
          // A neutral plate behind a transparent PNG so it sits on the language's
          // panel surface rather than showing the backdrop through it.
          backgroundColor: theme.colors.panel,
        }}
      />
    </div>
  );
};
