import {
  MAX_TOPIC_LEN,
  MAX_URL_LEN,
  validateCreateInput,
  type CreateBrief,
  type CreateValidation,
} from "../../shared/create-validation.js";
import {
  createLogger,
  isDurationTier,
  resolveEffectiveDuration,
  type SerializedPipelineError,
  VoiceProviderError,
  type VoiceProviderFailure,
} from "@motionreal/pipeline";
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
 * Create / ingest controller. Reproduces the previous main-process behavior of
 * `index.ts` `projects:create`, with the error surface now REDACTED:
 * - validate the raw input; an invalid input THROWS a friendly Vietnamese
 * message and does NOT scaffold;
 * - scaffold ONE project through the single registry (`scaffold` seam); a
 * scaffold failure THROWS the REDACTED `toFriendlyError` message — never the
 * raw engine `cause`;
 * - hand off to the staged workspace via `beginScript` (stage 1).
 * The two throws map to the renderer's rejected `invoke` promise.
 */

export interface CreateDeps {
  /** Scaffold through the ONE `createTools` registry. */
  scaffold: (
    prompt: string,
    voiceProvider: VoiceProviderChoice,
    videoLanguage: VideoLanguageChoice,
    delivery?: {
      format: VideoFormatChoice;
      durationTier: DurationTierChoice;
      /** Tier-derived pacing target (seconds). */
      targetSeconds?: number;
    },
  ) => Promise<{ ok: true; projectId: string } | { ok: false; error: SerializedPipelineError }>;
  /**
   * Hand the brief off to the WorkspaceController. With a link this runs the
   * article image crawl → (AI image preselection) → (crawled-image review) →
   * author flow; with no link it collapses to plain authoring — the controller
   * decides.
   */
  beginCreate: (projectId: string, input: AuthorInput) => void;
  /**
   * Move staged create-time images into the new project's `assetsDir` and return
   * their project-relative `assets/<sha>.<ext>` refs (create-time image staging). Only the
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
  preflight?: (
    voiceProvider: VoiceProviderChoice,
    videoLanguage: VideoLanguageChoice,
  ) => string | { message: string; voiceFailure: VoiceProviderFailure } | undefined;
  /**
   * Persist create-time BGM onto the project manifest (library track name, or
   * null for explicit silence). Best-effort: failure must not block create.
   */
  setProjectBgm?: (projectId: string, name: string | null) => Promise<void>;
}

export class CreateController {
  constructor(private readonly deps: CreateDeps) {}

  async create(
    raw: string,
    images: StagedImageRef[] = [],
    choices: {
      durationTier?: DurationTierChoice;
      videoLanguage?: VideoLanguageChoice;
      voiceProvider?: VoiceProviderChoice;
      /** Library track name, or null for no music. */
      bgm?: string | null;
    } = {},
  ): Promise<{ projectId: string }> {
    const v = validateCreateInput({ raw });
    if (!v.ok) throw new Error(VALIDATION_MESSAGE[v.reason]); // invalid ⇒ no scaffold
    // Block on a guaranteed-fatal config gap BEFORE scaffolding/authoring, so the
    // user isn't told "ready" only to have the whole AI pass burn and then fail at
    // TTS. A clean (no-message) preflight — or no preflight dep — proceeds.
    const voiceProvider = choices.voiceProvider ?? "vivibe";
    const videoLanguage = choices.videoLanguage ?? "vi";
    if ((voiceProvider === "vivibe" || voiceProvider === "vieneu") && videoLanguage === "en") {
      throw new Error(`${voiceProvider === "vieneu" ? "VieNeu Local" : "Vivibe"} chỉ hỗ trợ tiếng Việt. Hãy chọn ElevenLabs để tạo video tiếng Anh.`);
    }
    const block = this.deps.preflight?.(voiceProvider, videoLanguage);
    if (typeof block === "string") throw new Error(block);
    if (block) throw new VoiceProviderError(block.voiceFailure, block.message);
    // Short-form 9:16 only. Desktop knobs always win over any length in the prompt.
    const uiTier: DurationTierChoice = isDurationTier(choices.durationTier) ? choices.durationTier : 1;
    const resolved = resolveEffectiveDuration({
      prompt: v.brief.text,
      durationTier: uiTier,
    });
    if (resolved.conflict) {
      log.warn(
        {
          promptSeconds: resolved.conflict.promptSeconds,
          tierSeconds: resolved.conflict.tierSeconds,
          targetSeconds: resolved.targetSeconds,
          source: resolved.source,
        },
        "create duration conflict: UI tier wins over prompt length for pacing",
      );
    }
    const durationTier = resolved.durationTier as DurationTierChoice;
    const delivery = {
      format: "tiktok" as const,
      durationTier,
      targetSeconds: resolved.targetSeconds,
    };
    const res = await this.deps.scaffold(v.brief.text, voiceProvider, videoLanguage, delivery);
    if (!res.ok) throw new Error(toFriendlyError(res.error).message); // redacted friendly message
    // Create-time BGM (Home knobs) must land before skip_edit auto-full publishes.
    if (choices.bgm !== undefined && this.deps.setProjectBgm) {
      await this.deps.setProjectBgm(res.projectId, choices.bgm).catch((error) => {
        log.warn(
          { err: error, projectId: res.projectId, bgm: choices.bgm },
          "create-time BGM write failed; project continues without selection",
        );
      });
    }
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
      // Fixed format + resolved duration + language for retry/recall.
      format: "tiktok",
      durationTier,
      targetSeconds: resolved.targetSeconds,
      videoLanguage,
    }); // hand off to workspace stage 1
    return { projectId: res.projectId };
  }
}
