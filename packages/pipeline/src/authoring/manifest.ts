import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VideoSpec } from "@news/schema";
import type { SafetyIssue } from "../types.js";
import { ensureProject, projectPaths, readJson, writeJson } from "../store/store.js";
import { admitAndRegisterAuthored } from "./register.js";

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
  theme?: { dominant: string; mood?: string; stylePackId?: string };
  scenes: ManifestScene[];
};

/** Default per-scene hold when a manifest scene omits a pacing target. */
const DEFAULT_SCENE_SECONDS = 8;

/** VideoSpec theme limits: dominant must be 6-digit hex, mood ≤40 chars. */
const HEX6 = /^#[0-9a-fA-F]{6}$/;
function clampTheme(theme: { dominant: string; mood?: string; stylePackId?: string }): {
  dominant: string;
  mood?: string;
  stylePackId?: string;
} {
  const dominant = HEX6.test((theme.dominant ?? "").trim()) ? theme.dominant.trim() : "#1E9CB0";
  const mood = (theme.mood ?? "").trim().slice(0, 40);
  return {
    dominant,
    ...(mood ? { mood } : {}),
    ...(theme.stylePackId ? { stylePackId: theme.stylePackId } : {}),
  };
}

/** An empty manifest skeleton written by `author scaffold`. */
export function emptyManifest(title = "Untitled"): Manifest {
  return { title, theme: { dominant: "#5B8CFF", mood: "" }, scenes: [] };
}

/** Convert a manifest into a renderer-agnostic VideoSpec (fills sensible defaults). */
export function manifestToVideoSpec(manifest: Manifest): VideoSpec {
  return {
    version: 1,
    title: (manifest.title?.trim() || "Untitled").slice(0, 140),
    styleId: "clean-luxury-tech",
    ratio: "9:16",
    language: "vi",
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
      sfx: scene.sfx ?? "none",
      transitionToNext: scene.transitionToNext,
      emphasis: scene.emphasis,
    })),
  };
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
 * Admit + register every authored scene in a project (R1.3/R10.2). Each `.tsx`
 * must pass the static AST gate (N4/N5) and self-register exactly one component
 * with a schema + example. Returns the registered ids on success, or the
 * blocking violations. A module that fails the gate is never imported/bundled.
 */
export async function admitProjectScenes(
  projectId: string,
  opts: { load?: (fileUrl: string) => Promise<unknown> } = {},
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
  for (const file of files) {
    const result = await admitAndRegisterAuthored(file, opts.load ? { load: opts.load } : {});
    if (result.ok) componentIds.push(result.componentId);
    else violations.push(...result.violations);
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
