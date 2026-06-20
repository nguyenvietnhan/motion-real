import { protocol } from "electron";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { createLogger, videoToolHome } from "@news/pipeline";

const log = createLogger("media");

/**
 * Local-file protocol (web-dashboard B7). The renderer runs on an http(s)/file
 * origin, so raw `file://` paths to stills/MP4s under `.video-tool` won't load.
 * We register a privileged `media://` scheme and serve files through it, so
 * `<img src>` / `<video src>` can show generated artifacts. `mediaUrl(absPath)`
 * builds the URL; `media://file/<encoded-abs-path>`.
 *
 * The handler answers HTTP Range requests (206 Partial Content). This is what
 * makes the `<video>` seekbar work: a browser seeks by re-requesting a byte
 * range, and a plain 200 full-file response (Electron's `net.fetch(file://…)`)
 * leaves seeking dead — the user can only play straight through. Serving ranges
 * from fs read-streams restores scrubbing on both the draft and the final MP4.
 */

const SCHEME = "media";

/** Minimal extension→MIME map for the artifacts we serve (videos + stills). */
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

function contentType(abs: string): string {
  return MIME[extname(abs).toLowerCase()] ?? "application/octet-stream";
}

/** A Node fs read-stream as a web ReadableStream the Response body accepts. */
function bodyStream(abs: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  const node = range ? createReadStream(abs, { start: range.start, end: range.end }) : createReadStream(abs);
  return Readable.toWeb(node) as ReadableStream<Uint8Array>;
}

/** Must be called BEFORE app `ready`. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true },
    },
  ]);
}

/** Must be called AFTER app `ready`. */
export function handleMediaProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    try {
      const encoded = new URL(request.url).pathname.replace(/^\//, "");
      const requested = decodeURIComponent(encoded);
      // Containment: only serve files under the .video-tool home — never an
      // arbitrary absolute path (defense-in-depth against a crafted media:// URL).
      // A raw `startsWith` on the un-normalized string is bypassable: a URL like
      // `media://file/<home>/../../Windows/win.ini` literally starts with `<home>`
      // yet `createReadStream` resolves the `..` at the fs layer and reads outside
      // the sandbox. So resolve BOTH paths and compare via `path.relative` — if the
      // target sits outside root, the relative path starts with `..` (or is an
      // absolute path on another drive), and we refuse.
      const abs = resolve(requested);
      const root = resolve(videoToolHome());
      const rel = relative(root, abs);
      const contained = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
      if (!contained) {
        return new Response("Forbidden", { status: 403 });
      }

      const size = (await stat(abs)).size;
      const type = contentType(abs);
      const rangeHeader = request.headers.get("Range");

      // No Range: serve the whole file but advertise `Accept-Ranges` so the
      // <video> element enables its seekbar (it then re-requests byte ranges).
      if (!rangeHeader) {
        return new Response(bodyStream(abs), {
          status: 200,
          headers: { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes" },
        });
      }

      // Parse "bytes=start-end" (either end optional; "bytes=-N" = last N bytes).
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (!match || (!match[1] && !match[2])) {
        return new Response("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }
      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Number(match[2]) : size - 1;
      if (!match[1]) {
        // Suffix range: the last `match[2]` bytes.
        start = Math.max(0, size - Number(match[2]));
        end = size - 1;
      }
      if (start > end || start >= size) {
        return new Response("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }
      end = Math.min(end, size - 1);
      const chunkSize = end - start + 1;
      return new Response(bodyStream(abs, { start, end }), {
        status: 206,
        headers: {
          "Content-Type": type,
          "Content-Length": String(chunkSize),
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
        },
      });
    } catch (error) {
      log.warn({ err: error }, "media request failed; returning 404");
      return new Response("Not found", { status: 404 });
    }
  });
}

/** Build a `media://` URL for an absolute filesystem path (or pass through null). */
export function mediaUrl(absPath: string | null | undefined): string | null {
  if (!absPath) return null;
  const normalized = absPath.replace(/\\/g, "/");
  return `${SCHEME}://file/${encodeURIComponent(normalized)}`;
}
