import type { LockedVideoSpec } from "@motionreal/schema";

/**
 * SFX cue mapping (design B.5). Mirrors math_video_tool's
 * self.sfx("whoosh"/"thud"/"ting"/"success"). Pure + deterministic: given a
 * locked spec it returns where each cue would play. This is a reserved/internal
 * metadata helper for future audio mixing, not a default render-stage feature;
 * a scene with sfx "none" yields no cue.
 */

export type SfxTag = NonNullable<LockedVideoSpec["scenes"][number]["sfx"]>;

export type SfxCue = {
  sceneId: string;
  /** absolute frame in the timeline where the cue starts */
  atFrame: number;
  /** asset basename under assets/sfx (without extension) */
  asset: "swoosh" | "thud" | "ting" | "success";
  /** mix gain (0..1), kept low so cues sit under the voice */
  volume: number;
};

/** Map an sfx tag to a cue asset + default gain, or null for "none". */
export function sfxAsset(tag: SfxTag | undefined): { asset: SfxCue["asset"]; volume: number } | null {
  switch (tag) {
    case "transition":
      return { asset: "swoosh", volume: 0.18 };
    case "alert":
      return { asset: "thud", volume: 0.22 };
    case "emphasis":
      return { asset: "ting", volume: 0.2 };
    case "success":
      return { asset: "success", volume: 0.22 };
    case "none":
    case undefined:
    default:
      return null;
  }
}

/**
 * Compute cue placements for a locked spec. Most cues fire at the scene start;
 * `success` fires slightly before the scene end to land on the resolution.
 */
export function getSfxCues(locked: LockedVideoSpec): SfxCue[] {
  const cues: SfxCue[] = [];
  const fps = locked.fps;
  for (const scene of locked.scenes) {
    const mapping = sfxAsset(scene.sfx);
    if (!mapping) continue;
    let atFrame = scene.startFrame;
    if (mapping.asset === "success") {
      // land ~0.6s before the scene ends, but never before its start
      atFrame = Math.max(scene.startFrame, scene.startFrame + scene.durationInFrames - Math.round(0.6 * fps));
    }
    cues.push({ sceneId: scene.id, atFrame, asset: mapping.asset, volume: mapping.volume });
  }
  return cues;
}
