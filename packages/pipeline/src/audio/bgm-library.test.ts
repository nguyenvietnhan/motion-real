import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addBgmTrack,
  bgmLibraryDir,
  ensureBgmTrack,
  listBgmTracks,
  removeBgmTrack,
  resolveBgmTrack,
} from "./bgm-library.js";

/**
 * BGM library (I2/O4): a per-machine flat audio dir shared by every project; a
 * project stores only the chosen filename. These guard the CRUD surface + the
 * traversal chokepoint (a crafted name must never escape the library dir) and
 * the render-time resolve (a stale ref to a deleted track ⇒ no BGM, never throw).
 */

let home: string;
const prevHome = process.env.VIDEO_TOOL_HOME;
let srcDir: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "news-bgm-"));
  process.env.VIDEO_TOOL_HOME = join(home, ".video-tool");
  srcDir = await mkdtemp(join(tmpdir(), "news-bgm-src-"));
});

afterEach(async () => {
  process.env.VIDEO_TOOL_HOME = prevHome;
  await rm(home, { recursive: true, force: true });
  await rm(srcDir, { recursive: true, force: true });
});

/** Write a fake audio file of a few bytes and return its absolute path. */
async function fakeAudio(name: string, bytes = 16): Promise<string> {
  const p = join(srcDir, name);
  await writeFile(p, Buffer.alloc(bytes, 1));
  return p;
}

describe("BGM library", () => {
  it("is empty when the library dir does not exist yet", async () => {
    expect(await listBgmTracks()).toEqual([]);
  });

  it("adds a picked file into the library and lists it", async () => {
    const src = await fakeAudio("nhac nen.mp3", 100);
    const track = await addBgmTrack(src);
    expect(track.name).toBe("nhac nen.mp3");
    expect(track.sizeBytes).toBe(100);
    expect(existsSync(join(bgmLibraryDir(), "nhac nen.mp3"))).toBe(true);
    const list = await listBgmTracks();
    expect(list.map((t) => t.name)).toEqual(["nhac nen.mp3"]);
  });

  it("rejects an unsupported extension", async () => {
    const src = await fakeAudio("clip.ogg");
    await expect(addBgmTrack(src)).rejects.toThrow(/Unsupported BGM format/);
  });

  it("suffixes a colliding name instead of overwriting", async () => {
    await addBgmTrack(await fakeAudio("song.mp3", 10));
    await addBgmTrack(await fakeAudio("song.mp3", 20));
    const names = (await listBgmTracks()).map((t) => t.name).sort();
    expect(names).toEqual(["song-1.mp3", "song.mp3"]);
  });

  it("seeds a bundled track under a stable name without duplicating it", async () => {
    const src = await fakeAudio("default.mp3", 24);
    const first = await ensureBgmTrack(src, "nhac-nen-mac-dinh.mp3");
    await writeFile(src, Buffer.alloc(48, 2));
    const second = await ensureBgmTrack(src, "nhac-nen-mac-dinh.mp3");

    expect(first.name).toBe("nhac-nen-mac-dinh.mp3");
    expect(second.sizeBytes).toBe(24);
    expect((await listBgmTracks()).map((track) => track.name)).toEqual(["nhac-nen-mac-dinh.mp3"]);
  });

  it("removes a track by name", async () => {
    await addBgmTrack(await fakeAudio("drop.wav"));
    expect((await listBgmTracks()).length).toBe(1);
    await removeBgmTrack("drop.wav");
    expect((await listBgmTracks()).length).toBe(0);
  });

  it("ignores non-audio files in the library dir", async () => {
    const dir = bgmLibraryDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "notes.txt"), "x");
    await addBgmTrack(await fakeAudio("real.mp3"));
    expect((await listBgmTracks()).map((t) => t.name)).toEqual(["real.mp3"]);
  });

  it("resolveBgmTrack returns the absolute path for an existing track, undefined otherwise", async () => {
    const track = await addBgmTrack(await fakeAudio("bg.mp3"));
    expect(resolveBgmTrack("bg.mp3")).toBe(track.path);
    // Empty/absent ⇒ no BGM (the common no-music case).
    expect(resolveBgmTrack(undefined)).toBeUndefined();
    expect(resolveBgmTrack("")).toBeUndefined();
    // A stale ref to a deleted track ⇒ undefined, never throws (render just runs
    // without music instead of crashing on a missing file).
    expect(resolveBgmTrack("gone.mp3")).toBeUndefined();
  });

  it("rejects a traversal/separator name at the resolve + remove chokepoints", async () => {
    // A crafted name must never escape the library dir into an arbitrary fs
    // delete/read — same discipline as assertSafeProjectId. resolveBgmTrack
    // swallows it to undefined (no BGM); removeBgmTrack throws (a write op).
    for (const evil of ["../escape.mp3", "..\\escape.mp3", "a/b.mp3", "a\\b.mp3", ".."]) {
      expect(resolveBgmTrack(evil)).toBeUndefined();
      await expect(removeBgmTrack(evil)).rejects.toThrow(/Invalid BGM track name/);
    }
  });
});
