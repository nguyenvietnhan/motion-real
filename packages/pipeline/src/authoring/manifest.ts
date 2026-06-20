import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VideoSpecSchema, normalizeVideoLanguage, type DurationTier, type LegacyTitleLanguage, type SceneImage, type VideoFormat, type VideoLanguage, type VideoSpec } from "@news/schema";
import type { SafetyIssue } from "../types.js";
import { ensureProject, projectPaths, readJson, writeJson } from "../store/store.js";
import { admitAuthoredSceneFile } from "./register.js";

/**
 * Per-project manifest (author-mode-v2 R8/R10). A manifest is the AUTHOR-mode
 * replacement for the PICK planner output: it lists the project's theme and its
 * ordered scenes, each referencing an AI-AUTHORED component id (defined by a
 * `.tsx` in the project's `authored/` dir) plus its props + narration. The
 * manifest converts to a `VideoSpec` for the existing safety/lock/render path.
 */

export type ManifestScene = {
  /** Sequential scene-NN id. */
  id: string;
  /** Authored component id (must be registered via admission before render). */
  component: string;
  /** Free-form props validated by the authored component's own Zod schema. */
  props?: Record<string, unknown>;
  /** At most ONE local image for this scene (project-relative ref); see SceneImageSchema. */
  image?: SceneImage;
  /** Spoken narration (drives timing + captions). */
  narration: string;
  /** On-screen short headline. */
  headline: string;
  body?: string;
  eyebrow?: string;
  /** Optional pacing target (seconds); real timing follows measured TTS. */
  durationInSeconds?: number;
  sfx?: "none" | "transition" | "alert" | "emphasis" | "success";
  /** Narrative role (advisory). */
  role?: "hook" | "body" | "recap" | "cta";
  /** Transition into the next scene. */
  transitionToNext?: "slide" | "fade" | "wipe" | "clockWipe" | "zoom";
  /** AI-chosen in-scene emphasis (whole-scene punch-in zoom for key beats). */
  emphasis?: "zoom";
};

export type Manifest = {
  title?: string;
  /**
   * Publish hashtags (TikTok), kept SEPARATE from the title so the project
   * display name (D9) stays clean ("Gemma 3 chạy trên máy nhà", not "… #ai #llm").
   * The published screen surfaces them next to the title with a Copy button
   * (R9.5). Each entry already carries its leading `#` (normalized at parse).
   * Absent for YouTube (no hashtag requirement) or an older manifest.
   */
  hashtags?: string[];
  /**
   * Delivery format (freeform-engine R7). The backend injects this from the
   * user's UI choice — the model does NOT pick it. Absent ⇒ "tiktok" (the
   * historical vertical default), so a manifest authored before format existed
   * still resolves to a valid spec.
   */
  format?: VideoFormat;
  /** User-chosen duration bucket (1|2|3); maps to seconds via `tierSeconds`. */
  durationTier?: DurationTier;
  /**
   * User-chosen background-music track (freeform-engine I2/O4): the library
   * filename under `VIDEO_TOOL_HOME/.video-tool/bgm/`. Resolved to an absolute
   * path at the render boundary and mixed under the narration; an empty/absent
   * value (or a stale ref to a deleted track) ⇒ no music. The AI never sets it.
   */
  bgm?: string;
  /** Authored video language: title, hashtags, on-screen text, narration, captions. Absent ⇒ "vi". */
  videoLanguage?: VideoLanguage;
  /** @deprecated Legacy field from the old title-only picker; `mix` normalizes to "vi". */
  titleLanguage?: LegacyTitleLanguage;
  theme?: { dominant: string; mood?: string };
  scenes: ManifestScene[];
};

/** Default per-scene hold when a manifest scene omits a pacing target. */
const DEFAULT_SCENE_SECONDS = 8;

/** VideoSpec theme limits: dominant must be 6-digit hex, mood ≤40 chars. */
const HEX6 = /^#[0-9a-fA-F]{6}$/;
function clampTheme(theme: { dominant: string; mood?: string }): {
  dominant: string;
  mood?: string;
} {
  const dominant = HEX6.test((theme.dominant ?? "").trim()) ? theme.dominant.trim() : "#1E9CB0";
  const mood = (theme.mood ?? "").trim().slice(0, 40);
  return {
    dominant,
    ...(mood ? { mood } : {}),
  };
}

/** An empty manifest skeleton written by `author scaffold`. */
export function emptyManifest(title = "Untitled"): Manifest {
  return { title, theme: { dominant: "#5B8CFF", mood: "" }, scenes: [] };
}

/** Convert a manifest into a renderer-agnostic VideoSpec (fills sensible defaults). */
export function manifestToVideoSpec(manifest: Manifest): VideoSpec {
  // Format drives canvas/zones/caption presence. The backend injects it from the
  // user's UI choice; absent ⇒ the historical vertical default so an older
  // manifest still resolves. `ratio` is derived from format for readability.
  const format: VideoFormat = manifest.format ?? "tiktok";
  const videoLanguage = manifest.videoLanguage ?? normalizeVideoLanguage(manifest.titleLanguage);
  const candidate = {
    version: 1,
    title: (manifest.title?.trim() || "Untitled").slice(0, 140),
    styleId: "clean-luxury-tech",
    format,
    ...(manifest.durationTier ? { durationTier: manifest.durationTier } : {}),
    videoLanguage,
    ratio: format === "youtube" ? "16:9" : "9:16",
    language: videoLanguage,
    // Clamp to the VideoSpec schema so a manifest authored with AI variance
    // (or written by an older build) never trips validation at render time.
    theme: manifest.theme?.dominant ? clampTheme(manifest.theme) : undefined,
    scenes: manifest.scenes.map((scene) => ({
      id: scene.id,
      component: scene.component,
      durationInSeconds: scene.durationInSeconds ?? DEFAULT_SCENE_SECONDS,
      headline: scene.headline,
      body: scene.body,
      eyebrow: scene.eyebrow,
      narration: scene.narration,
      props: scene.props ?? {},
      ...(scene.image ? { image: scene.image } : {}),
      sfx: scene.sfx ?? "none",
      transitionToNext: scene.transitionToNext,
      emphasis: scene.emphasis,
    })),
  };
  return VideoSpecSchema.parse(candidate);
}

/** Scaffold a project skeleton: folder tree + `authored/` dir + empty manifest. */
export async function scaffoldProject(projectId: string, title?: string): Promise<{ manifestPath: string; authoredDir: string }> {
  await ensureProject(projectId);
  const p = projectPaths(projectId);
  await mkdir(p.authoredDir, { recursive: true });
  if (!existsSync(p.manifest)) {
    await writeJson(p.manifest, emptyManifest(title));
  }
  return { manifestPath: p.manifest, authoredDir: p.authoredDir };
}

export async function loadManifest(projectId: string): Promise<Manifest> {
  return readJson<Manifest>(projectPaths(projectId).manifest);
}

/** Load the manifest and convert it to a VideoSpec (the lock/render input). */
export async function loadManifestAsSpec(projectId: string): Promise<VideoSpec> {
  return manifestToVideoSpec(await loadManifest(projectId));
}

/** A manifest scene resolved to the authored `.tsx` that defines its component. */
export type ManifestSceneFile = { sceneId: string; componentId: string; file: string };

/**
 * Scope the admitted authored files to exactly those the manifest references, in
 * manifest (render) order — pairing each manifest scene with the `.tsx` whose
 * `registerComponent` id it names. `componentToFile` is the `componentId → file`
 * map built from an admission pass (ids and files are 1:1). Files not referenced
 * by any scene (e.g. an earlier authoring batch left stranded after a reauthor
 * rewrote the manifest with new ids) are OMITTED, so they are neither bundled nor
 * typechecked — a stale orphan can't crash or block a render it isn't part of.
 */
export function manifestSceneFiles(
  manifest: Manifest,
  componentToFile: ReadonlyMap<string, string>,
): ManifestSceneFile[] {
  const out: ManifestSceneFile[] = [];
  for (const scene of manifest.scenes) {
    const file = componentToFile.get(scene.component);
    if (file) out.push({ sceneId: scene.id, componentId: scene.component, file });
  }
  return out;
}

/** List the authored scene `.tsx` files in a project (excluding the generated entry). */
export async function listAuthoredScenes(projectId: string): Promise<string[]> {
  const dir = projectPaths(projectId).authoredDir;
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  return files
    .filter((f) => /\.tsx$/.test(f) && !f.startsWith("_"))
    .sort()
    .map((f) => join(dir, f));
}

export type AdmitProjectResult =
  | { ok: true; componentIds: string[]; files: string[] }
  | { ok: false; violations: SafetyIssue[] };

/**
 * Admit every authored scene in a project (R1.3/R10.2). Each `.tsx` must pass
 * the static AST gate (N4/N5) and declare exactly one literal component id.
 * Returns the admitted ids on success, or the blocking violations. Authored code
 * is never imported into the Node host; render-time registration happens inside
 * the generated Remotion entry.
 */
export async function admitProjectScenes(
  projectId: string,
): Promise<AdmitProjectResult> {
  const files = await listAuthoredScenes(projectId);
  if (files.length === 0) {
    return {
      ok: false,
      violations: [
        {
          check: "N4",
          severity: "error",
          path: projectPaths(projectId).authoredDir,
          message: "No authored scenes found. Add scene .tsx modules under authored/ before rendering.",
        },
      ],
    };
  }

  const componentIds: string[] = [];
  const violations: SafetyIssue[] = [];
  const seenComponentIds = new Set<string>();
  for (const file of files) {
    const result = await admitAuthoredSceneFile(file);
    if (result.ok) {
      if (seenComponentIds.has(result.componentId)) {
        violations.push({
          check: "N4",
          severity: "error",
          path: file,
          message: `Authored project registers duplicate component id "${result.componentId}". Each authored scene must use a unique id.`,
        });
      } else {
        seenComponentIds.add(result.componentId);
        componentIds.push(result.componentId);
      }
    } else {
      violations.push(...result.violations);
    }
  }
  if (violations.length > 0) return { ok: false, violations };
  return { ok: true, componentIds, files };
}

/** Write a starter authored scene + manifest entry placeholder (used by scaffold examples/tests). */
export async function writeAuthoredScene(projectId: string, fileName: string, source: string): Promise<string> {
  const p = projectPaths(projectId);
  await mkdir(p.authoredDir, { recursive: true });
  const path = join(p.authoredDir, fileName);
  await writeFile(path, source, "utf8");
  return path;
}
