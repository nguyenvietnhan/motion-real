import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: node scripts/gen-captions.mjs <job-slug>");
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
    console.error("Chay gen_beats_batch.py truoc, roi merge_voice.py de co narration.m4a.");
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
      .map((w) => `<span class="cw">${esc(w.word)}</span>`)
      .join("\n          ");
    return `      <div id="cap-line-${i}" class="clip caption-line" data-layout-allow-overlap data-start="${l.start.toFixed(2)}" data-duration="${dur.toFixed(2)}" data-track-index="8">\n          ${spans}\n        </div>`;
  })
  .join("\n");

const wordData = JSON.stringify(
  lines.flatMap((l, i) => l.words.map((w, j) => [i, j, Number(w.start.toFixed(2)), Number(w.end.toFixed(2))])),
);

const html = `<!-- ===== PASTE vao trong #root, cuoi file ===== -->
    <audio id="vo-master" src="voice/narration.m4a" data-start="0.00" data-volume="1"></audio>
${captionClips}

<!-- ===== PASTE vao cuoi <script>, truoc khi dang ky timeline ===== -->
  const cwNodes = document.querySelectorAll(".caption-line .cw");
  const CAPTION_WORDS = ${wordData};
  CAPTION_WORDS.forEach(([lineIdx, wordIdx, start, end], k) => {
    const el = cwNodes[k];
    if (!el) return;
    tl.set(el, { color: CAPTION_ACTIVE }, start);
    tl.set(el, { color: CAPTION_IDLE }, end);
  });
`;

const cssNote = `/* ===== CSS di kem (paste vao <style>) =====
.caption-line { position:absolute; left:60px; right:60px; bottom:280px; display:flex; justify-content:center; align-items:flex-end; gap:16px; flex-wrap:wrap; }
.cw { font-size:54px; font-weight:700; color: var(--caption-idle, rgba(23,20,14,0.55)); }
:root { --caption-active: #D6452C; --caption-idle: rgba(23,20,14,0.55); }
*/`;

const outDir = resolve(starterDir, slug);
mkdirSync(outDir, { recursive: true });
const htmlPath = join(outDir, "captions_snippet.html");
const cssPath = join(outDir, "captions_snippet.css");
writeFileSync(htmlPath, html, "utf-8");
writeFileSync(cssPath, cssNote.replace(/\/\*+|=+$/g, "").trim() + "\n", "utf-8");

console.error(
  `OK ${lines.length} dòng caption, ${allWords.length} từ, ${totalSeconds}s`,
);
console.error(`   HTML: ${htmlPath}  (paste vào trong #root + cuối <script>)`);
console.error(`   CSS : ${cssPath}      (paste vào <style>)`);
console.error(`   audio: 1 thẻ master narration.m4a | highlight qua mảng CAPTION_WORDS`);
