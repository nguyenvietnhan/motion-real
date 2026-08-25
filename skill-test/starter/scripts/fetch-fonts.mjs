import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const FAMILIES = [
  "Literata:wght@900",
  "Be+Vietnam+Pro:wght@400;600;900",
  "IBM+Plex+Mono:wght@400;600",
  "Archivo:wght@900",
];

const STARTER = resolve(dirname(import.meta.filename), "..");
const FONT_DIR = join(STARTER, "public", "fonts");
mkdirSync(FONT_DIR, { recursive: true });

const css = (
  await (
    await fetch(`https://fonts.googleapis.com/css2?${FAMILIES.map((f) => `family=${f}`).join("&")}&display=swap`, {
      headers: { "User-Agent": UA },
    })
  ).text()
);

const blocks = [...css.matchAll(/\/\* (\w[\w-]*) \*\/\s*@font-face\s*\{([^}]+)\}/g)];
const keep = new Set(["vietnamese", "latin"]);
const faces = [];

for (const [, subset, body] of blocks) {
  if (!keep.has(subset)) continue;
  const family = body.match(/font-family:\s*'([^']+)'/)[1];
  const weight = body.match(/font-weight:\s*(\d+)/)[1];
  const url = body.match(/url\((https:[^)]+\.woff2)\)/)[1];
  const range = body.match(/unicode-range:\s*([^;]+);/)[1].trim();
  const file = `${family.replace(/\s+/g, "")}-${weight}-${subset}.woff2`;
  const buf = Buffer.from(await (await fetch(url, { headers: { "User-Agent": UA } })).arrayBuffer());
  writeFileSync(join(FONT_DIR, file), buf);
  faces.push({ family, weight, subset, file, range });
  console.log(`${file}  ${(buf.length / 1024).toFixed(0)} KB`);
}

const cssOut = faces
  .map(
    (f) => `@font-face {
  font-family: '${f.family}';
  font-style: normal;
  font-weight: ${f.weight};
  font-display: block;
  src: url('/fonts/${f.file}') format('woff2');
  unicode-range: ${f.range};
}`,
  )
  .join("\n\n");

writeFileSync(join(STARTER, "src", "fonts.css"), cssOut + "\n", "utf-8");
console.log(`\nOK ${faces.length} faces -> src/fonts.css`);
