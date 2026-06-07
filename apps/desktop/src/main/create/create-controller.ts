import {
  MAX_TOPIC_LEN,
  MAX_URL_LEN,
  validateCreateInput,
  type CreateClassified,
  type CreateValidation,
} from "../../shared/create-validation.js";
import type { SerializedPipelineError } from "@news/pipeline";
import type { AuthorInput } from "../agent/agent-worker.js";
import { toFriendlyError } from "../redact/friendly.js";

/**
 * Create-input validation lives in `shared/create-validation.ts` (pure + total,
 * Property 1) so the renderer can validate without importing main-process code.
 * Re-exported here for existing call sites/tests.
 */
export { MAX_TOPIC_LEN, MAX_URL_LEN, validateCreateInput };
export type { CreateClassified, CreateValidation };

/** User-facing Vietnamese messages for an invalid create input (never raw). */
const VALIDATION_MESSAGE: Record<"empty" | "too-long" | "malformed-url", string> = {
  empty: "Hãy nhập nội dung hoặc đường dẫn để bắt đầu.",
  "too-long": "Nội dung quá dài. Hãy rút ngắn lại rồi thử lại.",
  "malformed-url": "Đường dẫn không hợp lệ. Hãy kiểm tra lại đường dẫn.",
};

/**
 * Create / ingest controller (reconcile-main-controllers S5). Reproduces the
 * inline Current_Behavior of `index.ts` `projects:create` exactly (R1.3, R2.1,
 * R4.5, R4.6), with the error surface now REDACTED (R8.5):
 *   - validate the raw input; an invalid input THROWS a friendly Vietnamese
 *     message and does NOT scaffold (R1.3);
 *   - scaffold ONE project through the single registry (`scaffold` seam); a
 *     scaffold failure THROWS the REDACTED `toFriendlyError` message — never the
 *     raw engine `cause` (R8.5);
 *   - hand off to the staged workspace via `beginScript` (stage 1, R2.1).
 * The two throws map to the renderer's rejected `invoke` promise.
 */

export interface CreateDeps {
  /** Scaffold through the ONE `createTools` registry (R4.6). */
  scaffold: (prompt: string) => Promise<{ ok: true; projectId: string } | { ok: false; error: SerializedPipelineError }>;
  /** Start stage 1 (write the script) on the WorkspaceController. */
  beginScript: (projectId: string, input: AuthorInput) => void;
}

export class CreateController {
  constructor(private readonly deps: CreateDeps) {}

  async create(raw: string): Promise<{ projectId: string }> {
    const v = validateCreateInput({ raw });
    if (!v.ok) throw new Error(VALIDATION_MESSAGE[v.reason]); // invalid ⇒ no scaffold (R1.3)
    const prompt = v.classified.kind === "url" ? v.classified.url : v.classified.text;
    const res = await this.deps.scaffold(prompt);
    if (!res.ok) throw new Error(toFriendlyError(res.error).message); // redacted (R8.5)
    const input: AuthorInput =
      v.classified.kind === "url" ? { kind: "url", url: v.classified.url } : { kind: "topic", text: v.classified.text };
    this.deps.beginScript(res.projectId, input); // stage 1 (R2.1)
    return { projectId: res.projectId };
  }
}
