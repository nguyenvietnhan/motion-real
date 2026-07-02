import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Scaffold a new video build script — the RELIABLE authoring path.
 *
 * Usage:
 *   npx tsx scripts/new-video.ts <project-id> ["Video title"]
 *
 * It writes `scripts/build-<project-id>.ts` from a known-good template (imports
 * the pipeline from source, writes authored scenes, admits, then renders
 * stills → draft → full in ONE process — the single module instance that avoids
 * the registry/resolution pitfalls of hand-rolled CLI / `tsx -e` runs). Then you
 * edit the scenes for your topic and run the script. It never overwrites.
 */
const here = dirname(fileURLToPath(import.meta.url));

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function main(): void {
  const rawId = process.argv[2];
  if (!rawId) {
    console.error('Usage: npx tsx scripts/new-video.ts <project-id> ["Video title"]');
    process.exitCode = 1;
    return;
  }
  const id = slugify(rawId);
  if (!id) {
    console.error(`Could not derive a valid id from "${rawId}".`);
    process.exitCode = 1;
    return;
  }
  const title = process.argv.slice(3).join(" ").trim() || rawId;
  const outPath = join(here, `build-${id}.ts`);
  if (existsSync(outPath)) {
    console.error(`Refusing to overwrite existing ${outPath}.`);
    process.exitCode = 1;
    return;
  }

  const template = readFileSync(join(here, "templates", "video-template.txt"), "utf8");
  // Substitute id/title, and make the placeholder component ids ("vt-*") unique
  // to this project so two scaffolded videos can never collide on a registry id.
  const content = template
    .split("__ID__")
    .join(id)
    .split("__TITLE__")
    .join(title)
    .split("vt-")
    .join(`${id}-`);
  writeFileSync(outPath, content, "utf8");

  console.log(`Created scripts/build-${id}.ts`);
  console.log("Next:");
  console.log("  1. Edit the authored scenes for your topic (one idea per scene; bespoke for signature beats).");
  console.log(`  2. npx tsx scripts/build-${id}.ts stills              # fast layout check`);
  console.log(`  3. npx tsx --env-file=.env scripts/build-${id}.ts draft vivibe   # draft for user review`);
  console.log(`  4. npx tsx --env-file=.env scripts/build-${id}.ts full  vivibe   # final (after approval)`);
}

main();
