import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestUrl, type FetchLike } from "./url-ingest.js";
import { isPipelineError } from "../errors.js";
import { planningDir } from "../store/store.js";

// Feature: tool-productization — URL ingest into grounded research files (R2).

let home: string;
const prevHome = process.env.VIDEO_TOOL_HOME;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "news-ingest-"));
  process.env.VIDEO_TOOL_HOME = join(home, ".video-tool");
});

afterEach(async () => {
  process.env.VIDEO_TOOL_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
});

/** A fetch stub that returns the given HTML with a 200 status. */
function okFetch(html: string): FetchLike {
  return async () => ({ ok: true, status: 200, text: async () => html });
}

/** Build a minimal article HTML page with optional meta tags + body paragraphs. */
function articleHtml(opts: {
  title?: string;
  site?: string;
  author?: string;
  published?: string;
  paragraphs: string[];
  extraHead?: string;
  bodyExtra?: string;
}): string {
  const head: string[] = [];
  if (opts.title) head.push(`<meta property="og:title" content="${opts.title}" />`);
  if (opts.site) head.push(`<meta property="og:site_name" content="${opts.site}" />`);
  if (opts.author) head.push(`<meta name="author" content="${opts.author}" />`);
  if (opts.published) head.push(`<meta property="article:published_time" content="${opts.published}" />`);
  if (opts.extraHead) head.push(opts.extraHead);
  const paras = opts.paragraphs.map((p) => `<p>${p}</p>`).join("\n");
  return `<!doctype html><html><head><title>${opts.title ?? "Untitled"}</title>${head.join(
    "\n",
  )}</head><body><article><h1>${opts.title ?? "Untitled"}</h1>${paras}${opts.bodyExtra ?? ""}</article></body></html>`;
}

/** A body long enough for Readability to treat it as the main article. */
function longBody(seed: string): string[] {
  const sentence = `${seed} day la mot doan van ban du dai de Readability nhan dien la noi dung chinh cua bai bao.`;
  return Array.from({ length: 8 }, (_, i) => `${sentence} Cau so ${i + 1}: ${seed} ${seed} ${seed}.`);
}

/** Read a YAML header scalar from the research file, decoding the JSON-quoted form. */
function readHeaderField(file: string, key: string): string | undefined {
  for (const line of file.split("\n")) {
    const prefix = `${key}: `;
    if (line.startsWith(prefix)) {
      const raw = line.slice(prefix.length);
      return raw.startsWith('"') ? (JSON.parse(raw) as string) : raw;
    }
  }
  return undefined;
}

describe("ingestUrl — Property 5: extraction and provenance fidelity", () => {
  it("round-trips source URL, fetchedAt, and every present metadata field, with non-empty text", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          title: fc.string({ minLength: 3, maxLength: 40 }).map((s) => s.replace(/["<>&]/g, "")).filter((s) => s.trim().length >= 3),
          site: fc.string({ minLength: 2, maxLength: 20 }).map((s) => s.replace(/["<>&]/g, "")).filter((s) => s.trim().length >= 2),
          author: fc.string({ minLength: 2, maxLength: 20 }).map((s) => s.replace(/["<>&]/g, "")).filter((s) => s.trim().length >= 2),
          published: fc.constant("2026-06-07T12:00:00Z"),
          seed: fc.string({ minLength: 3, maxLength: 8 }).map((s) => s.replace(/[^a-zA-Z]/g, "x") || "seed"),
        }),
        async ({ title, site, author, published, seed }) => {
          const html = articleHtml({ title, site, author, published, paragraphs: longBody(seed) });
          const fetchedAt = "2026-06-07T00:00:00.000Z";
          const result = await ingestUrl("https://example.com/news/story", {
            fetchImpl: okFetch(html),
            now: () => fetchedAt,
          });

          expect(result.wordCount).toBeGreaterThan(0);
          // Meta-tag fields are read directly (not via Readability), so they
          // round-trip the source exactly.
          expect(result.metadata.sourceUrl).toBe("https://example.com/news/story");
          expect(result.metadata.fetchedAt).toBe(fetchedAt);
          expect(result.metadata.site).toBe(site.trim());
          expect(result.metadata.author).toBe(author.trim());
          expect(result.metadata.publishedDate).toBe(published);
          expect((result.metadata.title ?? "").length).toBeGreaterThan(0);

          const file = await readFile(result.researchPath, "utf8");
          // Serialization fidelity: every metadata field the result carries is
          // faithfully written into the header (decoding the JSON-quoted form
          // used for values with YAML-special chars), not a fragile substring.
          expect(readHeaderField(file, "sourceUrl")).toBe(result.metadata.sourceUrl);
          expect(readHeaderField(file, "fetchedAt")).toBe(result.metadata.fetchedAt);
          expect(readHeaderField(file, "title")).toBe(result.metadata.title);
          expect(readHeaderField(file, "site")).toBe(result.metadata.site);
          expect(readHeaderField(file, "author")).toBe(result.metadata.author);
          expect(readHeaderField(file, "publishedDate")).toBe(result.metadata.publishedDate);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("ingestUrl — Property 6: text and metadata only (no media)", () => {
  it("never writes image/media URLs or asset references even when the page is media-heavy", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          seed: fc.string({ minLength: 3, maxLength: 8 }).map((s) => s.replace(/[^a-zA-Z]/g, "x") || "seed"),
          imgHost: fc.constantFrom("cdn.example.com", "images.test", "media.site"),
        }),
        async ({ seed, imgHost }) => {
          const mediaUrl = `https://${imgHost}/photo-${seed}.jpg`;
          const bodyExtra = [
            `<img src="${mediaUrl}" alt="lead photo" />`,
            `<video src="https://${imgHost}/clip-${seed}.mp4"></video>`,
            `<img src="data:image/png;base64,iVBORw0KGgoAAAANSU" />`,
            `<picture><source srcset="https://${imgHost}/pic.webp" /></picture>`,
          ].join("");
          const extraHead = `<meta property="og:image" content="https://${imgHost}/og-${seed}.png" />`;
          const html = articleHtml({
            title: `Story ${seed}`,
            paragraphs: longBody(seed),
            bodyExtra,
            extraHead,
          });
          const result = await ingestUrl("https://example.com/a", { fetchImpl: okFetch(html) });
          const file = await readFile(result.researchPath, "utf8");

          // No media URLs, asset refs, data URIs, or media markup survive.
          expect(file).not.toContain(imgHost);
          expect(file).not.toContain(".jpg");
          expect(file).not.toContain(".mp4");
          expect(file).not.toContain(".webp");
          expect(file).not.toContain(".png");
          expect(file).not.toContain("data:image");
          expect(file).not.toMatch(/<img|<video|<picture|srcset|assetRef/i);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("ingestUrl — Property 7: failed ingest leaves no partial file", () => {
  it("throws PipelineError(ingest) and writes no file on fetch failure or empty extraction", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          mode: fc.constantFrom<"non2xx" | "network" | "empty">("non2xx", "network", "empty"),
          status: fc.integer({ min: 400, max: 599 }),
          id: fc.string({ minLength: 1, maxLength: 12 }).map((s) => s.replace(/[^a-zA-Z0-9]/g, "x") || "id"),
        }),
        async ({ mode, status, id }) => {
          let fetchImpl: FetchLike;
          if (mode === "non2xx") {
            fetchImpl = async () => ({ ok: false, status, text: async () => "<html></html>" });
          } else if (mode === "network") {
            fetchImpl = async () => {
              throw new Error("ECONNREFUSED");
            };
          } else {
            // Successful fetch but no extractable article body.
            fetchImpl = okFetch("<!doctype html><html><head><title>x</title></head><body></body></html>");
          }

          let threw = false;
          try {
            await ingestUrl("https://example.com/fail", { id, fetchImpl });
          } catch (err) {
            threw = true;
            expect(isPipelineError(err)).toBe(true);
            if (isPipelineError(err)) {
              expect(err.stage).toBe("ingest");
              expect(err.message).toContain("https://example.com/fail");
            }
          }
          expect(threw).toBe(true);
          // No research file (partial or empty) was written.
          const dir = planningDir();
          if (existsSync(dir)) {
            const entries = await readdir(dir);
            expect(entries).toEqual([]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("ingestUrl — evidence-gate interaction (R2.5)", () => {
  it("writes research as an input artifact under planning/, not into any render path", async () => {
    const html = articleHtml({ title: "Hard facts", site: "Test Wire", paragraphs: longBody("evidence") });
    const result = await ingestUrl("https://example.com/facts", { id: "facts", fetchImpl: okFetch(html) });

    // The file lives under planning/ (resolved under VIDEO_TOOL_HOME), never repo root.
    expect(result.researchPath).toBe(join(planningDir(), "facts.md"));
    expect(result.researchPath.startsWith(planningDir())).toBe(true);
    expect(existsSync(result.researchPath)).toBe(true);

    // Nothing here registers a scene or feeds the render path: ingest only
    // produces a planning input. The N9 evidence gate still governs what reaches
    // the screen — facts here are not auto-promoted to render input.
    const file = await readFile(result.researchPath, "utf8");
    expect(file).toContain("# Hard facts");
    expect(file).toContain("sourceUrl:");
  });

  it("derives a slug id from the title when none is supplied", async () => {
    const html = articleHtml({ title: "Giá chip AI tăng vọt", paragraphs: longBody("chip") });
    const result = await ingestUrl("https://example.com/chip", { fetchImpl: okFetch(html) });
    expect(result.id).toMatch(/^[a-z0-9-]+$/);
    expect(result.id.startsWith("gia-chip-ai")).toBe(true);
  });
});
