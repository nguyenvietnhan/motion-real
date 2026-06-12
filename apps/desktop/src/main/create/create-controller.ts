import {
  MAX_TOPIC_LEN,
  MAX_URL_LEN,
  validateCreateInput,
  type CreateBrief,
  type CreateValidation,
} from "../../shared/create-validation.js";
import type { SerializedPipelineError } from "@news/pipeline";
import type { AuthorInput, AuthorImageRef } from "../agent/agent-worker.js";
import type { StagedImageRef } from "../../shared/types.js";
import { toFriendlyError } from "../redact/friendly.js";

/**
 * Create-input validation lives in `shared/create-validation.ts` (pure + total)
 * so the renderer can validate without importing main-process code. Re-exported
 * here for existing call sites/tests.
 */
export { MAX_TOPIC_LEN, MAX_URL_LEN, validateCreateInput };
export type { CreateBrief, CreateValidation };

/** User-facing Vietnamese messages for an invalid create input (never raw). */
const VALIDATION_MESSAGE: Record<"empty" | "too-long", string> = {
  empty: "Hãy nhập nội dung hoặc đường dẫn để bắt đầu.",
  "too-long": "Nội dung quá dài. Hãy rút ngắn lại rồi thử lại.",
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
  /**
   * Hand the brief off to the WorkspaceController. With a link this runs the
   * crawl → (AI-filter) → (image-review) → author flow (Phase 2 Block B); with
   * no link it collapses to plain authoring — the controller decides.
   */
  beginCreate: (projectId: string, input: AuthorInput) => void;
  /**
   * Move staged create-time images into the new project's `assetsDir` and return
   * their project-relative `assets/<sha>.<ext>` refs (Phase 2 Block A). Only the
   * images that promote successfully are returned, so a missing/failed staged
   * file simply drops out of the author pool. Optional: absent ⇒ no image
   * support (the create call behaves exactly as before).
   */
  promoteImages?: (projectId: string, images: StagedImageRef[]) => Promise<AuthorImageRef[]>;
}

export class CreateController {
  constructor(private readonly deps: CreateDeps) {}

  async create(raw: string, images: StagedImageRef[] = [], stylePackId?: string): Promise<{ projectId: string }> {
    const v = validateCreateInput({ raw });
    if (!v.ok) throw new Error(VALIDATION_MESSAGE[v.reason]); // invalid ⇒ no scaffold (R1.3)
    const res = await this.deps.scaffold(v.brief.text);
    if (!res.ok) throw new Error(toFriendlyError(res.error).message); // redacted (R8.5)
    // Promote staged images into the project before authoring so the first draft
    // can place them. A promote failure never blocks create — the brief still
    // authors (text-only), images just don't reach the AI.
    const promoted = images.length > 0 && this.deps.promoteImages
      ? await this.deps.promoteImages(res.projectId, images).catch(() => [] as AuthorImageRef[])
      : [];
    this.deps.beginCreate(res.projectId, {
      text: v.brief.text,
      urls: v.brief.urls,
      ...(promoted.length > 0 ? { images: promoted } : {}),
      // The user's chosen style pack (the create-screen picker). Folded into the
      // AuthorInput so it survives an in-session "retry" (which re-runs from the
      // remembered input), and injected into the manifest theme by the backend.
      ...(stylePackId ? { stylePackId } : {}),
    }); // stage 1 (R2.1)
    return { projectId: res.projectId };
  }
}
