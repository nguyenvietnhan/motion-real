import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { VideoSpecSchema, type DurationTier, type SceneImage, type SceneMotionBeat, type VideoFormat, type VideoLanguage, type VideoSpec } from "@motionreal/schema";
import type { SafetyIssue } from "../types.js";
import { ensureProject, projectPaths, readJson, writeJson } from "../store/store.js";
import { normalizeAuthoredSource } from "./normalize-authored-source.js";
import { admitAuthoredMotionCues } from "./admission.js";
import { admitAuthoredSceneFile } from "./register.js";

/**
 * Per-project manifest. A manifest is the AUTHOR-mode
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
  /** MotionReal-owned narration anchors; authored TSX may consume their resolved cues. */
  motionBeats?: SceneMotionBeat[];
  /** On-screen short headline. */
  headline: string;
  body?: string;
  eyebrow?: string;
  /** Optional pacing target (seconds); real timing follows measured TTS. */
  durationInSeconds?: number;
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
   * Publish hashtags, kept SEPARATE from the title so the project display name
   * stays clean. Each entry already carries its leading `#` (normalized at parse).
   */
  hashtags?: string[];
  /**
   * Delivery format. Always short-form `"tiktok"` for new projects; the model
   * does NOT pick it. Absent ⇒ "tiktok".
   */
  format?: VideoFormat;
  /** Duration bucket (1|2|3) for pacing; new creates use tier 1. */
  durationTier?: DurationTier;
  /**
   * User-chosen background-music track : the library
   * filename under `VIDEO_TOOL_HOME/.video-tool/bgm/`. Resolved to an absolute
   * path at the render boundary and mixed under the narration; an empty/absent
   * value (or a stale ref to a deleted track) ⇒ no music. The AI never sets it.
   */
  bgm?: string;
  /** Authored video language: title, hashtags, on-screen text, narration, captions. Absent ⇒ "vi". */
  videoLanguage?: VideoLanguage;
  theme?: { dominant: string };
  scenes: ManifestScene[];
};

/** Default per-scene hold when a manifest scene omits a pacing target. */
const DEFAULT_SCENE_SECONDS = 8;

/** VideoSpec theme limits: dominant must be 6-digit hex. Legacy `mood` is ignored. */
const HEX6 = /^#[0-9a-fA-F]{6}$/;
function clampTheme(theme: { dominant: string }): { dominant: string } {
  const dominant = HEX6.test((theme.dominant ?? "").trim()) ? theme.dominant.trim() : "#1E9CB0";
  return { dominant };
}

/** An empty manifest skeleton written by `author scaffold`. */
export function emptyManifest(title = "Untitled"): Manifest {
  return { title, theme: { dominant: "#5B8CFF" }, scenes: [] };
}

/** Convert a manifest into a renderer-agnostic VideoSpec (fills sensible defaults). */
export function manifestToVideoSpec(manifest: Manifest): VideoSpec {
  // Short-form only: absent format ⇒ tiktok. Ratio is always 9:16.
  const format: VideoFormat = "tiktok";
  const language = manifest.videoLanguage ?? "vi";
  const candidate = {
    version: 1,
    title: (manifest.title?.trim() || "Untitled").slice(0, 140),
    format,
    ...(manifest.durationTier ? { durationTier: manifest.durationTier } : {}),
    ratio: "9:16" as const,
    language,
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
      ...(scene.motionBeats ? { motionBeats: scene.motionBeats } : {}),
      props: scene.props ?? {},
      ...(scene.image ? { image: scene.image } : {}),
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
 * Admit every authored scene in a project. Each `.tsx` must pass
 * the static AST gate (N4/N5) and declare exactly one literal component id.
 * Returns the admitted ids on success, or the blocking violations. Authored code
 * is never imported into the Node host; render-time registration happens inside
 * the generated Remotion entry.
 */
/**
 * Admit an explicit list of authored scene files (canonical or staged).
 * Static AST gate only — does not mutate the runtime registry.
 */
export async function admitAuthoredSceneFiles(
  files: readonly string[],
  emptyPathHint?: string,
  manifest?: Manifest,
): Promise<AdmitProjectResult> {
  if (files.length === 0) {
    return {
      ok: false,
      violations: [
        {
          check: "N4",
          severity: "error",
          path: emptyPathHint ?? "(no files)",
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
  if (violations.length === 0 && manifest) {
    const fileByComponent = new Map(componentIds.map((id, index) => [id, files[index]!] as const));
    for (const scene of manifest.scenes) {
      if (!scene.motionBeats) continue;
      const file = fileByComponent.get(scene.component);
      if (!file) {
        violations.push({
          check: "N4",
          severity: "error",
          sceneId: scene.id,
          path: emptyPathHint ?? "(manifest)",
          message: `${scene.id} không có authored component "${scene.component}" để kiểm motion cues.`,
        });
        continue;
      }
      violations.push(...admitAuthoredMotionCues(file, scene.id, scene.motionBeats.map((beat) => beat.id)));
    }
  }
  if (violations.length > 0) return { ok: false, violations };
  return { ok: true, componentIds, files: [...files] };
}

export async function admitProjectScenes(
  projectId: string,
): Promise<AdmitProjectResult> {
  const files = await listAuthoredScenes(projectId);
  const manifest = await loadManifest(projectId).catch(() => undefined);
  const result = await admitAuthoredSceneFiles(files, projectPaths(projectId).authoredDir, manifest);
  if (!result.ok) {
    // Stamp sceneId when we can so the draft repair loop can reauthor the
    // precise scene (contentTargets requires sceneId on hard errors).
    return { ok: false, violations: await stampSceneIdsOnAdmissionViolations(projectId, result.violations) };
  }
  return result;
}

/**
 * Pure: map admission violation paths (authored file basenames) onto
 * manifest scene ids. Never invents scenes — unmatched issues stay unscoped.
 */
export function stampSceneIdsFromManifest(
  manifest: Manifest,
  violations: readonly SafetyIssue[],
): SafetyIssue[] {
  if (violations.length === 0) return [];
  const idByToken = new Map<string, string>();
  for (const scene of manifest.scenes) {
    idByToken.set(scene.component.toLowerCase(), scene.id);
    idByToken.set(scene.id.toLowerCase(), scene.id);
  }
  return violations.map((v) => {
    if (v.sceneId) return v;
    const rawPath = (v.path ?? "").split(":")[0] ?? "";
    const fileBase = basename(rawPath).replace(/\.tsx$/i, "").toLowerCase();
    const fromToken = idByToken.get(fileBase);
    if (fromToken) return { ...v, sceneId: fromToken };
    const lower = rawPath.toLowerCase().replace(/\\/g, "/");
    for (const [token, sceneId] of idByToken) {
      if (token && lower.includes(token)) return { ...v, sceneId };
    }
    return v;
  });
}

/** Load manifest then {@link stampSceneIdsFromManifest}; best-effort on missing manifest. */
export async function stampSceneIdsOnAdmissionViolations(
  projectId: string,
  violations: readonly SafetyIssue[],
): Promise<SafetyIssue[]> {
  if (violations.length === 0) return [];
  try {
    return stampSceneIdsFromManifest(await loadManifest(projectId), violations);
  } catch {
    return [...violations];
  }
}

/** Write a starter authored scene + manifest entry placeholder (used by scaffold examples/tests). */
export async function writeAuthoredScene(projectId: string, fileName: string, source: string): Promise<string> {
  const p = projectPaths(projectId);
  await mkdir(p.authoredDir, { recursive: true });
  const path = join(p.authoredDir, fileName);
  await writeFile(path, normalizeAuthoredSource(source), "utf8");
  return path;
}
