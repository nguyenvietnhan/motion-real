import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import type { LockedSceneSpec, LockedVideoSpec } from "@news/schema";
import { theme } from "@news/design";
import { getComponent } from "./registry.js";

export type VideoCompositionProps = {
  spec: LockedVideoSpec;
};

/**
 * Master composition: lays each scene on the timeline by frame and plays the
 * single mixed narration track. Remotion handles audio/video sync at render
 * time, so the manual WAV pad/concat dance from the HyperFrames pipeline is
 * no longer required.
 */
export const VideoComposition: React.FC<VideoCompositionProps> = ({ spec }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: theme.colors.bg }}>
      {spec.scenes.map((scene) => {
        return (
          <Sequence
            key={scene.id}
            from={scene.startFrame}
            durationInFrames={scene.durationInFrames}
            name={`${scene.id} · ${scene.component}`}
          >
            <SceneContent scene={scene} />
          </Sequence>
        );
      })}

      {spec.audio.narrationSrc ? <Audio src={resolveAudio(spec.audio.narrationSrc)} /> : null}
    </AbsoluteFill>
  );
};

export const SceneContent: React.FC<{ scene: LockedSceneSpec }> = ({ scene }) => {
  const def = getComponent(scene.component);
  return def ? (
    <def.Component headline={scene.headline} body={scene.body} eyebrow={scene.eyebrow} props={scene.props} />
  ) : (
    <MissingComponent component={scene.component} sceneId={scene.id} />
  );
};

function resolveAudio(src: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  return staticFile(src);
}

export const MissingComponent: React.FC<{ component: string; sceneId: string }> = ({ component, sceneId }) => (
  <AbsoluteFill
    style={{
      backgroundColor: theme.colors.bg,
      color: theme.colors.danger,
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
