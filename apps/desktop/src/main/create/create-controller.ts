import type { CreateInput } from "../../shared/types.js";

/**
 * Create-input validation (web-dashboard Task 4.3, design §Create flow,
 * Req 3.1/3.7/3.8). `validateCreateInput` is PURE and TOTAL over arbitrary
 * strings (Property 1):
 *   - empty / whitespace-only            ⇒ { ok:false, reason:"empty" }
 *   - URL-shaped but over 2048 chars     ⇒ { ok:false, reason:"too-long" }
 *   - topic over 500 chars               ⇒ { ok:false, reason:"too-long" }
 *   - URL-shaped but malformed           ⇒ { ok:false, reason:"malformed-url" }
 *   - otherwise classified as url | topic ⇒ { ok:true, classified }
 * Creation must never start for an `ok:false` result and the entered text is
 * retained by the caller.
 */

export const MAX_TOPIC_LEN = 500;
export const MAX_URL_LEN = 2048;

export type CreateClassified = { kind: "url"; url: string } | { kind: "topic"; text: string };

export type CreateValidation =
  | { ok: true; classified: CreateClassified }
  | { ok: false; reason: "empty" | "too-long" | "malformed-url" };

/** Looks like the user intends a URL (a scheme:// prefix or a leading `www.`). */
const URL_SHAPED = /^([a-z][a-z\d+.-]*:\/\/|www\.)/i;

function classifyUrl(trimmed: string): CreateValidation {
  const candidate = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, reason: "malformed-url" };
  }
  const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
  // A real article URL has a dotted public host; reject schemes/hosts we cannot ingest.
  if (!isHttp || !parsed.hostname.includes(".")) {
    return { ok: false, reason: "malformed-url" };
  }
  return { ok: true, classified: { kind: "url", url: candidate } };
}

export function validateCreateInput(input: CreateInput): CreateValidation {
  const trimmed = input.raw.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };

  if (URL_SHAPED.test(trimmed)) {
    if (trimmed.length > MAX_URL_LEN) return { ok: false, reason: "too-long" };
    return classifyUrl(trimmed);
  }

  if (trimmed.length > MAX_TOPIC_LEN) return { ok: false, reason: "too-long" };
  return { ok: true, classified: { kind: "topic", text: trimmed } };
}

// --- create flow wiring (Task 7.1, Req 3.2–3.6, 3.9, 3.10) ----------------

import type { SerializedPipelineError } from "@news/pipeline";
import type { FriendlyError } from "../../shared/types.js";
import type { AgentHooks, AgentWorker, AuthorJob } from "../agent/agent-worker.js";
import { toFriendlyError } from "../redact/friendly.js";

export type CreateStartResult = { ok: true; projectId: string } | { ok: false; error: FriendlyError };

/** Scaffold ONE project through the same `@news/mcp` tools / single registry. */
export interface CreateBackend {
  scaffold(
    prompt: string,
    projectId?: string,
  ): Promise<{ ok: true; projectId: string } | { ok: false; error: SerializedPipelineError }>;
}

const VALIDATION_MESSAGE: Record<"empty" | "too-long" | "malformed-url", string> = {
  empty: "Hãy nhập nội dung hoặc đường dẫn để bắt đầu.",
  "too-long": "Nội dung quá dài. Hãy rút ngắn lại rồi thử lại.",
  "malformed-url": "Đường dẫn không hợp lệ. Hãy kiểm tra lại đường dẫn.",
};

/**
 * Create / ingest controller (web-dashboard Task 7.1). `start` validates, then
 * scaffolds the project through the ONE registry, then hands off to the
 * Agent_Worker `author` job (which ingests + authors in the background). An
 * invalid input or a scaffold failure returns a friendly error WITHOUT starting
 * authoring; an ingest/search failure surfaces later via `onError` and leaves
 * authoring unstarted (Req 3.9/3.10).
 */
export class CreateController {
  constructor(
    private readonly backend: CreateBackend,
    private readonly worker: AgentWorker,
  ) {}

  validate(input: CreateInput): CreateValidation {
    return validateCreateInput(input);
  }

  async start(
    input: CreateInput,
    hooks: AgentHooks,
    onError: (e: FriendlyError) => void,
    scriptGate = true,
  ): Promise<CreateStartResult> {
    const validated = validateCreateInput(input);
    if (!validated.ok) {
      return { ok: false, error: { message: VALIDATION_MESSAGE[validated.reason], retry: "create" } };
    }

    const classified = validated.classified;
    const prompt = classified.kind === "url" ? classified.url : classified.text;
    const scaffolded = await this.backend.scaffold(prompt);
    if (!scaffolded.ok) {
      return { ok: false, error: toFriendlyError(scaffolded.error) };
    }

    const { projectId } = scaffolded;
    void this.runAuthoring(projectId, classified, scriptGate, hooks, onError);
    return { ok: true, projectId };
  }

  private async runAuthoring(
    projectId: string,
    classified: CreateClassified,
    scriptGate: boolean,
    hooks: AgentHooks,
    onError: (e: FriendlyError) => void,
  ): Promise<void> {
    const job: AuthorJob = { projectId, input: classified, scriptGate };
    const outcome = await this.worker.author(job, hooks);
    if (outcome.kind === "ingest-failed" || outcome.kind === "no-source") {
      onError({ projectId, message: outcome.message, retry: "create" });
    }
  }
}
