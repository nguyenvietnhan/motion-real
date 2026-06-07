import type { CreateInput } from "../../shared/types.js";
import {
  MAX_TOPIC_LEN,
  MAX_URL_LEN,
  validateCreateInput,
  type CreateClassified,
  type CreateValidation,
} from "../../shared/create-validation.js";

/**
 * Create-input validation now lives in `shared/create-validation.ts` (pure +
 * total, Property 1) so the renderer can validate without importing main-process
 * code. Re-exported here for the create flow + existing call sites/tests.
 */
export { MAX_TOPIC_LEN, MAX_URL_LEN, validateCreateInput };
export type { CreateClassified, CreateValidation };

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
