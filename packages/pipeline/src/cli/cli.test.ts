import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, runDoctor, type DoctorCheck } from "./cli.js";
import { projectPaths } from "../store/store.js";

/**
 * CLI tests (pure AUTHOR mode). No render path is exercised: doctor probes are
 * stubbed so ffmpeg/Chromium are never touched, and `author scaffold` only
 * writes files. VIDEO_TOOL_HOME → temp dir so nothing touches the repo root.
 */

let tempRoot: string;
let prevHome: string | undefined;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "news-cli-"));
  prevHome = process.env.VIDEO_TOOL_HOME;
  process.env.VIDEO_TOOL_HOME = tempRoot;
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.VIDEO_TOOL_HOME;
  else process.env.VIDEO_TOOL_HOME = prevHome;
  await rm(tempRoot, { recursive: true, force: true });
});

const PASS = (name: string): DoctorCheck => ({ name, ok: true, detail: "stubbed ok" });
const FAIL = (name: string): DoctorCheck => ({ name, ok: false, detail: "stubbed missing" });

describe("runDoctor", () => {
  it("reports the registry check (AUTHOR mode: ok even with 0 registered)", async () => {
    const report = await runDoctor({
      checkEnv: () => PASS("Vivibe .env"),
      checkFfmpeg: async () => PASS("ffmpeg"),
      checkBrowser: async () => PASS("browser"),
      checkStylePacks: () => PASS("style packs"),
      checkFonts: () => PASS("fonts (vietnamese coverage)"),
    });
    expect(report.ok).toBe(true);
    const registry = report.checks.find((c) => c.name === "registry");
    expect(registry?.ok).toBe(true);
    expect(registry?.detail).toMatch(/component/);
  });

  it("is not ok and names the missing item when a hard check fails", async () => {
    const report = await runDoctor({
      checkEnv: () => FAIL("Vivibe .env"),
      checkFfmpeg: async () => PASS("ffmpeg"),
      checkBrowser: async () => PASS("browser"),
      checkRegistry: () => PASS("registry"),
      checkStylePacks: () => PASS("style packs"),
      checkFonts: () => PASS("fonts (vietnamese coverage)"),
    });
    expect(report.ok).toBe(false);
    expect(report.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(["Vivibe .env"]);
  });

  it("runs ALL checks and lists EVERY failure (never short-circuits)", async () => {
    const report = await runDoctor({
      checkEnv: () => FAIL("Vivibe .env"),
      checkFfmpeg: async () => PASS("ffmpeg"),
      checkBrowser: async () => PASS("browser"),
      checkRegistry: () => PASS("registry"),
      checkStylePacks: () => FAIL("style packs"),
      checkFonts: () => PASS("fonts (vietnamese coverage)"),
    });
    expect(report.ok).toBe(false);
    expect(report.checks.filter((c) => !c.ok).map((c) => c.name).sort()).toEqual(
      ["Vivibe .env", "style packs"].sort(),
    );
    // All six checks are present even though several failed.
    expect(report.checks).toHaveLength(6);
  });
});

describe("main — verbs", () => {
  it("author scaffold creates a project skeleton + manifest", async () => {
    const result = await main(["author", "scaffold", "Vì sao chip AI đang đắt đỏ"]);
    expect(result.exitCode).toBe(0);
    const output = result.lines.join("\n");
    expect(output).toMatch(/Scaffolded project/);

    const idLine = result.lines.find((l) => l.includes("Scaffolded project"))!;
    const projectId = idLine.match(/Scaffolded project (\S+)/)![1]!;
    const paths = projectPaths(projectId);
    expect(existsSync(paths.manifest)).toBe(true);
    expect(existsSync(paths.authoredDir)).toBe(true);
    const brief = JSON.parse(await readFile(paths.brief, "utf8"));
    expect(brief.state).toBe("scaffolded");
  });

  it("author without scaffold sub-command errors", async () => {
    const result = await main(["author", "Vì sao chip AI đang đắt đỏ"]);
    expect(result.exitCode).toBe(1);
    expect(result.lines.join("\n")).toMatch(/author scaffold/);
  });

  it("preview prints the Studio command after scaffolding", async () => {
    const created = await main(["author", "scaffold", "preview topic here"]);
    const projectId = created.lines.find((l) => l.includes("Scaffolded project"))!.match(/Scaffolded project (\S+)/)![1]!;

    const result = await main(["preview", projectId]);
    expect(result.exitCode).toBe(0);
    const output = result.lines.join("\n");
    expect(output).toMatch(/manifest/);
    expect(output).toMatch(/@news\/remotion run studio/);
  });

  it("rejects an unknown command and an unknown --tts value", async () => {
    const unknown = await main(["frobnicate"]);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.lines.join("\n")).toMatch(/Unknown command/);

    const badTts = await main(["render", "some-id", "--tts", "robovoice"]);
    expect(badTts.exitCode).toBe(1);
    expect(badTts.lines.join("\n")).toMatch(/Unknown --tts/);
  });
});

describe("main — new verbs (ingest / tracker / bulk)", () => {
  it("ingest with no url prints usage and exits 1", async () => {
    const res = await main(["ingest"]);
    expect(res.exitCode).toBe(1);
    expect(res.lines.join("\n")).toMatch(/Usage: ingest <url>/);
  });

  it("tracker add → list → update round-trips through a tracker file", async () => {
    const trackerPath = join(tempRoot, "queue.json");

    const add = await main(["tracker", "add", "https://a.test/x", "--id", "n1", "--title", "Tin", "--source", "Wire", "--tracker", trackerPath]);
    expect(add.exitCode).toBe(0);
    expect(add.lines.join("\n")).toMatch(/Added tracker item n1/);

    const list = await main(["tracker", "list", "--tracker", trackerPath]);
    expect(list.exitCode).toBe(0);
    expect(list.lines.join("\n")).toMatch(/\[pending\] n1/);

    const update = await main(["tracker", "update", "n1", "--status", "done", "--project", "proj-1", "--tracker", trackerPath]);
    expect(update.exitCode).toBe(0);

    const list2 = await main(["tracker", "list", "--tracker", trackerPath]);
    expect(list2.lines.join("\n")).toMatch(/\[done\] n1/);
  });

  it("tracker update on a missing id exits 1", async () => {
    const trackerPath = join(tempRoot, "queue.json");
    const res = await main(["tracker", "update", "ghost", "--status", "done", "--tracker", trackerPath]);
    expect(res.exitCode).toBe(1);
    expect(res.lines.join("\n")).toMatch(/not found/);
  });

  it("bulk over an empty tracker processes nothing (exit 0)", async () => {
    const trackerPath = join(tempRoot, "empty.json");
    const res = await main(["bulk", "--tracker", trackerPath]);
    expect(res.exitCode).toBe(0);
    expect(res.lines.join("\n")).toMatch(/0 processed/);
  });

  it("bulk marks an item with no projectId as failed and continues (exit 1)", async () => {
    const trackerPath = join(tempRoot, "queue.json");
    await main(["tracker", "add", "https://a.test/x", "--id", "n1", "--tracker", trackerPath]);
    const res = await main(["bulk", "--tracker", trackerPath]);
    expect(res.exitCode).toBe(1);
    expect(res.lines.join("\n")).toMatch(/1 failed/);
    expect(res.lines.join("\n")).toMatch(/no projectId/);
  });

  it("bulk rejects a non-positive --limit", async () => {
    const res = await main(["bulk", "--limit", "0"]);
    expect(res.exitCode).toBe(1);
    expect(res.lines.join("\n")).toMatch(/Invalid --limit/);
  });
});
