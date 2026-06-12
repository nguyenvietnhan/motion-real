import React from "react";
import { AbsoluteFill, Audio, interpolate, staticFile } from "remotion";
import { TransitionSeries, springTiming } from "@remotion/transitions";
import { slide, type SlideDirection } from "@remotion/transitions/slide";
import { fade } from "@remotion/transitions/fade";
import { wipe } from "@remotion/transitions/wipe";
import { clockWipe } from "@remotion/transitions/clock-wipe";
import type { TransitionPresentation } from "@remotion/transitions";
import { CANVAS, CONTENT_ZONE, rectWidth, transitionFrames, type LockedSceneSpec, type LockedVideoSpec } from "@news/schema";
import { makeTheme, type Theme } from "@news/design";
import { Captions, LayoutProbe, SceneTimingProvider, useIntroZoom } from "@news/blocks";
import { getComponent } from "./registry.js";
import { ThemeProvider, useTheme } from "./theme-context.js";

export type VideoCompositionProps = {
  spec: LockedVideoSpec;
  /**
   * When true, mount the layout probe that measures composed-block rects and
   * emits them as a JSON artifact (N15/N17). OFF for real renders, so production
   * pixels are byte-identical and the N16 determinism guard is unaffected.
   */
  measure?: boolean;
};

/**
 * A custom DETERMINISTIC zoom transition (DOM transform + opacity, no WebGL):
 * the entering scene eases in from a slight zoom-out while the exiting scene
 * pushes back. Used for emphasis beats (e.g. into a key stat).
 */
type ZoomProps = Record<string, never>;
const ZoomPresentationComponent: React.FC<{
  presentationProgress: number;
  presentationDirection: "entering" | "exiting";
  children: React.ReactNode;
}> = ({ presentationProgress, presentationDirection, children }) => {
  const entering = presentationDirection === "entering";
  const scale = entering
    ? interpolate(presentationProgress, [0, 1], [1.08, 1])
    : interpolate(presentationProgress, [0, 1], [1, 0.96]);
  const opacity = entering ? presentationProgress : 1 - presentationProgress;
  return <AbsoluteFill style={{ transform: `scale(${scale})`, opacity }}>{children}</AbsoluteFill>;
};
function zoomPush(): TransitionPresentation<ZoomProps> {
  return { component: ZoomPresentationComponent, props: {} } as unknown as TransitionPresentation<ZoomProps>;
}

/** Map a scene's `transitionToNext` to a deterministic presentation (DOM, no GL). */
function presentationFor(
  kind: LockedSceneSpec["transitionToNext"],
  index: number,
): TransitionPresentation<Record<string, unknown>> {
  const cast = (p: unknown) => p as TransitionPresentation<Record<string, unknown>>;
  switch (kind) {
    case "fade":
      return cast(fade());
    case "wipe": {
      const dirs: Array<"from-left" | "from-right"> = ["from-left", "from-right"];
      return cast(wipe({ direction: dirs[index % dirs.length]! }));
    }
    case "clockWipe":
      return cast(clockWipe({ width: CANVAS.width, height: CANVAS.height }));
    case "zoom":
      return cast(zoomPush());
    case "slide":
    default: {
      // Alternate the slide direction for visual variety (mostly horizontal).
      const dirs: SlideDirection[] = ["from-right", "from-left", "from-bottom", "from-left"];
      return cast(slide({ direction: dirs[index % dirs.length]! }));
    }
  }
}

/**
 * Master composition. Scenes are laid out with `TransitionSeries` so adjacent
 * scenes transition instead of hard-cutting; the locked timing sizes each
 * sequence so the transition overlap lands on the silent breath gap and no
 * speech is clipped (author-mode-v2 R3/R5). Transitions use `springTiming`
 * (smooth, premium) pinned to the lock's overlap length, with per-scene
 * presentations (slide/fade/wipe/clockWipe/zoom) for variety. The narration is
 * ONE continuous top-level `<Audio>`, and the burned-in karaoke captions are a
 * top-level `<Captions>` overlay — both OUTSIDE the transition series.
 */
export const VideoComposition: React.FC<VideoCompositionProps> = ({ spec, measure }) => {
  const theme = makeTheme(spec.theme?.dominant, spec.theme?.stylePackId);
  const scenes = spec.scenes;
  const T = transitionFrames(spec.fps);
  const timing = springTiming({ config: { damping: 200, mass: 0.8, stiffness: 100 }, durationInFrames: T });
  return (
    <ThemeProvider theme={theme}>
      <AbsoluteFill style={{ backgroundColor: theme.colors.bg }}>
        <TransitionSeries>
          {scenes.map((scene, i) => {
            const isLast = i === scenes.length - 1;
            return (
              <React.Fragment key={scene.id}>
                <TransitionSeries.Sequence durationInFrames={scene.durationInFrames}>
                  <SceneTimingProvider durationInFrames={scene.durationInFrames}>
                    <SceneContent scene={scene} />
                  </SceneTimingProvider>
                </TransitionSeries.Sequence>
                {!isLast ? (
                  <TransitionSeries.Transition
                    timing={timing}
                    presentation={presentationFor(scene.transitionToNext, i)}
                  />
                ) : null}
              </React.Fragment>
            );
          })}
        </TransitionSeries>

        {spec.audio.narrationSrc ? <Audio src={resolveAudio(spec.audio.narrationSrc)} /> : null}
        <CaptionDivider color={theme.colors.fg} />
        <Captions cues={spec.captions ?? []} />
        {measure ? <LayoutProbe /> : null}
      </AbsoluteFill>
    </ThemeProvider>
  );
};

/**
 * Always-present horizontal divider at the content-zone bottom — the editorial
 * baseline that separates authored content from the burned-in caption band.
 * Rendered globally by the composition (not per scene), so it appears on EVERY
 * video regardless of what the authored scenes draw, and marks the line authored
 * content must stay above (enforced by the N14 caption-clearance oracle).
 */
const CaptionDivider: React.FC<{ color: string }> = ({ color }) => {
  // Drawn at the ONE shared content-zone bottom — the SAME constant the N14
  // above/below-divider oracles scan, so the divider is drawn exactly where the
  // oracles expect, never a drifting hard-coded y.
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          top: CONTENT_ZONE.bottom,
          left: CONTENT_ZONE.left,
          width: rectWidth(CONTENT_ZONE),
          height: 4,
          background: color,
        }}
      />
    </AbsoluteFill>
  );
};

export const SceneContent: React.FC<{ scene: LockedSceneSpec }> = ({ scene }) => {
  const def = getComponent(scene.component);
  const content = def ? (
    <def.Component headline={scene.headline} body={scene.body} eyebrow={scene.eyebrow} props={scene.props} image={scene.image} />
  ) : (
    <MissingComponent component={scene.component} sceneId={scene.id} />
  );
  // AI-chosen, per-scene emphasis: a whole-scene punch-in zoom that settles to
  // 1.0 before the midpoint (so it's a deliberate spotlight, not an N14 risk).
  return scene.emphasis === "zoom" ? <SceneZoom>{content}</SceneZoom> : content;
};

/** Whole-scene punch-in zoom (settles), used for scenes the AI flags emphasis:"zoom". */
const SceneZoom: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const z = useIntroZoom(1.085, 0.62);
  return <AbsoluteFill style={{ transform: `scale(${z.toFixed(4)})`, transformOrigin: "center center" }}>{children}</AbsoluteFill>;
};

function resolveAudio(src: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  return staticFile(src);
}

export const MissingComponent: React.FC<{ component: string; sceneId: string }> = ({ component, sceneId }) => {
  const theme: Theme = useTheme();
  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.colors.bg,
        color: "#FF827A",
        display: "grid",
        placeItems: "center",
        fontFamily: theme.fonts.mono,
        fontSize: 40,
        padding: 80,
        textAlign: "center",
      }}
    >
      {sceneId}: unknown component "{component}"
    </AbsoluteFill>
  );
};
