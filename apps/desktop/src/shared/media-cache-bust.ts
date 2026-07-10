/**
 * Client-side cache-bust for media URLs (especially `media://`).
 *
 * The media protocol rejects query strings (403). Storyboard stills and cover
 * previews must append a fragment `#rN` only — never `?t=`.
 */
export function withMediaCacheBust(url: string, token: string | number): string {
  const bare = url.split("#")[0] || url;
  return `${bare}#r${token}`;
}
