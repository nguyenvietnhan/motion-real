import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { decodePng, encodePngRGBA, PngFilter, type PngFilterType } from "./png.js";

/**
 * PNG codec tests: round-trip RGBA through every scanline filter (exercising the
 * decoder's un-filter paths), decode a hand-built RGB (type 2) image (the
 * RGB→RGBA expansion), and reject unsupported color types. No image library is
 * used — fixtures are built with node:zlib only.
 */

function gradientRGBA(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = (x * 37 + y * 11) & 0xff;
      data[i + 1] = (x * 5 + y * 53) & 0xff;
      data[i + 2] = (x * 97 + y * 3) & 0xff;
      data[i + 3] = 255;
    }
  }
  return data;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Build a type-2 (RGB) or arbitrary-colorType PNG with filter 0 rows. */
function buildPng(width: number, height: number, colorType: number, channels: number, pixels: Uint8Array): Buffer {
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter None
    for (let x = 0; x < stride; x += 1) raw[y * (stride + 1) + 1 + x] = pixels[y * stride + x]!;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([SIG, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

describe("decodePng / encodePngRGBA", () => {
  for (const [name, filter] of Object.entries(PngFilter) as Array<[string, PngFilterType]>) {
    it(`round-trips RGBA through the ${name} filter`, () => {
      const width = 5;
      const height = 4;
      const src = gradientRGBA(width, height);
      const png = encodePngRGBA(width, height, src, filter);
      const decoded = decodePng(png);
      expect(decoded.width).toBe(width);
      expect(decoded.height).toBe(height);
      expect(Array.from(decoded.data)).toEqual(Array.from(src));
    });
  }

  it("decodes a truecolor (type 2, RGB) PNG and expands to RGBA", () => {
    const width = 3;
    const height = 2;
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0; i < rgb.length; i += 1) rgb[i] = (i * 17) & 0xff;
    const png = buildPng(width, height, 2, 3, rgb);
    const decoded = decodePng(png);
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    // RGB preserved, alpha forced to 255.
    for (let p = 0; p < width * height; p += 1) {
      expect(decoded.data[p * 4]).toBe(rgb[p * 3]);
      expect(decoded.data[p * 4 + 1]).toBe(rgb[p * 3 + 1]);
      expect(decoded.data[p * 4 + 2]).toBe(rgb[p * 3 + 2]);
      expect(decoded.data[p * 4 + 3]).toBe(255);
    }
  });

  it("rejects an unsupported color type (grayscale, type 0)", () => {
    const png = buildPng(2, 2, 0, 1, new Uint8Array([0, 64, 128, 255]));
    expect(() => decodePng(png)).toThrow(/color type/i);
  });

  it("rejects a non-PNG buffer", () => {
    expect(() => decodePng(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/signature/i);
  });
});
