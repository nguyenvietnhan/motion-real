import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importImageBytes, sniffImage, MAX_IMAGE_BYTES, MAX_IMAGE_DIM } from "./import-image.js";
import { encodePngRGBA } from "../safety/png.js";

/**
 * Importer self-tests (create-time image staging). The importer is the trust boundary for
 * user-picked bytes: it must sniff the real format by magic bytes, enforce the
 * caps, write content-addressed, and NEVER throw (every failure is a typed
 * reason). Content-addressing is what keeps the render cache from serving a
 * stale MP4, so the idempotent same-bytes→same-ref property is load-bearing.
 */

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "news-import-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A real, decodable PNG of the given size (filled opaque). */
function png(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4).fill(200);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255; // opaque alpha
  return new Uint8Array(encodePngRGBA(width, height, rgba));
}

/** Minimal valid JPEG (SOI + APP0 + SOF0 frame header + EOI) with given dims. */
function jpeg(width: number, height: number): Uint8Array {
  const sof = [
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ];
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, ...sof, 0xff, 0xd9]);
}

/** GIF89a header with the given logical-screen size. It is intentionally unsupported. */
function gif(width: number, height: number): Uint8Array {
  return new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, width & 0xff, (width >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff, 0x00, 0x00, 0x00]);
}

describe("sniffImage", () => {
  it("detects supported still raster formats by magic bytes, not extension", () => {
    expect(sniffImage(png(4, 4))?.ext).toBe("png");
    expect(sniffImage(jpeg(4, 4))?.ext).toBe("jpg");
    expect(sniffImage(gif(4, 4))).toBeNull();
  });
  it("rejects non-raster / scriptable content (SVG, plain text)", () => {
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='...'></svg>"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("hello"))).toBeNull();
  });
});

describe("importImageBytes", () => {
  it("imports a PNG content-addressed and returns its real dimensions", async () => {
    const res = await importImageBytes(png(16, 24), dir);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.ext).toBe("png");
      expect(res.width).toBe(16);
      expect(res.height).toBe(24);
      expect(res.ref).toBe(`assets/${res.sha}.png`);
      expect(existsSync(join(dir, `${res.sha}.png`))).toBe(true);
    }
  });

  it("uses the SNIFFED type for the extension, so a mislabeled file is stored correctly", async () => {
    // Bytes are really a JPEG; the importer must store `.jpg` regardless of any
    // (absent) filename — the ref then still passes the schema raster-ext regex.
    const res = await importImageBytes(jpeg(8, 8), dir);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.ext).toBe("jpg");
  });

  it("is idempotent: identical bytes → identical ref (content-addressed)", async () => {
    const bytes = png(10, 10);
    const a = await importImageBytes(bytes, dir);
    const b = await importImageBytes(bytes, dir);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.ref).toBe(b.ref);
    // Only one file written for the two imports of the same bytes.
    expect((await readdir(dir)).length).toBe(1);
  });

  it("returns a typed reason (never throws) for each failure mode", async () => {
    expect(await importImageBytes(new Uint8Array(0), dir)).toEqual({ ok: false, reason: "empty" });
    expect(await importImageBytes(new TextEncoder().encode("<svg/>"), dir)).toEqual({ ok: false, reason: "unsupported-format" });

    const tooBig = new Uint8Array(MAX_IMAGE_BYTES + 1);
    tooBig.set(png(2, 2)); // valid magic, but over the byte cap
    expect(await importImageBytes(tooBig, dir)).toEqual({ ok: false, reason: "too-large" });

    const huge = await importImageBytes(png(MAX_IMAGE_DIM + 1, 8), dir);
    expect(huge).toEqual({ ok: false, reason: "dimensions-too-large" });

    expect(await importImageBytes(gif(8, 8), dir)).toEqual({ ok: false, reason: "unsupported-format" });
  });

  it("rejects small inputs before they enter the asset store", async () => {
    expect(await importImageBytes(png(64, 64), dir, { minEdge: 200 })).toEqual({
      ok: false,
      reason: "dimensions-too-small",
    });
    expect(await readdir(dir)).toEqual([]);
  });

  it("supports a custom refPrefix for staging imports", async () => {
    const res = await importImageBytes(png(4, 4), dir, { refPrefix: "staging" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.ref.startsWith("staging/")).toBe(true);
  });
});
