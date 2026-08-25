import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: node scripts/gen-captions.mjs <job-slug>");
  console.error("Doc: in HTML fragment (caption clips) + JS fragment (word-highlight tweens).");
  process.exit(1);
}

const starterDir = resolve(dirname(import.meta.filename), "..");
const jobDir = resolve(starterDir, "..", "jobs", slug);

const beatsPath = join(jobDir, "beats.json");
if (!existsSync(beatsPath)) {
  console.error(`LOI: khong tim thay ${beatsPath}`);
  console.error("Beats.json phai ton tai va da cap nhat duration SAU khi sinh voice (Stage 3).");
  process.exit(1);
}
const beats = JSON.parse(readFileSync(beatsPath, "utf-8"));

const voiceMeta = beats.beats.map((b) => {
  const metaPath = join(jobDir, b.wav.replace(/\.wav$/, ".json"));
  if (!existsSync(metaPath)) {
    console.error(`LOI: thieu meta voice cho beat ${b.id}: ${metaPath}`);
    console.error("Chay voice-vieneu truoc, roi cap nhat beats.json duration = durationSeconds.");
    process.exit(1);
  }
  return { ...b, meta: JSON.parse(readFileSync(metaPath, "utf-8")) };
});

const totalSeconds =
  beats.totalSeconds ??
  Math.max(...voiceMeta.map((b) => b.start + b.duration));

const allWords = voiceMeta.flatMap((b) =>
  b.meta.words.map((w) => ({ word: w.word, start: b.start + w.start, end: b.start + w.end })),
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
      .map((w) => `<span id="cw${i}-${w.start.toFixed(2).replace(".", "_")}" class="cw">${esc(w.word)}</span>`)
      .join("\n          ");
    return `      <div id="cap${i}" class="clip caption-line" data-start="${l.start.toFixed(2)}" data-duration="${dur.toFixed(2)}" data-track-index="8">\n          ${spans}\n        </div>`;
  })
  .join("\n");

const audioEls = voiceMeta
  .map((b) => `    <audio id="vo-${b.id}" src="voice/${b.id}.wav" data-start="${b.start.toFixed(2)}" data-volume="1"></audio>`)
  .join("\n");

const captionTweens = lines
  .map((l, i) =>
    l.words
      .map((w) => {
        const id = `#cw${i}-${w.start.toFixed(2).replace(".", "_")}`;
        return `  tl.set("${id}", { color: CAPTION_ACTIVE }, ${w.start.toFixed(2)});\n  tl.set("${id}", { color: CAPTION_IDLE }, ${w.end.toFixed(2)});`;
      })
      .join("\n"),
  )
  .join("\n");

console.log("<!-- ===== PASTE vào trong #root, cuối file ===== -->");
console.log(captionClips);
console.log(audioEls);
console.log("<!-- ===== PASTE vào trong <script>, trước khi đăng ký timeline ===== -->");
console.log('  const CAPTION_ACTIVE = "#D6452C";   // đổi theo style pack');
console.log('  const CAPTION_IDLE = "rgba(23,20,14,0.55)";');
console.log(captionTweens);
console.log(`<!-- CSS đi kèm:
      .caption-line { position:absolute; left:60px; right:60px; bottom:280px; display:flex; justify-content:center; align-items:flex-end; gap:16px; flex-wrap:wrap; }
      .cw { font-size:54px; font-weight:700; }
-->`);
console.error(`OK ${lines.length} dòng caption, ${allWords.length} từ, ${totalSeconds}s`);
