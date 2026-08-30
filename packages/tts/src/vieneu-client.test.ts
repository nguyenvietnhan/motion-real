import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VieneuClient, VoiceProviderError } from "./index.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fakeWorker(source = workerSource): Promise<{ dir: string; worker: string }> {
  const dir = await mkdtemp(join(tmpdir(), "vieneu-client-test-"));
  dirs.push(dir);
  const worker = join(dir, "worker.cjs");
  await writeFile(worker, source, "utf8");
  return { dir, worker };
}

const workerSource = String.raw`
const fs = require("node:fs");
const readline = require("node:readline");
process.stdout.write(JSON.stringify({type:"ready"}) + "\n");
readline.createInterface({input:process.stdin}).on("line", (line) => {
  const req = JSON.parse(line);
  if (req.op === "shutdown") process.exit(0);
  if (req.op !== "synthesize") return;
  fs.writeFileSync(req.output_path, Buffer.alloc(80, 1));
  process.stdout.write(JSON.stringify({id:req.id,type:"result",audio_path:req.output_path,duration:1.25}) + "\n");
});
`;

describe("VieneuClient", () => {
  it("keeps one JSONL worker alive for synthesis and shuts it down", async () => {
    const { dir, worker } = await fakeWorker();
    const client = new VieneuClient({
      pythonPath: process.execPath,
      pythonArgs: [],
      workerPath: worker,
      cacheDir: join(dir, "cache"),
      startupTimeoutMs: 2_000,
      requestTimeoutMs: 2_000,
      runtimeProbe: () => true,
    });

    const first = await client.synthesize({
      text: "Xin chào",
      voiceId: "Trúc Ly",
      speed: 1,
      outputPath: join(dir, "first"),
    });
    const second = await client.synthesize({
      text: "Lần hai",
      voiceId: "Trúc Ly",
      speed: 1,
      outputPath: join(dir, "second"),
    });

    expect(first).toMatchObject({ audioPath: join(dir, "first.wav"), duration: 1.25 });
    expect(second.audioPath).toBe(join(dir, "second.wav"));
    expect((await readFile(first.audioPath)).byteLength).toBe(80);
    await expect(client.dispose()).resolves.toBeUndefined();
  });

  it("rejects unsupported voice and speed before starting a worker", async () => {
    const client = new VieneuClient({ pythonPath: "missing-python.exe", workerPath: "missing-worker.py" });
    for (const request of [
      { text: "Xin chào", voiceId: "unknown", speed: 1, outputPath: "unused" },
      { text: "Xin chào", voiceId: "Trúc Ly", speed: 1.2, outputPath: "unused" },
    ]) {
      const error = await client.synthesize(request).catch((value: unknown) => value);
      expect(error).toBeInstanceOf(VoiceProviderError);
      expect((error as VoiceProviderError).failure.code).toMatch(/voice_not_found|invalid_request/);
    }
  });

  it("classifies a missing local runtime as unavailable without leaking paths", async () => {
    const client = new VieneuClient({ pythonPath: "missing-python.exe", workerPath: "missing-worker.py" });
    const error = await client.synthesize({
      text: "Xin chào",
      voiceId: "Trúc Ly",
      speed: 1,
      outputPath: "unused",
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(VoiceProviderError);
    expect((error as VoiceProviderError).failure).toMatchObject({
      provider: "vieneu",
      code: "provider_unavailable",
    });
    expect((error as Error).message).not.toContain("missing-python");
  });

  it("blocks an installed but unpinned VieNeu runtime", async () => {
    const { worker } = await fakeWorker();
    const client = new VieneuClient({
      pythonPath: process.execPath,
      pythonArgs: [],
      workerPath: worker,
      runtimeProbe: () => false,
    });
    expect(client.isConfigured()).toBe(false);
  });

  it("kills a worker that never announces ready", async () => {
    const { dir, worker } = await fakeWorker("setInterval(() => {}, 1000);\n");
    const client = new VieneuClient({
      pythonPath: process.execPath,
      pythonArgs: [],
      workerPath: worker,
      cacheDir: join(dir, "cache"),
      startupTimeoutMs: 50,
      requestTimeoutMs: 500,
      runtimeProbe: () => true,
    });
    const error = await client.synthesize({
      text: "Xin chào",
      voiceId: "Trúc Ly",
      speed: 1,
      outputPath: join(dir, "timeout"),
    }).catch((value: unknown) => value);

    expect((error as VoiceProviderError).failure.code).toBe("provider_unavailable");
    await expect(client.dispose()).resolves.toBeUndefined();
  });

  it("cancels an in-flight local request and leaves no output file", async () => {
    const { dir, worker } = await fakeWorker(String.raw`
const readline = require("node:readline");
process.stdout.write(JSON.stringify({type:"ready"}) + "\n");
readline.createInterface({input:process.stdin}).on("line", () => {});
`);
    const client = new VieneuClient({
      pythonPath: process.execPath,
      pythonArgs: [],
      workerPath: worker,
      cacheDir: join(dir, "cache"),
      startupTimeoutMs: 2_000,
      requestTimeoutMs: 2_000,
      runtimeProbe: () => true,
    });
    const controller = new AbortController();
    const outputPath = join(dir, "cancelled");
    const pending = client.synthesize({ text: "Xin chào", voiceId: "Trúc Ly", speed: 1, outputPath }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 25);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(readFile(`${outputPath}.wav`)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(client.dispose()).resolves.toBeUndefined();
  });
});
