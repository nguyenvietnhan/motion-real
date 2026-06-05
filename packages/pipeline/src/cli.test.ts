import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, runDoctor, type DoctorCheck } from "./cli.js";
import { projectPaths } from "./store.js";

/**
 * CLI tests (Task 10.2; Requirements 12.1, 12.2, 12.3). No render path is
 * exercised here — doctor probes are stubbed so ffmpeg/Chromium are never
 * touched, and `create` uses the mock planner. VIDEO_TOOL_HOME points at a temp
 * dir so nothing touches the repo root.
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

describe("runDoctor — Req 12.2", () => {
  it("reports the real registry as healthy (components are registered)", async () => {
    const report = await runDoctor({
      checkEnv: () => PASS("Vivibe .env"),
      checkFfmpeg: async () => PASS("ffmpeg"),
      checkBrowser: async () => PASS("browser"),
      // checkRegistry left as the real default — components are registered on import.
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
    });
    expect(report.ok).toBe(false);
    expect(report.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(["Vivibe .env"]);
  });
});

describe("main — verbs", () => {
  it("create writes a planned project and prints the spec path", async () => {
    const result = await main(["create", "Vì sao chip AI đang đắt đỏ", "--duration", "60", "--provider", "mock"]);
    expect(result.exitCode).toBe(0);
    const output = result.lines.join("\n");
    expect(output).toMatch(/Created project/);

    // The project + spec exist under the temp home.
    const idLine = result.lines.find((l) => l.includes("Created project"))!;
    const projectId = idLine.match(/Created project (\S+)/)![1]!;
    expect(existsSync(projectPaths(projectId).spec)).toBe(true);
    const brief = JSON.parse(await readFile(projectPaths(projectId).brief, "utf8"));
    expect(brief.state).toBe("planned");
  });

  it("create rejects an invalid --duration with a non-zero exit", async () => {
    const result = await main(["create", "topic", "--duration", "45"]);
    expect(result.exitCode).toBe(1);
    expect(result.lines.join("\n")).toMatch(/Duration must be one of/);
  });

  it("preview prints the Studio command for a created project's draft spec", async () => {
    const created = await main(["create", "preview topic here", "--duration", "60"]);
    const projectId = created.lines.find((l) => l.includes("Created project"))!.match(/Created project (\S+)/)![1]!;

    const result = await main(["preview", projectId]);
    expect(result.exitCode).toBe(0);
    const output = result.lines.join("\n");
    expect(output).toMatch(/draft spec/);
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
