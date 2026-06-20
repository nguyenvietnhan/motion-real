import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LockedVideoSpec } from "@news/schema";
import { renderCacheDir } from "../store/store.js";

/**
 * Determinism + render caching (design B.4, Requirements 7.4 / 7.5).
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
 * (Requirement 7.5). The cache.test.ts P4 / 7.5 tests prove this.
 *
 * The locked spec does NOT embed authored scene SOURCE or the bytes of an
 * externally mixed BGM track. The full key can fold both in so visual-only and
 * music-only edits invalidate the cache (see `renderCacheKey`).
 *
 * The pipeline logic here is deterministic: no Date.now / Math.random.
 */

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
 * With neither authored sources nor a discriminator this reduces to `specHash`
 * for back-compat with non-desktop callers.
 */
export function renderCacheKey(
  locked: LockedVideoSpec,
  authoredSources: readonly string[] = [],
  runtimeDiscriminator = "",
): string {
  if (authoredSources.length === 0 && runtimeDiscriminator === "") return specHash(locked);
  const h = createHash("sha256");
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
  return existsSync(path) && safeSize(path) > 0;
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
  await copyFile(mp4Path, dest);
  return dest;
}

function safeSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
