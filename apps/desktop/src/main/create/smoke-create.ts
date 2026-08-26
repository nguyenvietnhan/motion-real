import { randomUUID } from "node:crypto";
import { createLogger, type Tools } from "@motionreal/pipeline";
import { validateCreateInput } from "./create-controller.js";
import { toFriendlyError } from "../redact/friendly.js";
import type { AuthorInput } from "../agent/agent-worker.js";
import type { VideoLanguageChoice } from "../../shared/types.js";

export type SmokeCreateInput = {
  raw?: string;
  videoLanguage?: VideoLanguageChoice | string;
};

export type SmokeCreateResult =
  | { ok: true; projectId: string }
  | { ok: false; error: string };

export type SmokeCreateDeps = {
  tools: Pick<Tools, "scaffold_project">;
  beginCreate: (projectId: string, input: AuthorInput) => void;
  rename: (projectId: string, title: string) => Promise<string | null>;
};

const DEFAULT_SMOKE_PROMPT = "Smoke test — video ngắn 10 giây, không tiếng.";
const log = createLogger("smoke-create");

/**
 * Scaffold + beginCreate a silent ~10s "test" project (TTS none).
 * Shared by Settings smoke (immediate) and queue runner (after Start).
 */
export async function createSmokeProject(
  deps: SmokeCreateDeps,
  input: SmokeCreateInput = {},
): Promise<SmokeCreateResult> {
  const rawText = typeof input.raw === "string" ? input.raw : "";
  const validated = validateCreateInput({ raw: rawText.trim() || DEFAULT_SMOKE_PROMPT });
  if (!validated.ok) {
    return { ok: false, error: "Hãy nhập nội dung hoặc đường dẫn để smoke." };
  }
  const videoLanguage = input.videoLanguage === "en" ? "en" : "vi";
  const projectId = `test-${randomUUID().slice(0, 8)}`;
  const res = await deps.tools.scaffold_project({
    prompt: validated.brief.text,
    projectId,
    duration: 10,
    format: "tiktok",
    durationTier: 1,
    language: videoLanguage,
    ttsProvider: "none",
  });
  if (!res.ok) {
    return { ok: false, error: toFriendlyError(res.error).message };
  }
  await deps.rename(projectId, "test").catch((error) => {
    log.debug({ err: error, projectId }, "smoke project rename failed");
    return null;
  });
  deps.beginCreate(projectId, {
    text: validated.brief.text,
    urls: validated.brief.urls,
    format: "tiktok",
    durationTier: 1,
    targetSeconds: 10,
    videoLanguage,
  });
  return { ok: true, projectId };
}
