import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { videoToolHome } from "../store/store.js";
import { BUNDLED_DEFAULT_BGM_TRACK_NAME, bundledDefaultBgmPath } from "../assets/bundled-media.js";

/**
 * Background-music library . BGM lives ONCE per machine
 * under `VIDEO_TOOL_HOME/.video-tool/bgm/` and is shared by every project; a
 * project stores only the chosen track's filename (the `bgm` field on its
 * manifest), resolved back to an absolute path at render time and mixed under
 * the narration by the existing `mixBgm` path. Supported formats: .mp3/.m4a/.wav.
 * The bundled default track is virtual: its manifest ref resolves directly to
 * the app asset instead of being copied into this user library.
 *
 * The library is a flat directory of audio files — no index/db. Listing reads
 * the dir; add copies a picked file in (collision-safe); remove deletes one.
 * Every name that crosses a path boundary is validated (no separators, no `..`,
 * known extension) so a crafted name can't escape the library dir into an
 * arbitrary fs delete/read — the same chokepoint discipline as `assertSafeProjectId`.
 */

const BGM_EXTENSIONS = new Set([".mp3", ".m4a", ".wav"]);

/** The per-machine BGM library directory (under the .video-tool home). */
export function bgmLibraryDir(): string {
  return join(videoToolHome(), "bgm");
}

export type BgmTrack = {
  /** The library filename (what a project stores as its `bgm` ref). */
  name: string;
  /** Absolute path to the file on disk. */
  path: string;
  /** Size in bytes (for a "12 MB" hint in the UI). */
  sizeBytes: number;
};

/** Strip a candidate library filename to the safe shape: a bare name, known ext, no traversal. */
function safeBgmPath(name: string): string {
  if (typeof name !== "string" || name.length === 0 || name !== basename(name) || name.includes("..")) {
    throw new Error(`Invalid BGM track name: ${JSON.stringify(name)}`);
  }
  if (!BGM_EXTENSIONS.has(extname(name).toLowerCase())) {
    throw new Error(`Invalid BGM track name (unsupported extension): ${JSON.stringify(name)}`);
  }
  return join(bgmLibraryDir(), name);
}

/** Sanitize a source basename into a filesystem-safe library name (keeps unicode/spaces). */
function sanitizeBgmBase(base: string): string {
  // Drop only the characters that are unsafe on Windows/macOS paths; keep
  // letters (incl. Vietnamese), digits, spaces, dashes, underscores, dots.
  return base.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
}

/**
 * List the library tracks (sorted by name). A missing dir ⇒ empty list (no
 * library yet). A single unstattable/locked entry is skipped, never aborting
 * the listing — same best-effort totality as the project store's `listProjects`.
 */
export async function listBgmTracks(): Promise<BgmTrack[]> {
  const dir = bgmLibraryDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: BgmTrack[] = [];
  for (const name of names) {
    if (name === BUNDLED_DEFAULT_BGM_TRACK_NAME) continue;
    if (!BGM_EXTENSIONS.has(extname(name).toLowerCase())) continue;
    const path = join(dir, name);
    try {
      const st = await stat(path);
      if (!st.isFile()) continue;
      out.push({ name, path, sizeBytes: st.size });
    } catch {
      /* a single unstattable/locked entry must not abort the listing */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Copy a picked audio file into the library (collision-safe: a clashing name
 * gets a `-1`/`-2` suffix rather than overwriting an existing track). Rejects an
 * unsupported extension up front. Returns the stored track.
 */
export async function addBgmTrack(srcPath: string): Promise<BgmTrack> {
  const ext = extname(srcPath).toLowerCase();
  if (!BGM_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported BGM format: ${ext || "(none)"}. Use .mp3/.m4a/.wav.`);
  }
  const dir = bgmLibraryDir();
  await mkdir(dir, { recursive: true });
  const base = sanitizeBgmBase(basename(srcPath, extname(srcPath))) || "track";
  let name = `${base}${ext}`;
  let n = 1;
  while (name === BUNDLED_DEFAULT_BGM_TRACK_NAME || existsSync(join(dir, name))) {
    name = `${base}-${n}${ext}`;
    n += 1;
  }
  const dest = join(dir, name);
  await copyFile(srcPath, dest);
  const st = await stat(dest);
  return { name, path: dest, sizeBytes: st.size };
}

/** Delete one library track by name. Best-effort: an absent file resolves cleanly. */
export async function removeBgmTrack(name: string): Promise<void> {
  const path = safeBgmPath(name);
  await rm(path, { force: true });
}

/**
 * Resolve a project's stored BGM ref to an absolute path for the mixer, or
 * undefined when the ref is empty/invalid/missing (so the render simply runs
 * without BGM — never throws on a stale ref to a deleted track).
 */
export function resolveBgmTrack(name: string | undefined): string | undefined {
  if (!name) return undefined;
  if (name === BUNDLED_DEFAULT_BGM_TRACK_NAME) {
    const path = bundledDefaultBgmPath();
    return existsSync(path) ? path : undefined;
  }
  let path: string;
  try {
    path = safeBgmPath(name);
  } catch {
    return undefined;
  }
  return existsSync(path) ? path : undefined;
}
