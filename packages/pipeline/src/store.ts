import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ProjectBrief, ProjectEvent, ProjectState } from "./types.js";

/**
 * Project store + workspace hygiene. All generated artifacts live under
 * VIDEO_TOOL_HOME/.video-tool/ (default: repo root). Each video is a
 * self-contained project folder, mirroring news_video_tool's hygiene rules and
 * math_video_tool's projects/<slug>/ convention (delete the folder → delete the
 * whole video). Nothing is ever written to the repository root.
 */

/** Resolve the .video-tool home. VIDEO_TOOL_HOME may be relative or absolute. */
export function videoToolHome(): string {
  const configured = process.env.VIDEO_TOOL_HOME?.trim();
  const base = configured && configured.length > 0 ? configured : ".video-tool";
  const abs = isAbsolute(base) ? base : resolve(process.cwd(), base);
  // If the configured path does not already end in .video-tool, nest it so we
  // never scatter artifacts directly in an arbitrary cwd.
  return abs.endsWith(".video-tool") ? abs : join(abs, ".video-tool");
}

export function projectsRoot(): string {
  return join(videoToolHome(), "projects");
}

export function projectPath(projectId: string): string {
  return join(projectsRoot(), projectId);
}

export function ttsCacheDir(): string {
  return join(videoToolHome(), "cache", "tts");
}

export function renderCacheDir(): string {
  return join(videoToolHome(), "cache", "renders");
}

/** Standard sub-paths inside a project folder. */
export function projectPaths(projectId: string) {
  const root = projectPath(projectId);
  return {
    root,
    brief: join(root, "brief.json"),
    spec: join(root, "video-spec.json"),
    lock: join(root, "video-spec.lock.json"),
    ttsManifest: join(root, "tts-manifest.json"),
    events: join(root, "events.ndjson"),
    audioDir: join(root, "audio"),
    rendersDir: join(root, "renders"),
    reviewDir: join(root, "review"),
    logsDir: join(root, "logs"),
    authoredDir: join(root, "authored"),
  };
}

/** Deterministic, filesystem-safe project id derived from the prompt. */
export function createProjectId(prompt: string): string {
  const slug = prompt
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 34);
  return `${slug || "video"}-${randomUUID().slice(0, 8)}`;
}

/** Create the project folder tree and shared caches. Idempotent. */
export async function ensureProject(projectId: string): Promise<string> {
  const p = projectPaths(projectId);
  for (const dir of [p.root, p.audioDir, p.rendersDir, p.reviewDir, p.logsDir]) {
    await mkdir(dir, { recursive: true });
  }
  await mkdir(ttsCacheDir(), { recursive: true });
  await mkdir(renderCacheDir(), { recursive: true });
  return p.root;
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readBrief(projectId: string): Promise<ProjectBrief> {
  return readJson<ProjectBrief>(projectPaths(projectId).brief);
}

export async function writeBrief(brief: ProjectBrief): Promise<void> {
  await writeJson(projectPaths(brief.projectId).brief, brief);
}

/** Update brief state/step/error and bump updatedAt. */
export async function setState(
  projectId: string,
  patch: Partial<Pick<ProjectBrief, "state" | "currentStep" | "error">> & { state?: ProjectState },
): Promise<ProjectBrief> {
  const brief = await readBrief(projectId);
  const next: ProjectBrief = {
    ...brief,
    ...patch,
    error: patch.error === undefined ? brief.error : patch.error,
    updatedAt: new Date().toISOString(),
  };
  await writeBrief(next);
  return next;
}

/** Append a lifecycle event to events.ndjson. */
export async function appendEvent(projectId: string, event: Omit<ProjectEvent, "at">): Promise<void> {
  const path = projectPaths(projectId).events;
  await mkdir(dirname(path), { recursive: true });
  const line = JSON.stringify({ ...event, at: new Date().toISOString() });
  await writeFile(path, `${line}\n`, { flag: "a" });
}

export type ProjectSummary = {
  projectId: string;
  root: string;
  brief?: ProjectBrief;
  hasRender: boolean;
};

/** List all known projects (newest first by updatedAt when available). */
export async function listProjects(): Promise<ProjectSummary[]> {
  const root = projectsRoot();
  if (!existsSync(root)) return [];
  const out: ProjectSummary[] = [];
  for (const id of await readdir(root)) {
    const p = projectPaths(id);
    if (!existsSync(p.brief)) continue;
    let brief: ProjectBrief | undefined;
    try {
      brief = await readJson<ProjectBrief>(p.brief);
    } catch {
      brief = undefined;
    }
    out.push({
      projectId: id,
      root: p.root,
      brief,
      hasRender: existsSync(join(p.rendersDir, `${id}.mp4`)),
    });
  }
  return out.sort((a, b) => (b.brief?.updatedAt ?? "").localeCompare(a.brief?.updatedAt ?? ""));
}
