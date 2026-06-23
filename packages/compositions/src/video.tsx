import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { TransitionSeries, springTiming } from "@remotion/transitions";
import { slide, type SlideDirection } from "@remotion/transitions/slide";
import { fade } from "@remotion/transitions/fade";
import { wipe } from "@remotion/transitions/wipe";
import { clockWipe } from "@remotion/transitions/clock-wipe";
import type { TransitionPresentation } from "@remotion/transitions";
import { CANVAS, CONTENT_ZONE, boundaryTransitionId, rectWidth, transitionFrames, type LockedSceneSpec, type LockedVideoSpec } from "@news/schema";
import { makeTheme, sceneBackground, type Theme } from "@news/theme";
import { Captions, LayoutProbe, SceneTimingProvider, useIntroZoom } from "@news/blocks";
import { getComponent, getTransition, type BoundarySceneInfo } from "./registry.js";
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
  const hasAuthoredTransitions = usesAuthoredBoundaryTimeline(scenes);
  return (
    <ThemeProvider theme={theme}>
      <CompositionBackdrop theme={theme}>
        {hasAuthoredTransitions ? <BoundaryTimeline scenes={scenes} transitionFrames={T} /> : <LegacyTransitionTimeline scenes={scenes} transitionFrames={T} />}

        {spec.audio.narrationSrc ? <Audio src={resolveAudio(spec.audio.narrationSrc)} /> : null}
        {/* Caption band + divider are a TikTok (9:16) concern only (freeform-engine
            D8): YouTube ships its own native captions, so a 16:9 video mounts
            neither the burned karaoke track nor the content/caption divider — it
            uses the full frame. `format` defaults to "tiktok" for any spec authored
            before the field existed, so vertical videos are unchanged. */}
        {spec.format !== "youtube" ? (
          <>
            <CaptionDivider color={theme.colors.fg} />
            <Captions cues={spec.captions ?? []} />
          </>
        ) : null}
        {measure ? <LayoutProbe /> : null}
      </CompositionBackdrop>
    </ThemeProvider>
  );
};

export function usesAuthoredBoundaryTimeline(scenes: readonly LockedSceneSpec[]): boolean {
  return scenes.some((scene, i) => {
    const next = scenes[i + 1];
    return next ? !!getTransition(boundaryTransitionId(scene.id, next.id)) : false;
  });
}

const LegacyTransitionTimeline: React.FC<{ scenes: LockedSceneSpec[]; transitionFrames: number }> = ({ scenes, transitionFrames }) => {
  const timing = springTiming({ config: { damping: 200, mass: 0.8, stiffness: 100 }, durationInFrames: transitionFrames });
  return (
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
  );
};

const BoundaryTimeline: React.FC<{ scenes: LockedSceneSpec[]; transitionFrames: number }> = ({ scenes, transitionFrames }) => {
  const frame = useCurrentFrame();
  return (
    <>
      {scenes.map((scene, i) => (
        <BaseSceneSequence
          key={scene.id}
          scene={scene}
          index={i}
          totalScenes={scenes.length}
          transitionFrames={transitionFrames}
          globalFrame={frame}
        />
      ))}
      {scenes.slice(0, -1).map((scene, i) => (
        <BoundaryTransitionSequence
          key={boundaryTransitionId(scene.id, scenes[i + 1]!.id)}
          fromScene={scene}
          toScene={scenes[i + 1]!}
          transitionFrames={transitionFrames}
        />
      ))}
    </>
  );
};

const BaseSceneSequence: React.FC<{
  scene: LockedSceneSpec;
  index: number;
  totalScenes: number;
  transitionFrames: number;
  globalFrame: number;
}> = ({ scene, index, totalScenes, transitionFrames, globalFrame }) => {
  const hidden = isBaseSceneHiddenAtFrame(scene, index, totalScenes, transitionFrames, globalFrame);
  if (hidden) return null;
  return (
    <Sequence from={scene.startFrame} durationInFrames={scene.durationInFrames} layout="absolute-fill">
      <SceneTimingProvider durationInFrames={scene.durationInFrames}>
        <SceneContent scene={scene} />
      </SceneTimingProvider>
    </Sequence>
  );
};

export function isBaseSceneHiddenAtFrame(
  scene: LockedSceneSpec,
  index: number,
  totalScenes: number,
  transitionFrames: number,
  globalFrame: number,
): boolean {
  return (
    (index > 0 && globalFrame >= scene.startFrame && globalFrame < scene.startFrame + transitionFrames) ||
    (index < totalScenes - 1 &&
      globalFrame >= scene.startFrame + scene.durationInFrames - transitionFrames &&
      globalFrame < scene.startFrame + scene.durationInFrames)
  );
}

const BoundaryTransitionSequence: React.FC<{
  fromScene: LockedSceneSpec;
  toScene: LockedSceneSpec;
  transitionFrames: number;
}> = ({ fromScene, toScene, transitionFrames }) => {
  if (transitionFrames <= 0) return null;
  const boundaryStart = toScene.startFrame;
  return (
    <Sequence from={boundaryStart} durationInFrames={transitionFrames} layout="absolute-fill">
      <BoundaryTransitionContent
        fromScene={fromScene}
        toScene={toScene}
        boundaryStart={boundaryStart}
        transitionFrames={transitionFrames}
      />
    </Sequence>
  );
};

const BoundaryTransitionContent: React.FC<{
  fromScene: LockedSceneSpec;
  toScene: LockedSceneSpec;
  boundaryStart: number;
  transitionFrames: number;
}> = ({ fromScene, toScene, boundaryStart, transitionFrames }) => {
  const localFrame = useCurrentFrame();
  const progress = transitionFrames <= 1 ? 1 : Math.min(1, Math.max(0, localFrame / (transitionFrames - 1)));
  const boundaryId = boundaryTransitionId(fromScene.id, toScene.id);
  const from = <SceneAtBoundaryFrame scene={fromScene} boundaryStart={boundaryStart} />;
  const to = <SceneAtBoundaryFrame scene={toScene} boundaryStart={boundaryStart} />;
  return (
    <BoundaryTransitionStage
      progress={progress}
      durationInFrames={transitionFrames}
      boundaryId={boundaryId}
      from={from}
      to={to}
      fromScene={sceneInfo(fromScene)}
      toScene={sceneInfo(toScene)}
    />
  );
};

export const BoundaryTransitionStage: React.FC<{
  progress: number;
  durationInFrames: number;
  boundaryId: string;
  from: React.ReactNode;
  to: React.ReactNode;
  fromScene: BoundarySceneInfo;
  toScene: BoundarySceneInfo;
}> = ({ progress, durationInFrames, boundaryId, from, to, fromScene, toScene }) => {
  const fallback = <FallbackBoundaryWipe progress={progress} from={from} to={to} />;
  if (progress <= 0) return <>{from}</>;
  if (progress >= 1) return <>{to}</>;
  const def = getTransition(boundaryId);
  if (!def) return fallback;
  return (
    <TransitionErrorBoundary fallback={fallback}>
      <def.Component
        progress={progress}
        durationInFrames={durationInFrames}
        boundaryId={boundaryId}
        from={from}
        to={to}
        fromScene={fromScene}
        toScene={toScene}
      />
    </TransitionErrorBoundary>
  );
};

const SceneAtBoundaryFrame: React.FC<{ scene: LockedSceneSpec; boundaryStart: number }> = ({ scene, boundaryStart }) => (
  <Sequence from={scene.startFrame - boundaryStart} durationInFrames={scene.durationInFrames} layout="absolute-fill">
    <SceneTimingProvider durationInFrames={scene.durationInFrames}>
      <SceneContent scene={scene} />
    </SceneTimingProvider>
  </Sequence>
);

export const FallbackBoundaryWipe: React.FC<{ progress: number; from: React.ReactNode; to: React.ReactNode }> = ({ progress, from, to }) => {
  const reveal = Math.min(100, Math.max(0, progress * 100));
  return (
    <AbsoluteFill style={{ background: "#050712", overflow: "hidden" }}>
      <AbsoluteFill>{from}</AbsoluteFill>
      <AbsoluteFill style={{ clipPath: "inset(0 " + (100 - reveal).toFixed(2) + "% 0 0)" }}>{to}</AbsoluteFill>
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: reveal + "%",
          width: 10,
          transform: "translateX(-5px)",
          background: "linear-gradient(180deg, rgba(255,255,255,0), rgba(255,255,255,0.85), rgba(255,255,255,0))",
          boxShadow: "0 0 36px rgba(255,255,255,0.55)",
        }}
      />
    </AbsoluteFill>
  );
};

function sceneInfo(scene: LockedSceneSpec): BoundarySceneInfo {
  return {
    id: scene.id,
    component: scene.component,
    headline: scene.headline,
    narration: scene.narration,
    props: scene.props ?? {},
    startFrame: scene.startFrame,
    durationInFrames: scene.durationInFrames,
    ...(scene.body !== undefined ? { body: scene.body } : {}),
    ...(scene.eyebrow !== undefined ? { eyebrow: scene.eyebrow } : {}),
  };
}

/**
 * The top-level background WASH (freeform-engine L2). The composition used to
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
 * Whether the LINE is painted is a per-language CHROME choice (`backdrop.divider`):
 * the editorial print look draws a solid rule; the galaxy look keeps the same
 * clearance but no visible bar (its content already floats over the night). The
 * N14 above/below-divider oracles scan `CONTENT_ZONE.bottom` UNCONDITIONALLY —
 * they enforce the clearance gap whether or not the line is drawn — so hiding the
 * bar changes only the pixels, never the layout rule authored content must obey.
 */
const CaptionDivider: React.FC<{ color: string }> = ({ color }) => {
  const theme = useTheme();
  // Chrome-only: a language may keep the clearance but not paint the bar.
  if (!theme.backdrop.divider) return null;
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
  const inner = scene.emphasis === "zoom" ? <SceneZoom>{content}</SceneZoom> : content;
  // Freeform pivot: a single authored scene that THROWS at render time (e.g. a
  // `.map` over an undefined prop) used to crash headless Chromium and take the
  // WHOLE video down with an opaque error. With the hard prop/typecheck gates
  // relaxed to warnings, that risk moves to render time — so each scene renders
  // inside its OWN boundary: a throwing scene shows a graceful fallback (its
  // headline on a safe layout) while every other scene still renders. The video
  // ALWAYS ships. The boundary is a pure function of its subtree (no state read
  // from outside render), so determinism (N16) is unaffected.
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

class TransitionErrorBoundary extends React.Component<
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
