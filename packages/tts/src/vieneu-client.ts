import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { VoiceProviderError } from "./provider-error.js";
import type { TTSRequest, TTSResult, TTSVoice, TtsClient } from "./types.js";
import { VIENEU_RUNTIME_ID, VIENEU_VOICES } from "./vieneu-presets.js";

type WorkerReply = {
  id?: string;
  type?: "ready" | "result" | "error";
  audio_path?: string;
  duration?: number;
  code?: string;
};

type Pending = {
  resolve: (value: WorkerReply) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export type VieneuClientOptions = {
  pythonPath?: string;
  /** Arguments before the worker path. Tests use [] with the Node executable. */
  pythonArgs?: string[];
  workerPath?: string;
  cacheDir?: string;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  runtimeProbe?: (pythonPath: string) => boolean;
};

export class VieneuClient implements TtsClient {
  readonly provider = "vieneu" as const;
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private configured?: boolean;
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly options: VieneuClientOptions = {}) {}

  isConfigured(): boolean {
    if (this.configured !== undefined) return this.configured;
    const worker = this.workerPath();
    const python = this.pythonPath();
    if (!existsSync(worker) || (isAbsolute(python) && !existsSync(python))) return (this.configured = false);
    if (this.options.runtimeProbe) return (this.configured = this.options.runtimeProbe(python));
    const probe = spawnSync(python, [
      "-c",
      "import importlib.metadata,sys;sys.exit(0 if importlib.metadata.version('vieneu')=='3.3.0' else 1)",
    ], { windowsHide: true, timeout: 5_000, stdio: "ignore" });
    return (this.configured = probe.status === 0 && !probe.error);
  }

  async listVoices(): Promise<TTSVoice[]> {
    return VIENEU_VOICES.map(([id, description]) => ({ id, name: `${id} — ${description}`, isActive: true }));
  }

  async synthesize(input: TTSRequest): Promise<TTSResult> {
    const text = input.text.trim();
    if (!text) throw this.failure("invalid_request");
    if (input.speed !== 1) throw this.failure("invalid_request");
    if (!VIENEU_VOICES.some(([id]) => id === input.voiceId)) throw this.failure("voice_not_found");
    if (!this.isConfigured()) throw this.failure("provider_unavailable");

    await mkdir(dirname(input.outputPath), { recursive: true });
    await this.ensureStarted();
    const outputPath = `${input.outputPath}.wav`;
    const reply = await this.call({
      op: "synthesize",
      text,
      voice: input.voiceId,
      output_path: outputPath,
    });
    if (reply.type !== "result" || reply.audio_path !== outputPath) {
      throw this.failure(reply.code === "voice_not_found" ? "voice_not_found" : "provider_unavailable");
    }
    const info = await stat(outputPath).catch(() => undefined);
    if (!info?.isFile() || info.size <= 44) throw this.failure("provider_unavailable");
    return { audioPath: outputPath, duration: Number(reply.duration) || 0, raw: { runtime: VIENEU_RUNTIME_ID } };
  }

  async dispose(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.ready = undefined;
    if (!child) return;
    if (!child.killed && child.exitCode === null) {
      try {
        child.stdin.end(`${JSON.stringify({ op: "shutdown" })}\n`);
      } catch {
        child.kill();
      }
      await new Promise<void>((done) => {
        const timer = setTimeout(() => { child.kill(); done(); }, 2_000);
        child.once("exit", () => { clearTimeout(timer); done(); });
      });
    }
    this.rejectAll(this.failure("provider_unavailable"));
  }

  private async ensureStarted(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolveReady, rejectReady) => {
      const child = spawn(this.pythonPath(), [...(this.options.pythonArgs ?? ["-u"]), this.workerPath()], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, HF_HOME: this.cacheDir() },
      });
      this.child = child;
      let settled = false;
      const failStart = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (!child.killed && child.exitCode === null) child.kill();
        this.child = undefined;
        this.ready = undefined;
        rejectReady(this.failure("provider_unavailable"));
      };
      const timeout = setTimeout(failStart, this.options.startupTimeoutMs ?? 180_000);
      createInterface({ input: child.stdout }).on("line", (line) => {
        let reply: WorkerReply;
        try { reply = JSON.parse(line) as WorkerReply; } catch { failStart(); return; }
        if (reply.type === "ready" && !settled) {
          settled = true;
          clearTimeout(timeout);
          resolveReady();
          return;
        }
        if (!reply.id) return;
        const pending = this.pending.get(reply.id);
        if (!pending) return;
        this.pending.delete(reply.id);
        clearTimeout(pending.timer);
        if (reply.type === "error") pending.reject(this.failure(reply.code === "voice_not_found" ? "voice_not_found" : "provider_unavailable"));
        else pending.resolve(reply);
      });
      // Drain provider diagnostics so a noisy dependency cannot block on a full
      // stderr pipe. Raw Python/model output never crosses the TTS boundary.
      child.stderr.resume();
      child.once("error", failStart);
      child.once("exit", () => {
        clearTimeout(timeout);
        failStart();
        this.child = undefined;
        this.ready = undefined;
        this.rejectAll(this.failure("provider_unavailable"));
      });
    });
    return this.ready;
  }

  private call(payload: Record<string, unknown>): Promise<WorkerReply> {
    const child = this.child;
    if (!child || child.exitCode !== null || child.killed) return Promise.reject(this.failure("provider_unavailable"));
    const id = randomUUID();
    return new Promise<WorkerReply>((resolveReply, rejectReply) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectReply(this.failure("provider_unavailable"));
        child.kill();
      }, this.options.requestTimeoutMs ?? 180_000);
      this.pending.set(id, { resolve: resolveReply, reject: rejectReply, timer });
      const failWrite = () => {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectReply(this.failure("provider_unavailable"));
      };
      try {
        child.stdin.write(`${JSON.stringify({ id, ...payload })}\n`, (error) => {
          if (error) failWrite();
        });
      } catch {
        failWrite();
      }
    });
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private pythonPath(): string {
    return this.options.pythonPath ?? (process.env.MOTIONREAL_VIENEU_PYTHON?.trim() || (process.platform === "win32" ? "python.exe" : "python3"));
  }

  private workerPath(): string {
    return this.options.workerPath ?? (process.env.MOTIONREAL_VIENEU_WORKER?.trim() || resolve(process.cwd(), "packages", "tts", "runtime", "vieneu_worker.py"));
  }

  private cacheDir(): string {
    const configured = this.options.cacheDir ?? process.env.MOTIONREAL_VIENEU_CACHE?.trim();
    if (configured) return resolve(configured);
    const root = resolve(process.env.VIDEO_TOOL_HOME?.trim() || ".video-tool");
    return join(root.endsWith(".video-tool") ? root : join(root, ".video-tool"), "vieneu", "huggingface");
  }

  private failure(code: "not_configured" | "voice_not_found" | "invalid_request" | "provider_unavailable"): VoiceProviderError {
    return new VoiceProviderError({ provider: "vieneu", code, retryable: code === "provider_unavailable" });
  }
}
