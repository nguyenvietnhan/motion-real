import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  VIENEU_DEFAULT_VOICE_ID,
  VIENEU_RUNTIME_ID,
  VieneuClient,
  measureAudioDuration,
} from "../packages/tts/src/index.js";

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "motionreal-vieneu-smoke-"));
  const client = new VieneuClient({ requestTimeoutMs: 240_000 });
  const startedAt = Date.now();
  try {
    const result = await client.synthesize({
      text: "Xin chào, đây là phép thử giọng đọc VieNeu Local của MotionReal.",
      voiceId: VIENEU_DEFAULT_VOICE_ID,
      speed: 1,
      outputPath: join(dir, "sample"),
      modelId: VIENEU_RUNTIME_ID,
    });
    const info = await stat(result.audioPath);
    const measuredDuration = await measureAudioDuration(result.audioPath);
    if (!info.isFile() || info.size <= 44 || measuredDuration <= 0) {
      throw new Error("VieNeu smoke output is not valid audio");
    }
    console.log(JSON.stringify({
      status: "pass",
      runtime: VIENEU_RUNTIME_ID,
      voice: VIENEU_DEFAULT_VOICE_ID,
      bytes: info.size,
      durationSeconds: Number(measuredDuration.toFixed(3)),
      elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
    }, null, 2));
  } finally {
    await client.dispose().catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({
    status: "fail",
    code: error && typeof error === "object" && "failure" in error
      ? (error as { failure?: { code?: string } }).failure?.code ?? "unknown"
      : "unknown",
  }, null, 2));
  process.exitCode = 1;
});
