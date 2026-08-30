import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Local image importer (create-time image staging). Takes raw image bytes the user picked
 * and stores them CONTENT-ADDRESSED (`<destDir>/<sha256>.<ext>`), returning a
 * project-relative `ref` the AI may place on a scene's `image` field.
 *
 * Why content-addressed: the render cache keys on the locked spec + authored
 * source, NOT on image bytes. A stable human filename could serve a STALE MP4
 * after the bytes under it changed. Keying the filename by `sha256(bytes)` makes
 * a byte change a new ref → a new specHash → a cache miss, so the render is never
 * stale. Identical bytes resolve to the identical path (idempotent re-import).
 *
 * The importer is PURE + TOTAL: every failure is a typed `{ ok: false; reason }`,
 * never a throw, so a single bad pick never crashes the picker. Format is decided
 * by MAGIC BYTES (not the file extension), so a mislabeled `.png` that is really
 * a JPEG is stored with the correct `.jpg` extension and still passes the schema
 * `ref` regex. SVG and animated raster formats are rejected because the renderer
 * expects deterministic still imagery.
 */

/** Per-image byte cap (10 MB). Guards memory + keeps the bundle/render sane. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Per-image dimension cap (4096²). Guards a decompression bomb on the canvas. */
export const MAX_IMAGE_DIM = 4096;

export type ImportError =
  | "empty"
  | "unsupported-format"
  | "animated-format"
  | "too-large"
  | "dimensions-too-small"
  | "dimensions-too-large"
  | "decode-failed";

export type ImportResult =
  | { ok: true; ref: string; sha: string; ext: ImageExt; width: number; height: number; bytes: number }
  | { ok: false; reason: ImportError };

type ImageExt = "png" | "jpg" | "webp";

type Sniffed = { ext: ImageExt; dims: { width: number; height: number } | null };

/**
 * Import raw bytes into `destDir` as `<sha>.<ext>`. Idempotent: identical bytes
 * map to the identical path and the existing file is left untouched. Returns the
 * project-relative `ref` (`assets/<sha>.<ext>`) — relative to the project root,
 * the same shape the schema `ref` refinement + `staticFile` expect — using
 * `refPrefix` (default "assets") so a staging import can return `staging/...`.
 */
export async function importImageBytes(
  bytes: Uint8Array,
  destDir: string,
  opts: { refPrefix?: string; minEdge?: number } = {},
): Promise<ImportResult> {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: "too-large" };

  if (isAnimatedPng(bytes) || isAnimatedWebp(bytes)) return { ok: false, reason: "animated-format" };
  const sniffed = sniffImage(bytes);
  if (!sniffed) return { ok: false, reason: "unsupported-format" };

  // Dimensions are best-effort per format; a header we can't parse is a decode
  // failure (we won't ship an image we can't size against the safe-area caps).
  if (!sniffed.dims) return { ok: false, reason: "decode-failed" };
  const { width, height } = sniffed.dims;
  if (width <= 0 || height <= 0) return { ok: false, reason: "decode-failed" };
  if (width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) return { ok: false, reason: "dimensions-too-large" };
  if (opts.minEdge !== undefined && (width < opts.minEdge || height < opts.minEdge)) {
    return { ok: false, reason: "dimensions-too-small" };
  }

  const sha = createHash("sha256").update(bytes).digest("hex");
  const ext = sniffed.ext;
  const fileName = `${sha}.${ext}`;
  const abs = join(destDir, fileName);
  const prefix = opts.refPrefix ?? "assets";

  // Idempotent: identical bytes → identical path. Skip the rewrite when a
  // non-empty file already sits there (same sha ⇒ same bytes).
  if (!(existsSync(abs) && safeSize(abs) > 0)) {
    await mkdir(destDir, { recursive: true });
    await writeFile(abs, bytes);
  }

  return { ok: true, ref: `${prefix}/${fileName}`, sha, ext, width, height, bytes: bytes.length };
}

/** Sniff the raster format by leading magic bytes + read its pixel dimensions. */
export function sniffImage(b: Uint8Array): Sniffed | null {
  if (isPng(b)) return { ext: "png", dims: pngDims(b) };
  if (isJpeg(b)) return { ext: "jpg", dims: jpegDims(b) };
  if (isWebp(b)) return { ext: "webp", dims: webpDims(b) };
  return null;
}

// --- magic-byte detectors --------------------------------------------------

function isPng(b: Uint8Array): boolean {
  return b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;
}
function isJpeg(b: Uint8Array): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}
function isWebp(b: Uint8Array): boolean {
  return (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // "RIFF"
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // "WEBP"
  );
}

// --- per-format dimension readers (no external dependency) -----------------

/** PNG: IHDR width/height are the first chunk, big-endian at bytes 16/20. */
function pngDims(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 24) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

/** JPEG: scan segment markers to the first SOFn frame header (FFC0..FFCF, skipping non-frame). */
function jpegDims(b: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let off = 2; // skip the SOI (FFD8)
  while (off + 9 < b.length) {
    if (b[off] !== 0xff) {
      off += 1; // resync to the next marker byte
      continue;
    }
    const marker = b[off + 1]!;
    // Standalone markers (no length): padding (FF), RSTn (D0..D7), SOI/EOI.
    if (marker === 0xff) {
      off += 1;
      continue;
    }
    const len = dv.getUint16(off + 2);
    if (len < 2) return null;
    // SOF0..SOF15 carry the frame size, EXCEPT DHT(C4)/DAC(CC)/RSTn — exclude those.
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      // SOF payload: [precision:1][height:2][width:2] starting at off+4.
      return { height: dv.getUint16(off + 5), width: dv.getUint16(off + 7) };
    }
    off += 2 + len;
  }
  return null;
}

/** WebP: VP8 (lossy), VP8L (lossless), and VP8X (extended) each carry size differently. */
function webpDims(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const fourcc = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (fourcc === "VP8 ") {
    // Lossy: 16-bit width/height (14 bits used) at the frame header off 26/28.
    return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
  }
  if (fourcc === "VP8L") {
    // Lossless: 14-bit width-1 / height-1 packed after the 0x2f signature byte.
    const bits = dv.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fourcc === "VP8X") {
    // Extended: 24-bit canvas width-1 / height-1 little-endian at off 24/27.
    const w = (b[24]! | (b[25]! << 8) | (b[26]! << 16)) + 1;
    const h = (b[27]! | (b[28]! << 8) | (b[29]! << 16)) + 1;
    return { width: w, height: h };
  }
  return null;
}

function isAnimatedPng(b: Uint8Array): boolean {
  if (!isPng(b)) return false;
  for (let offset = 8; offset + 12 <= b.length;) {
    const length = new DataView(b.buffer, b.byteOffset + offset, 4).getUint32(0);
    if (offset + 12 + length > b.length) return false;
    if (String.fromCharCode(b[offset + 4]!, b[offset + 5]!, b[offset + 6]!, b[offset + 7]!) === "acTL") return true;
    offset += 12 + length;
  }
  return false;
}

function isAnimatedWebp(b: Uint8Array): boolean {
  if (!isWebp(b)) return false;
  for (let offset = 12; offset + 8 <= b.length;) {
    const type = String.fromCharCode(b[offset]!, b[offset + 1]!, b[offset + 2]!, b[offset + 3]!);
    const length = new DataView(b.buffer, b.byteOffset + offset + 4, 4).getUint32(0, true);
    if (type === "ANIM" || type === "ANMF") return true;
    const padded = length + (length & 1);
    if (offset + 8 + padded > b.length) return false;
    offset += 8 + padded;
  }
  return false;
}

function safeSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
