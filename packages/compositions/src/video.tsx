import React from "react";
import { AbsoluteFill, Audio, interpolate, staticFile } from "remotion";
import { TransitionSeries, springTiming } from "@remotion/transitions";
import { slide, type SlideDirection } from "@remotion/transitions/slide";
import { fade } from "@remotion/transitions/fade";
import { wipe } from "@remotion/transitions/wipe";
import { clockWipe } from "@remotion/transitions/clock-wipe";
import type { TransitionPresentation } from "@remotion/transitions";
import { CANVAS, CONTENT_ZONE, rectWidth, transitionFrames, type LockedSceneSpec, type LockedVideoSpec } from "@motionreal/schema";
import { makeTheme, sceneBackground, type Theme } from "@motionreal/theme";
import { Captions, LayoutProbe, SceneTimingProvider, useIntroZoom } from "@motionreal/blocks";
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
  /**
   * Render authored scenes without the per-scene fallback boundary. Used only by
   * the pre-render runtime probe so a crashing scene surfaces as a targeted
   * pipeline error; normal/draft renders keep the fallback for graceful pixels.
   */
  strictSceneErrors?: boolean;
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
  // Fade-to-background: exiting scene fades out in first half, entering fades in in second half.
  const opacity = entering
    ? (presentationProgress < 0.5 ? 0 : (presentationProgress - 0.5) * 2)
    : (presentationProgress < 0.5 ? 1 - presentationProgress * 2 : 0);
  return <AbsoluteFill style={{ transform: `scale(${scale})`, opacity }}>{children}</AbsoluteFill>;
};
function zoomPush(): TransitionPresentation<ZoomProps> {
  return { component: ZoomPresentationComponent, props: {} } as unknown as TransitionPresentation<ZoomProps>;
}

const FadePresentationComponent: React.FC<{
  presentationProgress: number;
  presentationDirection: "entering" | "exiting";
  children: React.ReactNode;
}> = ({ presentationProgress, presentationDirection, children }) => {
  const entering = presentationDirection === "entering";
  // Fade-to-background: exiting scene fades out in first half, entering fades in in second half.
  const opacity = entering
    ? (presentationProgress < 0.5 ? 0 : (presentationProgress - 0.5) * 2)
    : (presentationProgress < 0.5 ? 1 - presentationProgress * 2 : 0);
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};
function fadeToDb(): TransitionPresentation<Record<string, never>> {
  return { component: FadePresentationComponent, props: {} } as unknown as TransitionPresentation<Record<string, never>>;
}

/** Map a scene's `transitionToNext` to a deterministic presentation (DOM, no GL). */
function presentationFor(
  kind: LockedSceneSpec["transitionToNext"],
  index: number,
): TransitionPresentation<Record<string, unknown>> {
  const cast = (p: unknown) => p as TransitionPresentation<Record<string, unknown>>;
  switch (kind) {
    case "fade":
      return cast(fadeToDb());
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
 * speech is clipped. Transitions use `springTiming`
 * (smooth, premium) pinned to the lock's overlap length, with per-scene
 * presentations (slide/fade/wipe/clockWipe/zoom) for variety. The narration is
 * ONE continuous top-level `<Audio>`, and the burned-in karaoke captions are a
 * top-level `<Captions>` overlay — both OUTSIDE the transition series.
 */
export const VideoComposition: React.FC<VideoCompositionProps> = ({ spec, measure, strictSceneErrors }) => {
  const theme = makeTheme(spec.theme?.dominant);
  const scenes = spec.scenes;
  const T = transitionFrames(spec.fps);
  const timing = springTiming({
    config: { damping: 200, mass: 0.8, stiffness: 100 },
    durationInFrames: T,
    durationRestThreshold: 0.001,
  });
  return (
    <ThemeProvider theme={theme}>
      <CompositionBackdrop theme={theme}>
        <TransitionSeries>
          {scenes.map((scene, i) => {
            const isLast = i === scenes.length - 1;
            return (
              <React.Fragment key={scene.id}>
                <TransitionSeries.Sequence durationInFrames={scene.durationInFrames}>
                  <SceneTimingProvider durationInFrames={scene.durationInFrames}>
                    <SceneContent scene={scene} strictSceneErrors={strictSceneErrors} />
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
        {/* Short-form 9:16 always burns captions + content divider. */}
        <CaptionDivider color={theme.colors.fg} />
        <Captions cues={spec.captions ?? []} />
        {measure ? <LayoutProbe /> : null}
      </CompositionBackdrop>
    </ThemeProvider>
  );
};

/**
 * The top-level background WASH. The composition used to
 * paint a flat near-black `colors.bg`, which looked dead on both formats; this
 * paints the theme's radial-gradient wash instead. Extracted as its own pure
 * component (single responsibility) so it can be tested without a Remotion
 * video-config context — the master composition mounts `TransitionSeries`, which
 * needs that context, but the backdrop itself is just a styled `AbsoluteFill`.
 * An authored scene that draws its own full-bleed background still paints over
 * this, so the wash only shows through transparent/letterboxed areas.
 */
export const CompositionBackdrop: React.FC<{ theme: Theme; children: React.ReactNode }> = ({ theme, children }) => {
  return <AbsoluteFill style={{ background: sceneBackground(theme) }}>{children}</AbsoluteFill>;
};

/**
 * Horizontal divider at the content-zone bottom — the editorial baseline that
 * separates authored content from the burned-in caption band. Rendered globally
 * by the composition (not per scene), so when a language draws it, it appears on
 * EVERY video regardless of what the authored scenes draw.
 *
 * Whether the LINE is painted is a per-language CHROME choice (`backdrop.divider`).
 * The current production theme turns it off. The old above-divider N14 oracle is
 * now opt-in/manual, so this toggle is paint only and must not imply a production
 * gate by itself.
 */
const CaptionDivider: React.FC<{ color: string }> = ({ color }) => {
  const theme = useTheme();
  // Chrome-only: a language may keep the clearance but not paint the bar.
  if (!theme.backdrop.divider) return null;
  // Drawn at the ONE shared content-zone bottom, never a drifting hard-coded y.
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

export const SceneContent: React.FC<{ scene: LockedSceneSpec; strictSceneErrors?: boolean }> = ({ scene, strictSceneErrors }) => {
  const def = getComponent(scene.component);
  const content = def ? (
    <def.Component
      headline={scene.headline}
      body={scene.body}
      eyebrow={scene.eyebrow}
      durationInFrames={scene.durationInFrames}
      props={scene.props}
      image={scene.image}
    />
  ) : (
    <MissingComponent component={scene.component} sceneId={scene.id} />
  );
  // AI-chosen, per-scene emphasis: a whole-scene punch-in zoom that settles to
  // 1.0 before the midpoint (so it's a deliberate spotlight, not an N14 risk).
  const inner = scene.emphasis === "zoom" ? <SceneZoom>{content}</SceneZoom> : content;
  if (strictSceneErrors) return <>{inner}</>;

  // Freeform pivot: a single authored scene that THROWS at render time (e.g. a
  // `.map` over an undefined prop) used to crash headless Chromium and take the
  // WHOLE video down with an opaque error. With the hard prop/typecheck gates
  // relaxed to warnings, that risk moves to render time — so each scene renders
  // inside its OWN boundary: a throwing scene shows a graceful fallback (its
  // headline on a safe layout) while every other scene still renders. The video
  // ALWAYS ships. The pre-render runtime probe flips `strictSceneErrors` so the
  // pipeline still catches and targets the authored crash instead of accepting a
  // fallback-clean render. The boundary is a pure function of its subtree (no
  // state read from outside render), so determinism (N16) is unaffected.
  return (
    <SceneErrorBoundary fallback={<SceneFallback headline={scene.headline} eyebrow={scene.eyebrow} />}>
      {inner}
    </SceneErrorBoundary>
  );
};

/**
 * Per-scene render boundary (freeform pivot). Catches a runtime throw from ONE
 * authored scene so it can't crash the whole render; renders `fallback` instead.
 * Deterministic: `getDerivedStateFromError` is a pure transform of the caught
 * error into `{ failed: true }`, so the same broken scene always yields the same
 * fallback pixels (no time/random/network), keeping the N16 guard valid.
 */
class SceneErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  constructor(props: { fallback: React.ReactNode; children: React.ReactNode }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  render(): React.ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Graceful fallback for a scene that threw: the headline + eyebrow centered on
 * the language's base surface, inside the safe content zone. The video keeps a
 * readable beat for that scene instead of a blank frame or a dead render.
 */
const SceneFallback: React.FC<{ headline: string; eyebrow?: string }> = ({ headline, eyebrow }) => {
  const theme: Theme = useTheme();
  return (
    <AbsoluteFill
      style={{
        backgroundColor: theme.colors.bg,
        color: theme.colors.fg,
        display: "flex",
        flexDirection: "column",
        gap: 24,
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        padding: 96,
        paddingBottom: CANVAS.height - CONTENT_ZONE.bottom + 48,
      }}
    >
      {eyebrow ? (
        <div style={{ fontFamily: theme.fonts.mono, fontSize: 28, color: theme.colors.muted, letterSpacing: "0.12em" }}>
          {eyebrow}
        </div>
      ) : null}
      <div style={{ fontFamily: theme.fonts.display, fontSize: 72, fontWeight: 800, lineHeight: 1.1 }}>{headline}</div>
    </AbsoluteFill>
  );
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
