import type { QueueJobInput } from "../../shared/queue-types.js";
import type { CreateControllerChoices } from "../create/create-ipc.js";
import { HOME_QUEUE_ID, type QueueStore } from "./queue-store.js";
import type { QueueRunner } from "./queue-runner.js";

export type HomeSpillResult =
  | { kind: "not_busy" }
  | { kind: "queued"; queueId: string; jobId: string; imagesDropped: boolean }
  | { kind: "error"; error: string };

/** Home create spills only when source is home and the serial runner is busy. */
export function shouldSpillHomeCreate(source: string | undefined, busy: boolean): boolean {
  return source === "home" && busy;
}

/**
 * If Home create must wait: ensure ephemeral home container, append job, schedule Start.
 * Does not scaffold a video project (no parallel workflow).
 */
export function spillHomeCreateIfBusy(input: {
  source: string | undefined;
  busy: boolean;
  raw: string;
  choices: CreateControllerChoices;
  imageCount: number;
  store: QueueStore;
  runner: QueueRunner;
}): HomeSpillResult {
  if (!shouldSpillHomeCreate(input.source, input.busy)) {
    return { kind: "not_busy" };
  }

  const raw = input.raw.trim();
  if (!raw) {
    return { kind: "error", error: "Hãy nhập nội dung hoặc đường dẫn để bắt đầu." };
  }

  const home = input.store.ensureHomeQueue();
  const jobInput: QueueJobInput = {
    raw,
    durationTier: input.choices.durationTier === 2 || input.choices.durationTier === 3 || input.choices.durationTier === 4
      ? input.choices.durationTier
      : 1,
    videoLanguage: input.choices.videoLanguage === "en" ? "en" : "vi",
    voiceProvider: input.choices.voiceProvider === "elevenlabs" ? "elevenlabs" : "vivibe",
    bgm: typeof input.choices.bgm === "string" ? input.choices.bgm : null,
  };

  const after = input.store.addJob(home.id, jobInput);
  if (!after) {
    return { kind: "error", error: "Không thêm được video vào hàng đợi home." };
  }
  const job = after.jobs[after.jobs.length - 1];
  if (!job) {
    return { kind: "error", error: "Không thêm được video vào hàng đợi home." };
  }

  const start = input.runner.start(HOME_QUEUE_ID);
  if (!start.ok) {
    // Job is already queued; surface start error so user can Start from tab.
    return { kind: "error", error: start.error };
  }

  return {
    kind: "queued",
    queueId: HOME_QUEUE_ID,
    jobId: job.id,
    imagesDropped: input.imageCount > 0,
  };
}
