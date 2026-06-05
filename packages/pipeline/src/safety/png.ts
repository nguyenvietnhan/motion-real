import { deflateSync, inflateSync } from "node:zlib";

/**
 * Minimal, dependency-free PNG codec for the render-tier oracles (Tier 3). The
 * render oracles need raw pixels to inspect rendered frames, but the workspace
 * ships no image library (sharp/pngjs are not installed), so this implements
 * just enough of the PNG spec to decode the frames Chromium/Remotion emit:
 * 8-bit, non-interlaced, truecolor (type 2, RGB) and truecolor-with-alpha
 * (type 6, RGBA). Everything is normalized to RGBA (4 bytes/pixel).
 *
 * `encodePngRGBA` is the inverse, used by the oracle self-tests to build small
 * known fixtures (and to exercise every scanline filter on the round trip). CRC
 * is computed so the output is a spec-valid PNG; the decoder does not validate
 * CRC (it is lenient by design, since we only ever read our own renders).
 */

export type DecodedImage = { width: number; height: number; data: Uint8Array };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** PNG scanline filter types (per the spec). */
export const PngFilter = {
  None: 0,
  Sub: 1,
  Up: 2,
  Average: 3,
  Paeth: 4,
} as const;
export type PngFilterType = (typeof PngFilter)[keyof typeof PngFilter];

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Decode a PNG buffer into normalized RGBA pixels. */
export function decodePng(buf: Buffer): DecodedImage {
  for (let i = 0; i < 8; i += 1) {
    if (buf[i] !== PNG_SIGNATURE[i]) throw new Error("Not a PNG file (bad signature).");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let sawIHDR = false;
  const idat: Buffer[] = [];

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const data = buf.subarray(dataStart, dataStart + length);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
      sawIHDR = true;
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }

    offset = dataStart + length + 4; // advance past data + 4-byte CRC
  }

  if (!sawIHDR) throw new Error("PNG is missing its IHDR header.");
  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth} (only 8 is supported).`);
  if (interlace !== 0) throw new Error("Interlaced PNGs are not supported.");
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`Unsupported PNG color type ${colorType} (only 2 RGB and 6 RGBA are supported).`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const expected = (stride + 1) * height;
  if (raw.length < expected) {
    throw new Error(`PNG pixel data too short: expected ${expected} bytes, got ${raw.length}.`);
  }

  const unfiltered = new Uint8Array(height * stride);
  const bpp = channels;
  for (let y = 0; y < height; y += 1) {
    const filterType = raw[y * (stride + 1)]!;
    const rowStart = y * (stride + 1) + 1;
    const outStart = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const rawByte = raw[rowStart + x]!;
      const left = x >= bpp ? unfiltered[outStart + x - bpp]! : 0;
      const up = y > 0 ? unfiltered[outStart - stride + x]! : 0;
      const upLeft = x >= bpp && y > 0 ? unfiltered[outStart - stride + x - bpp]! : 0;
      let value: number;
      switch (filterType) {
        case PngFilter.None:
          value = rawByte;
          break;
        case PngFilter.Sub:
          value = rawByte + left;
          break;
        case PngFilter.Up:
          value = rawByte + up;
          break;
        case PngFilter.Average:
          value = rawByte + Math.floor((left + up) / 2);
          break;
        case PngFilter.Paeth:
          value = rawByte + paethPredictor(left, up, upLeft);
          break;
        default:
          throw new Error(`Unsupported PNG scanline filter ${filterType}.`);
      }
      unfiltered[outStart + x] = value & 0xff;
    }
  }

  if (channels === 4) return { width, height, data: unfiltered };

  // Expand RGB → RGBA.
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p += 1) {
    rgba[p * 4] = unfiltered[p * 3]!;
    rgba[p * 4 + 1] = unfiltered[p * 3 + 1]!;
    rgba[p * 4 + 2] = unfiltered[p * 3 + 2]!;
    rgba[p * 4 + 3] = 255;
  }
  return { width, height, data: rgba };
}

// --- encoder (used by self-tests / fixtures) ------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * Encode RGBA pixels into a valid 8-bit truecolor-alpha PNG, applying the given
 * scanline filter to every row. Round-tripping with each filter type is how the
 * decoder's un-filter paths are exercised in tests.
 */
export function encodePngRGBA(
  width: number,
  height: number,
  rgba: Uint8Array,
  filterType: PngFilterType = PngFilter.None,
): Buffer {
  const channels = 4;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rowOut = y * (stride + 1);
    raw[rowOut] = filterType;
    for (let x = 0; x < stride; x += 1) {
      const value = rgba[y * stride + x]!;
      const left = x >= channels ? rgba[y * stride + x - channels]! : 0;
      const up = y > 0 ? rgba[(y - 1) * stride + x]! : 0;
      const upLeft = x >= channels && y > 0 ? rgba[(y - 1) * stride + x - channels]! : 0;
      let filtered: number;
      switch (filterType) {
        case PngFilter.None:
          filtered = value;
          break;
        case PngFilter.Sub:
          filtered = value - left;
          break;
        case PngFilter.Up:
          filtered = value - up;
          break;
        case PngFilter.Average:
          filtered = value - Math.floor((left + up) / 2);
          break;
        case PngFilter.Paeth:
          filtered = value - paethPredictor(left, up, upLeft);
          break;
        default:
          throw new Error(`Unsupported filter ${filterType}.`);
      }
      raw[rowOut + 1 + x] = filtered & 0xff;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
