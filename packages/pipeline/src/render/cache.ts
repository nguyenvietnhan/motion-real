import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, openSync, readSync, rmSync, statSync } from "node:fs";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LockedVideoSpec } from "@motionreal/schema";
import { renderCacheDir } from "../store/store.js";

/**
 * Determinism + render caching.
 *
 * A render is keyed by a stable hash of its LockedVideoSpec. Because the locked
 * spec already embeds every frame-affecting input — scene count, per-scene
 * startFrame / durationInFrames, component id, free-form props, AND the resolved
 * audio paths (`scene.audio.src`, `spec.audio.narrationSrc`) — an identical
 * locked spec means identical frames, so the cached MP4 can be reused.
 *
 * Cache invalidation on narration change is automatic and transitive: the TTS
 * layer keys each clip's path by `provider + model + text + voiceId + speed`, so changing any
 * narration text changes that scene's `audio.src` in the locked spec, which
 * changes `specHash`, which misses the render cache and forces a re-render
 *. The cache.test.ts P4 / 7.5 tests prove this.
 *
 * The locked spec does NOT embed authored scene SOURCE or the bytes of an
 * externally mixed BGM track. The full key can fold both in so visual-only and
 * music-only edits invalidate the cache (see `renderCacheKey`).
 *
 * The cache namespace is versioned deliberately. Bump it together with a
 * renderer/composition change so old pixels are never reused accidentally.
 */

export const RENDER_CACHE_VERSION = "2";
export const RENDERER_CACHE_FINGERPRINT = "motionreal-remotion-4.0.481";

/**
 * Canonical JSON: object keys are sorted recursively so key order never affects
 * the hash; arrays keep their order (order is semantically meaningful for
 * scenes). `undefined` properties are dropped to match JSON.stringify, so an
 * absent optional field and an explicit `undefined` hash identically.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item === undefined ? null : item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`);
  return `{${entries.join(",")}}`;
}

/**
 * Stable content hash of a LockedVideoSpec. Invariant to object key ordering,
 * sensitive to any frame-affecting field (scene count, timings, component,
 * props, audio paths). Returns a hex sha256 digest.
 */
export function specHash(locked: LockedVideoSpec): string {
  return createHash("sha256").update(stableStringify(locked), "utf8").digest("hex");
}

/**
 * Full render-cache key = spec hash + authored scene SOURCE + an optional
 * runtime discriminator. The discriminator covers inputs whose bytes are not
 * embedded in the locked spec, notably BGM selected by the desktop project.
 * The spec digest, render-cache version and renderer fingerprint are always
 * included. This intentionally invalidates cache entries made by old builds.
 */
export function renderCacheKey(
  locked: LockedVideoSpec,
  authoredSources: readonly string[] = [],
  runtimeDiscriminator = "",
): string {
  const h = createHash("sha256");
  h.update(`cache:${RENDER_CACHE_VERSION}\u0000renderer:${RENDERER_CACHE_FINGERPRINT}\u0000`, "utf8");
  h.update(stableStringify(locked), "utf8");
  for (const src of [...authoredSources].sort()) {
    h.update("\u0000source\u0000", "utf8");
    h.update(src, "utf8");
  }
  if (runtimeDiscriminator !== "") {
    h.update("\u0000runtime\u0000", "utf8");
    h.update(runtimeDiscriminator, "utf8");
  }
  return h.digest("hex");
}

/** Absolute path to the cached MP4 for a given spec hash. */
export function renderCachePath(hash: string): string {
  return join(renderCacheDir(), `${hash}.mp4`);
}

/** True when a non-empty cached render exists for this hash. */
export function hasCachedRender(hash: string): boolean {
  const path = renderCachePath(hash);
  const valid = existsSync(path) && safeSize(path) > 8 && looksLikeMp4(path);
  if (!valid) rmSync(path, { force: true });
  return valid;
}

/** Return the cached MP4 path on a hit, or null on a miss. */
export function getCachedRender(hash: string): string | null {
  return hasCachedRender(hash) ? renderCachePath(hash) : null;
}

/**
 * Copy a freshly rendered MP4 into the shared render cache under its spec hash.
 * Returns the cache path. Idempotent: re-running with the same hash overwrites.
 */
export async function putCachedRender(hash: string, mp4Path: string): Promise<string> {
  const dest = renderCachePath(hash);
  await mkdir(dirname(dest), { recursive: true });
  await copyValidatedMp4(mp4Path, dest);
  return dest;
}

/** Copy a cache hit or completed render into its canonical location atomically. */
export async function copyValidatedMp4(source: string, destination: string): Promise<void> {
  const tmp = `${destination}.partial-${randomUUID()}`;
  try {
    await copyFile(source, tmp);
    if (!await isValidMp4(tmp)) throw new Error("Rendered video is not a valid MP4 container.");
    await rename(tmp, destination);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Promote a renderer-owned temporary MP4 only after a structural validation. */
export async function promoteValidatedMp4(partialPath: string, destination: string): Promise<void> {
  if (!await isValidMp4(partialPath)) throw new Error("Rendered video is not a valid MP4 container.");
  await rename(partialPath, destination);
}

export async function isValidMp4(path: string): Promise<boolean> {
  if (safeSize(path) <= 8) return false;
  return looksLikeMp4(path);
}

function safeSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function looksLikeMp4(path: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const header = Buffer.alloc(12);
    const bytesRead = readSync(fd, header, 0, header.length, 0);
    return bytesRead >= 8 && header.subarray(4, 8).toString("ascii") === "ftyp";
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
