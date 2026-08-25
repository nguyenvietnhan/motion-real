import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const slug = process.argv[2] || "machine-learning-tong-quan";
const starterDir = resolve(dirname(import.meta.filename), "..");
const jobDir = resolve(starterDir, "..", "jobs", slug);
const targetDir = resolve(starterDir, slug);

const beatsPath = join(jobDir, "beats.json");
if (!existsSync(beatsPath)) {
  console.error(`LOI: khong tim thay ${beatsPath}`);
  process.exit(1);
}
const beats = JSON.parse(readFileSync(beatsPath, "utf-8"));

const voiceMeta = beats.beats.map((b) => {
  const metaPath = join(jobDir, b.wav.replace(/\.wav$/, ".json"));
  return { ...b, meta: JSON.parse(readFileSync(metaPath, "utf-8")) };
});

const totalSeconds =
  beats.totalSeconds ??
  Math.max(...voiceMeta.map((b) => b.start + b.duration));

const allWords = voiceMeta.flatMap((b) =>
  b.meta.words.map((w) => ({ word: w.word, start: b.start + w.start, end: b.start + w.end }))
);

const lines = [];
for (let i = 0; i < allWords.length; i += 4) {
  const chunk = allWords.slice(i, i + 4);
  lines.push({ words: chunk, start: chunk[0].start, end: chunk[chunk.length - 1].end });
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const captionClips = lines
  .map((l, i) => {
    const isLast = i === lines.length - 1;
    const dur = l.end - l.start + (isLast ? 0.4 : 0);
    const spans = l.words
      .map((w) => `<span class="cw">${esc(w.word)}</span>`)
      .join("\n          ");
    return `      <div id="cap-line-${i}" class="clip caption-line" data-layout-allow-overlap data-start="${l.start.toFixed(2)}" data-duration="${dur.toFixed(2)}" data-track-index="8">\n          ${spans}\n        </div>`;
  })
  .join("\n");

const wordData = lines.flatMap((l, i) =>
  l.words.map((w, j) => [i, j, Number(w.start.toFixed(2)), Number(w.end.toFixed(2))])
);

writeFileSync(
  join(targetDir, "captions.json"),
  JSON.stringify({ totalSeconds, linesCount: lines.length, wordData, beatsCount: beats.beats.length }, null, 2),
  "utf-8"
);

writeFileSync(
  join(targetDir, "captions_clips.html"),
  captionClips,
  "utf-8"
);

console.log(`Successfully exported captions to ${targetDir}`);
