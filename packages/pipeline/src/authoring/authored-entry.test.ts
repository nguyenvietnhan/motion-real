import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAuthoredEntrySource, generateAuthoredEntry } from "./authored-entry.js";

describe("authored-entry generation", () => {
  let tempRoot = "";

  afterEach(async () => {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  });

  it("embeds a fingerprint token and skips rewriting unchanged content", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "news-authored-entry-"));
    const authoredDir = join(tempRoot, "authored");
    const entryPath = join(authoredDir, "_entry.tsx");
    const scenePath = join(authoredDir, "scene-01.tsx");
    const lockPath = join(tempRoot, "video-spec.lock.json");

    await mkdir(authoredDir, { recursive: true });
    await writeFile(scenePath, "export default 1;\n", "utf8");
    await writeFile(lockPath, "{\"durationInFrames\": 1}\n", "utf8");

    const source = buildAuthoredEntrySource({
      entryPath,
      authoredFiles: [scenePath],
      lockJsonPath: lockPath,
      cacheToken: "token-1",
    });
    expect(source).toContain("SOURCE-FINGERPRINT: token-1");

    await generateAuthoredEntry({ entryPath, authoredFiles: [scenePath], lockJsonPath: lockPath });
    const first = await readFile(entryPath, "utf8");
    const firstStat = await stat(entryPath);

    await generateAuthoredEntry({ entryPath, authoredFiles: [scenePath], lockJsonPath: lockPath });
    const second = await readFile(entryPath, "utf8");
    const secondStat = await stat(entryPath);

    expect(second).toBe(first);
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);

    await new Promise((resolve) => setTimeout(resolve, 25));
    await writeFile(scenePath, "export default 2;\n", "utf8");
    await generateAuthoredEntry({ entryPath, authoredFiles: [scenePath], lockJsonPath: lockPath });
    const third = await readFile(entryPath, "utf8");
    const thirdStat = await stat(entryPath);

    expect(third).not.toBe(second);
    expect(thirdStat.mtimeMs).toBeGreaterThanOrEqual(secondStat.mtimeMs);
  });
});
