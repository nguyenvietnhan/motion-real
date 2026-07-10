import type { DurationPreset, DurationTier, VideoFormat, VideoSpec, LockedVideoSpec } from "@motionreal/schema";

/**
 * Pipeline-level data models. Contract types (VideoSpec / LockedVideoSpec) live
 * in @motionreal/schema; these are orchestration, persistence, and safety
 * models that wrap them (project state, TTS manifests, safety reports).
 */

export type ProjectState =
  | "planning"
  | "planned"
  | "scaffolded"
  | "tts"
  | "locking"
  | "rendering"
  | "reviewing"
  | "done"
  | "failed";

export type VoiceProvider = "vivibe" | "elevenlabs";
export type TtsProvider = VoiceProvider | "mock" | "none";
export type AiProvider = "mock" | "openai-compatible" | "deepseek";
export type VideoLanguage = "vi" | "en";

/** Persisted project state (brief.json). */
export type ProjectBrief = {
  projectId: string;
  prompt: string;
  duration: number;
  /** Delivery format selected at create time, persisted so retry after restart keeps the same prompt budget/geometry. */
  format?: VideoFormat;
  /** User-selected duration bucket; authoring retries use this to avoid falling back to tier 1 after restart. */
  durationTier?: DurationTier;
  ratio: "9:16";
  language: VideoLanguage;
  aiProvider: AiProvider;
  tts: {
    provider: TtsProvider;
    voiceId?: string;
    modelId?: string;
    speed: number;
  };
  state: ProjectState;
  currentStep: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

/** A single appended lifecycle event (events.ndjson). */
export type ProjectEvent = {
  type: string;
  at: string;
  [key: string]: unknown;
};

/** Renderer-safe diagnostic entry projected from project events (fixed language). */
export type ProjectDiagnosticEntry = {
  at: string;
  kind: "lifecycle" | "authoring" | "repair" | "warning" | "error";
  state: "info" | "warning" | "error" | "resolved" | "reverted";
  message: string;
  sceneId?: string;
};

export type ProjectDiagnostics = {
  projectId: string;
  entries: ProjectDiagnosticEntry[];
  truncated: boolean;
};

/** Per-scene TTS synthesis record used for locking + caching. */
export type TtsManifestScene = {
  text: string;
  voiceId: string;
  speed: number;
  audioPath: string; // absolute path to the synthesized clip
  duration: number; // measured seconds
  source: "synthesized" | "cached" | "mock" | "skipped";
  /** Parsed SRT segments (relative seconds) for caption timing, when available. */
  srt?: Array<{ startSec: number; endSec: number; text: string }>;
};

/** tts-manifest.json */
export type TtsManifest = {
  updatedAt: string;
  provider: TtsProvider;
  voiceId: string;
  modelId?: string;
  speed: number;
  byScene: Record<string, TtsManifestScene>;
  /** project-relative path to the concatenated (+ optional BGM) narration track */
  mixedSrc?: string;
};

// --- Safety grid models (the analogue of mvlib's build report) ---

export type Severity = "error" | "warning";

export type SafetyTier = "lint" | "build" | "render" | "review";

export type SafetyIssue = {
  check: string; // "N1", "N14", ...
  severity: Severity;
  sceneId?: string;
  path?: string; // prop path or file path
  message: string;
};

export type SafetyReport = {
  ok: boolean; // false iff any issue has severity "error"
  issues: SafetyIssue[];
  ranTiers: SafetyTier[];
};

/** Perceptual review checklist — the mandatory human-eye gate before "done". */
export type ReviewChecklist = {
  safeArea: boolean; // nothing clipped at 9:16 edges
  alignment: boolean; // headings/blocks aligned, no drift
  transitions: boolean; // no hard cuts / flicker between scenes
  clutter: boolean; // not too many simultaneous blocks
  hook: boolean; // scene-01 hooks in first 3s, no greeting/definition
  cta: boolean; // final scene CTA is topic-specific
  audio: boolean; // voice complete, not cut/rushed, in sync
  richness: boolean; // long scenes show motion, not just static fades
};

/** Convenience re-exports so pipeline consumers import from one place. */
export type { VideoSpec, LockedVideoSpec, DurationPreset };

/**
 * Build a SafetyReport from a list of issues and the tiers that ran.
 * ok is false iff any issue is an error.
 */
export function makeReport(issues: SafetyIssue[], ranTiers: SafetyTier[]): SafetyReport {
  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
    ranTiers,
  };
}

/** Aggregate multiple reports; any error in any report blocks. */
export function gate(reports: SafetyReport[]): { ok: boolean; issues: SafetyIssue[] } {
  const issues = reports.flatMap((report) => report.issues);
  return { ok: !issues.some((issue) => issue.severity === "error"), issues };
}
