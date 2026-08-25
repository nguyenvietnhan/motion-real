import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: node scripts/gen-job-data.mjs <job-slug>");
  process.exit(1);
}

const starterDir = resolve(import.meta.dirname, "..");
const jobDir = resolve(starterDir, "..", "jobs", slug);
const beats = JSON.parse(readFileSync(join(jobDir, "beats.json"), "utf-8"));
const fps = beats.fps ?? 30;

const beatData = beats.beats.map((b) => {
  const meta = JSON.parse(readFileSync(join(jobDir, b.wav.replace(/\.wav$/, ".json")), "utf-8"));
  const words = meta.words.map((w) => ({
    word: w.word,
    start: Math.round(w.startSeconds !== undefined ? w.startSeconds * fps : w.startFrame),
    end: Math.round(w.endSeconds !== undefined ? w.endSeconds * fps : w.endFrame),
  }));
  return {
    id: b.id,
    role: b.role,
    vo: b.vo,
    startFrame: b.startFrame,
    durFrames: b.durFrames,
    words,
  };
});

const captions = beatData.flatMap((b) =>
  b.words.map((w) => ({
    word: w.word,
    start: b.startFrame + w.start,
    end: b.startFrame + w.end,
  })),
);

const pascal = slug
  .split("-")
  .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
  .join("");

const out = `import type { BeatData, CaptionWord } from "./types";

export const JOB_SLUG = ${JSON.stringify(slug)};
export const TOTAL_FRAMES = ${beats.totalFrames};
export const BEATS: BeatData[] = ${JSON.stringify(beatData, null, 2)};
export const CAPTIONS: CaptionWord[] = ${JSON.stringify(captions)};
`;

const outDir = join(starterDir, "src", "video");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${slug}.data.ts`), out, "utf-8");
console.log(`OK ${slug}.data.ts | ${beatData.length} beats | ${captions.length} words | ${beats.totalFrames} frames`);
