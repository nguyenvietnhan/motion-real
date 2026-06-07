import { net, protocol } from "electron";
import { pathToFileURL } from "node:url";

/**
 * Local-file protocol (web-dashboard B7). The renderer runs on an http(s)/file
 * origin, so raw `file://` paths to stills/MP4s under `.video-tool` won't load.
 * We register a privileged `media://` scheme and serve files through it, so
 * `<img src>` / `<video src>` can show generated artifacts. `mediaUrl(absPath)`
 * builds the URL; `media://file/<encoded-abs-path>`.
 */

const SCHEME = "media";

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
  protocol.handle(SCHEME, (request) => {
    try {
      const encoded = new URL(request.url).pathname.replace(/^\//, "");
      const abs = decodeURIComponent(encoded);
      return net.fetch(pathToFileURL(abs).toString());
    } catch {
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
