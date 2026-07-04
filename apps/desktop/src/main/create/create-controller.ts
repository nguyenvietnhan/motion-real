import {
  MAX_TOPIC_LEN,
  MAX_URL_LEN,
  validateCreateInput,
  type CreateBrief,
  type CreateValidation,
} from "../../shared/create-validation.js";
import { createLogger, type SerializedPipelineError } from "@motionreal/pipeline";
import type { AuthorInput, AuthorImageRef } from "../agent/agent-worker.js";
import type {
  StagedImageRef,
  VideoFormatChoice,
  DurationTierChoice,
  VideoLanguageChoice,
  VoiceProviderChoice,
} from "../../shared/types.js";
import { toFriendlyError } from "../redact/friendly.js";

const log = createLogger("create");

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
  scaffold: (
    prompt: string,
    voiceProvider: VoiceProviderChoice,
    videoLanguage: VideoLanguageChoice,
  ) => Promise<{ ok: true; projectId: string } | { ok: false; error: SerializedPipelineError }>;
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
  /**
   * Preflight readiness check, run AFTER input validation but BEFORE scaffold.
   * Returns a non-empty Vietnamese message to BLOCK create (a config gap that
   * would otherwise let the whole AI authoring pass run and then fail at TTS,
   * e.g. a missing Vivibe voice key), or `undefined`/empty to proceed. Optional:
   * absent ⇒ no preflight (create behaves exactly as before). It deliberately
   * does NOT gate on gateway/model state — that stays a "guide, don't gate" chip
   * in the UI — only on a guaranteed-fatal local config gap.
   */
  preflight?: (voiceProvider: VoiceProviderChoice, videoLanguage: VideoLanguageChoice) => string | undefined;
}

export class CreateController {
  constructor(private readonly deps: CreateDeps) {}

  async create(
    raw: string,
    images: StagedImageRef[] = [],
    choices: {
      format?: VideoFormatChoice;
      durationTier?: DurationTierChoice;
      videoLanguage?: VideoLanguageChoice;
      voiceProvider?: VoiceProviderChoice;
    } = {},
  ): Promise<{ projectId: string }> {
    const v = validateCreateInput({ raw });
    if (!v.ok) throw new Error(VALIDATION_MESSAGE[v.reason]); // invalid ⇒ no scaffold (R1.3)
    // Block on a guaranteed-fatal config gap BEFORE scaffolding/authoring, so the
    // user isn't told "ready" only to have the whole AI pass burn and then fail at
    // TTS. A clean (no-message) preflight — or no preflight dep — proceeds.
    const voiceProvider = choices.voiceProvider ?? "vivibe";
    const videoLanguage = choices.videoLanguage ?? "vi";
    if (voiceProvider === "vivibe" && videoLanguage === "en") {
      throw new Error("Vivibe chỉ hỗ trợ tiếng Việt. Hãy chọn ElevenLabs để tạo video tiếng Anh.");
    }
    const block = this.deps.preflight?.(voiceProvider, videoLanguage);
    if (block) throw new Error(block);
    const res = await this.deps.scaffold(v.brief.text, voiceProvider, videoLanguage);
    if (!res.ok) throw new Error(toFriendlyError(res.error).message); // redacted (R8.5)
    // Promote staged images into the project before authoring so the first draft
    // can place them. A promote failure never blocks create — the brief still
    // authors (text-only), images just don't reach the AI.
    const promoted = images.length > 0 && this.deps.promoteImages
      ? await this.deps.promoteImages(res.projectId, images).catch((error) => {
          log.warn(
            { err: error, projectId: res.projectId, imageCount: images.length },
            "staged image promotion failed; authoring will continue text-only",
          );
          return [] as AuthorImageRef[];
        })
      : [];
    this.deps.beginCreate(res.projectId, {
      text: v.brief.text,
      urls: v.brief.urls,
      ...(promoted.length > 0 ? { images: promoted } : {}),
      // The three delivery knobs the user picked at the create screen (R7/R9/D10):
      // format + duration tier + video language. Folded into the AuthorInput so they
      // survive an in-session "retry" (which re-runs from the remembered input); the
      // backend threads them into the prompt + spec (the model never chooses them).
      ...(choices.format ? { format: choices.format } : {}),
      ...(choices.durationTier ? { durationTier: choices.durationTier } : {}),
      videoLanguage,
    }); // stage 1 (R2.1)
    return { projectId: res.projectId };
  }
}
