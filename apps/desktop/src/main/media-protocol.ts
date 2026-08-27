import { protocol } from "electron";
import { createReadStream as fsCreateReadStream, type ReadStream } from "node:fs";
import { realpath as fsRealpath, stat as fsStat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { createLogger, videoToolHome, workspaceRoot } from "@motionreal/pipeline";

const log = createLogger("media");

/**
 * Local-file protocol (B7). The renderer runs on an http(s)/file origin, so raw
 * `file://` paths under `.video-tool` will not load. We register a privileged
 * `media://` scheme and serve only known media artifacts (stills, renders,
 * staged images, BGM, bundled assets). URLs are route-relative locators — never
 * renderer-visible absolute filesystem paths.
 *
 * The handler answers HTTP Range requests (206 Partial Content) so `<video>`
 * seeking works on draft and full MP4s.
 */

const SCHEME = "media";
const HOST = "file";

/** Extension → MIME for artifacts we deliberately serve. Unknown extensions are denied. */
const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
};

/** Project ids match the store boundary (slug + hex suffix shape). */
const PROJECT_ID_RE = /^[A-Za-z0-9_-]+$/;
const WINDOWS_RESERVED_PROJECT_ID_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export type MediaPathKind =
  | "project-asset"
  | "project-review"
  | "project-render"
  | "agent-asset"
  | "staging"
  | "bgm"
  | "bundled-asset";

export type MediaPathPolicy = {
  videoToolHome: string;
  bundledAssetsRoot: string;
};

export type ClassifiedMediaPath = {
  kind: MediaPathKind;
  /** Absolute root for this media kind (project zone or library folder). */
  root: string;
  /** Posix-style relative path under `root` (no leading slash, no `..`). */
  relativePath: string;
  contentType: string;
  /** Absolute lexical path before realpath. */
  absolutePath: string;
};

export type MediaProtocolFs = {
  realpath: (path: string) => Promise<string>;
  stat: (path: string) => Promise<{ size: number; isFile: () => boolean }>;
  createReadStream: (path: string, opts?: { start?: number; end?: number }) => ReadStream;
};

const defaultFs: MediaProtocolFs = {
  realpath: (path) => fsRealpath(path),
  stat: async (path) => {
    const s = await fsStat(path);
    return { size: s.size, isFile: () => s.isFile() };
  },
  createReadStream: fsCreateReadStream,
};

export function defaultMediaPathPolicy(): MediaPathPolicy {
  return {
    videoToolHome: videoToolHome(),
    bundledAssetsRoot: join(workspaceRoot(), "apps", "desktop", "assets"),
  };
}

function isSafeProjectId(projectId: string): boolean {
  return PROJECT_ID_RE.test(projectId) && !WINDOWS_RESERVED_PROJECT_ID_RE.test(projectId);
}

function mimeForPath(path: string): string | null {
  return MIME[extname(path).toLowerCase()] ?? null;
}

function isContainedInRoot(absPath: string, rootPath: string): boolean {
  const abs = resolve(absPath);
  const root = resolve(rootPath);
  const rel = relative(root, abs);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Split a relative path into non-empty segments; reject `..` and empty. */
function splitRelativeSegments(rel: string): string[] | null {
  const normalized = rel.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) return null;
  const parts = normalized.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  if (parts.some((p) => p === "." || p === ".." || p.includes("\0"))) return null;
  return parts;
}

function toPosixRelative(segments: string[]): string {
  return segments.join("/");
}

function classifyUnderRoot(
  abs: string,
  root: string,
  kind: MediaPathKind,
): ClassifiedMediaPath | null {
  if (!isContainedInRoot(abs, root)) return null;
  const rel = relative(resolve(root), abs);
  if (rel === "") return null; // directory root itself
  const segments = splitRelativeSegments(rel);
  if (!segments) return null;
  const contentType = mimeForPath(abs);
  if (!contentType) return null;
  return {
    kind,
    root: resolve(root),
    relativePath: toPosixRelative(segments),
    contentType,
    absolutePath: abs,
  };
}

/**
 * Pure lexical classifier: accepts only the known media locations and MIME
 * extensions. Does not touch the filesystem (realpath is the handler's job).
 */
export function classifyMediaPath(
  absPath: string,
  policy: MediaPathPolicy = defaultMediaPathPolicy(),
): ClassifiedMediaPath | null {
  if (!absPath || typeof absPath !== "string") return null;
  const abs = resolve(absPath);
  if (!mimeForPath(abs)) return null;

  const home = resolve(policy.videoToolHome);
  const projectsRoot = join(home, "projects");
  const agentDraftsRoot = join(home, "agent-drafts");

  if (isContainedInRoot(abs, agentDraftsRoot)) {
    const segments = splitRelativeSegments(relative(agentDraftsRoot, abs));
    if (!segments || segments.length < 3) return null;
    const [draftId, zone, ...rest] = segments;
    if (!draftId || !/^agent-[0-9a-f-]{36}$/i.test(draftId) || zone !== "assets" || rest.length === 0) return null;
    return classifyUnderRoot(abs, join(agentDraftsRoot, draftId, "assets"), "agent-asset");
  }

  if (isContainedInRoot(abs, projectsRoot)) {
    const rel = relative(projectsRoot, abs);
    const segments = splitRelativeSegments(rel);
    if (!segments || segments.length < 3) return null;
    const [projectId, zone, ...rest] = segments;
    if (!projectId || !isSafeProjectId(projectId)) return null;
    if (rest.length === 0) return null;

    let kind: MediaPathKind | null = null;
    if (zone === "assets") kind = "project-asset";
    else if (zone === "review") kind = "project-review";
    else if (zone === "renders") kind = "project-render";
    else return null;

    const zoneRoot = join(projectsRoot, projectId, zone);
    return classifyUnderRoot(abs, zoneRoot, kind);
  }

  const staging = classifyUnderRoot(abs, join(home, "staging"), "staging");
  if (staging) return staging;

  const bgm = classifyUnderRoot(abs, join(home, "bgm"), "bgm");
  if (bgm) return bgm;

  const bundled = classifyUnderRoot(abs, policy.bundledAssetsRoot, "bundled-asset");
  if (bundled) return bundled;

  return null;
}

export function isAllowedMediaPath(
  absPath: string,
  policy: MediaPathPolicy = defaultMediaPathPolicy(),
): boolean {
  return classifyMediaPath(absPath, policy) !== null;
}

/**
 * Build a route-relative `media://` URL. Encodes kind + relative segments only —
 * never an absolute filesystem path.
 */
export function mediaUrl(
  absPath: string | null | undefined,
  policy: MediaPathPolicy = defaultMediaPathPolicy(),
): string | null {
  if (!absPath) return null;
  const classified = classifyMediaPath(absPath, policy);
  if (!classified) return null;

  const segments = [classified.kind, ...classified.relativePath.split("/")];
  // project kinds need project id for path rebuild — fold into relativePath via
  // zone roots. For project-*, relativePath is under zone; URL must include project id.
  if (
    classified.kind === "project-asset" ||
    classified.kind === "project-review" ||
    classified.kind === "project-render" ||
    classified.kind === "agent-asset"
  ) {
    if (classified.kind === "agent-asset") {
      const fromDrafts = relative(join(resolve(policy.videoToolHome), "agent-drafts"), classified.absolutePath);
      const [draftId, zone, ...rest] = splitRelativeSegments(fromDrafts) ?? [];
      if (!draftId || zone !== "assets" || rest.length === 0) return null;
      return `${SCHEME}://${HOST}/${[classified.kind, draftId, ...rest].map(encodeURIComponent).join("/")}`;
    }
    const zone =
      classified.kind === "project-asset"
        ? "assets"
        : classified.kind === "project-review"
          ? "review"
          : "renders";
    const home = resolve(policy.videoToolHome);
    const projectsRoot = join(home, "projects");
    // absolutePath = projects/<id>/<zone>/<rel>
    const fromProjects = relative(projectsRoot, classified.absolutePath);
    const projectSegments = splitRelativeSegments(fromProjects);
    if (!projectSegments || projectSegments.length < 3) return null;
    const [projectId, z, ...rest] = projectSegments;
    if (z !== zone || !projectId || rest.length === 0) return null;
    const pathParts = [classified.kind, projectId, ...rest].map(encodeURIComponent);
    return `${SCHEME}://${HOST}/${pathParts.join("/")}`;
  }

  const pathParts = segments.map(encodeURIComponent);
  return `${SCHEME}://${HOST}/${pathParts.join("/")}`;
}

/** Rebuild absolute path from a classified media route (lexical only). */
export function absolutePathFromMediaRoute(
  kind: MediaPathKind,
  routeSegments: string[],
  policy: MediaPathPolicy = defaultMediaPathPolicy(),
): string | null {
  if (routeSegments.length === 0) return null;
  if (routeSegments.some((s) => s === "." || s === ".." || s.includes("\0") || s === "")) return null;

  const home = resolve(policy.videoToolHome);

  if (kind === "project-asset" || kind === "project-review" || kind === "project-render") {
    if (routeSegments.length < 2) return null;
    const [projectId, ...rest] = routeSegments;
    if (!projectId || !isSafeProjectId(projectId) || rest.length === 0) return null;
    const zone =
      kind === "project-asset" ? "assets" : kind === "project-review" ? "review" : "renders";
    return resolve(join(home, "projects", projectId, zone, ...rest));
  }
  if (kind === "agent-asset") {
    if (routeSegments.length < 2) return null;
    const [draftId, ...rest] = routeSegments;
    if (!draftId || !/^agent-[0-9a-f-]{36}$/i.test(draftId) || rest.length === 0) return null;
    return resolve(join(home, "agent-drafts", draftId, "assets", ...rest));
  }

  if (kind === "staging") {
    return resolve(join(home, "staging", ...routeSegments));
  }
  if (kind === "bgm") {
    return resolve(join(home, "bgm", ...routeSegments));
  }
  if (kind === "bundled-asset") {
    return resolve(join(resolve(policy.bundledAssetsRoot), ...routeSegments));
  }
  return null;
}

const MEDIA_KINDS = new Set<MediaPathKind>([
  "project-asset",
  "project-review",
  "project-render",
  "agent-asset",
  "staging",
  "bgm",
  "bundled-asset",
]);

function isMediaPathKind(value: string): value is MediaPathKind {
  return MEDIA_KINDS.has(value as MediaPathKind);
}

export type MediaRequestResult =
  | {
      ok: true;
      absolutePath: string;
      contentType: string;
      size: number;
    }
  | { ok: false; status: 403 | 404 };

/**
 * Authoritative request resolver: parse media:// route, recompute path, realpath
 * containment, regular-file + extension checks. Injectable fs for tests.
 */
export async function resolveMediaRequest(
  requestUrl: string,
  policy: MediaPathPolicy = defaultMediaPathPolicy(),
  fs: MediaProtocolFs = defaultFs,
): Promise<MediaRequestResult> {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch (_error) {
    return { ok: false, status: 403 };
  }

  if (parsed.protocol !== `${SCHEME}:` || parsed.hostname !== HOST) {
    return { ok: false, status: 403 };
  }
  // Query strings must not change lookup semantics.
  // Fragment (#rN) is client-only cache-busting on still URLs — pathname is the
  // resource; reject only if someone tried to encode path data in the query.
  if (parsed.search) {
    return { ok: false, status: 403 };
  }

  const rawPath = parsed.pathname.replace(/^\/+/, "");
  if (!rawPath) return { ok: false, status: 403 };

  let decodedSegments: string[];
  try {
    decodedSegments = rawPath.split("/").map((s) => decodeURIComponent(s));
  } catch (_error) {
    return { ok: false, status: 403 };
  }

  if (decodedSegments.length < 2) return { ok: false, status: 403 };
  const [kindRaw, ...routeSegments] = decodedSegments;
  if (!kindRaw || !isMediaPathKind(kindRaw)) return { ok: false, status: 403 };

  const lexicalAbs = absolutePathFromMediaRoute(kindRaw, routeSegments, policy);
  if (!lexicalAbs) return { ok: false, status: 403 };

  // Lexical classify must agree (extension + zone).
  const classified = classifyMediaPath(lexicalAbs, policy);
  if (!classified || classified.kind !== kindRaw) {
    return { ok: false, status: 403 };
  }

  let resolvedTarget: string;
  let resolvedRoot: string;
  try {
    resolvedRoot = await fs.realpath(classified.root);
    resolvedTarget = await fs.realpath(lexicalAbs);
  } catch (_error) {
    return { ok: false, status: 404 };
  }

  if (!isContainedInRoot(resolvedTarget, resolvedRoot)) {
    return { ok: false, status: 403 };
  }

  // Re-check extension on the real path (symlink rename / extension games).
  const contentType = mimeForPath(resolvedTarget);
  if (!contentType) return { ok: false, status: 403 };

  let fileStat: { size: number; isFile: () => boolean };
  try {
    fileStat = await fs.stat(resolvedTarget);
  } catch (_error) {
    return { ok: false, status: 404 };
  }
  if (!fileStat.isFile()) {
    return { ok: false, status: 403 };
  }

  return {
    ok: true,
    absolutePath: resolvedTarget,
    contentType,
    size: fileStat.size,
  };
}

function bodyStream(
  abs: string,
  range: { start: number; end: number } | undefined,
  fs: MediaProtocolFs,
): ReadableStream<Uint8Array> {
  const node = range
    ? fs.createReadStream(abs, { start: range.start, end: range.end })
    : fs.createReadStream(abs);
  return Readable.toWeb(node) as ReadableStream<Uint8Array>;
}

function rangeResponse(
  abs: string,
  size: number,
  type: string,
  rangeHeader: string | null,
  fs: MediaProtocolFs,
): Response {
  if (!rangeHeader) {
    return new Response(bodyStream(abs, undefined, fs), {
      status: 200,
      headers: {
        "Content-Type": type,
        "Content-Length": String(size),
        "Accept-Ranges": "bytes",
      },
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || (!match[1] && !match[2])) {
    return new Response("Range Not Satisfiable", {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!match[1]) {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  }
  if (start > end || start >= size) {
    return new Response("Range Not Satisfiable", {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }
  end = Math.min(end, size - 1);
  const chunkSize = end - start + 1;
  return new Response(bodyStream(abs, { start, end }, fs), {
    status: 206,
    headers: {
      "Content-Type": type,
      "Content-Length": String(chunkSize),
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
    },
  });
}

/** Must be called BEFORE app `ready`. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      // No bypassCSP: the app does not ship a CSP that requires it.
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

/** Must be called AFTER app `ready`. */
export function handleMediaProtocol(
  policy: MediaPathPolicy = defaultMediaPathPolicy(),
  fs: MediaProtocolFs = defaultFs,
): void {
  protocol.handle(SCHEME, async (request) => {
    try {
      const resolved = await resolveMediaRequest(request.url, policy, fs);
      if (!resolved.ok) {
        return new Response(resolved.status === 403 ? "Forbidden" : "Not found", {
          status: resolved.status,
        });
      }
      const rangeHeader = request.headers.get("Range");
      return rangeResponse(
        resolved.absolutePath,
        resolved.size,
        resolved.contentType,
        rangeHeader,
        fs,
      );
    } catch (error) {
      log.warn({ err: error }, "media request failed; returning 404");
      return new Response("Not found", { status: 404 });
    }
  });
}

/** @deprecated Prefer defaultMediaPathPolicy; kept for narrow test call sites. */
export function defaultMediaRoots(): string[] {
  const policy = defaultMediaPathPolicy();
  return [policy.videoToolHome, policy.bundledAssetsRoot];
}
