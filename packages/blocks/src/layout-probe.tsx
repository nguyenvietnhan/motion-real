import React, { useEffect, useState } from "react";
import { AbsoluteFill, Artifact, continueRender, delayRender } from "remotion";

/**
 * Deterministic layout measurement (N15/N17 hardening).
 *
 * Pure-AUTHOR scenes draw free SVG/CSS, so the deterministic render grid can
 * only sample PIXELS — it can't see that two layout blocks OVERLAP or that a
 * block's text is CLIPPED, because a flat raster carries no layout boxes. The
 * vision-QA pass can, but it's model-dependent and unreliable.
 *
 * Instead we measure the real DOM at render time. Every COMPOSED `@motionreal/blocks`
 * unit tags its outer boundary with `NRT_BLOCK_ATTR`; the `LayoutProbe` reads
 * each tagged element's `getBoundingClientRect` once layout settles and emits
 * them as a JSON Remotion `<Artifact>`. The renderer feeds those rects to the
 * already-written N15 (overlap among sibling blocks) and N17 (per-block edge
 * clipping) oracles — vision-independent, deterministic.
 *
 * This only renders inside the dedicated MEASURE composition; the production
 * video render never mounts it, so production pixels are byte-identical and the
 * N16 determinism guard is unaffected.
 */

/** Data attribute marking a composed block's outer boundary, read by the probe. */
export const NRT_BLOCK_ATTR = "data-nrt-block";

/** Artifact filename the probe emits its measured rects to (one per still). */
export const LAYOUT_ARTIFACT_NAME = "layout.json";

/** A measured block boundary in canvas pixels (matches the oracle `Rect` shape). */
export type MeasuredBlock = { kind: string; x: number; y: number; width: number; height: number };

/** The probe artifact payload: every tagged block visible in the measured frame. */
export type LayoutMeasurement = { blocks: MeasuredBlock[] };

/**
 * Read every `[data-nrt-block]` rect after layout and emit them as one JSON
 * artifact. Mount it LAST inside the measure composition so it runs after the
 * scene tree has laid out. `delayRender` holds the frame until the measurement
 * is captured; a failure continues the render with an empty measurement rather
 * than hanging (the oracles then simply find nothing to flag).
 */
export const LayoutProbe: React.FC = () => {
  const [handle] = useState(() => delayRender("nrt-layout-probe"));
  const [measurement, setMeasurement] = useState<LayoutMeasurement | null>(null);

  // First: measure the laid-out DOM (after layout settles) and stash the result.
  // This triggers a re-render that mounts the <Artifact> below.
  useEffect(() => {
    try {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(`[${NRT_BLOCK_ATTR}]`));
      const blocks: MeasuredBlock[] = nodes.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          kind: el.getAttribute(NRT_BLOCK_ATTR) || "block",
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
        };
      });
      setMeasurement({ blocks });
    } catch {
      setMeasurement({ blocks: [] });
    }
  }, []);

  // Then: only AFTER the measurement is set (so <Artifact> has rendered and
  // registered its asset via its own layout effect) do we release the frame.
  // Releasing inside the measure effect — before <Artifact> mounts — would let
  // Remotion finalize the frame with the asset not yet registered (empty output).
  useEffect(() => {
    if (measurement) continueRender(handle);
  }, [measurement, handle]);

  if (!measurement) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <Artifact filename={LAYOUT_ARTIFACT_NAME} content={JSON.stringify(measurement)} />
    </AbsoluteFill>
  );
};
