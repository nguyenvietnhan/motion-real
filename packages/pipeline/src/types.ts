import type { DurationPreset, VideoSpec, LockedVideoSpec } from "@news/schema";

/**
 * Pipeline-level data models. The contract types (VideoSpec / LockedVideoSpec)
 * live in @news/schema; these are the orchestration/persistence/safety models
 * that wrap them, mirroring news_video_tool's project status + tts manifest and
 * math_video_tool's build report.
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

export type TtsProvider = "vivibe" | "mock" | "none";
export type AiProvider = "mock" | "openai-compatible" | "deepseek";

/** Persisted project state (brief.json). */
export type ProjectBrief = {
  projectId: string;
  prompt: string;
  duration: DurationPreset;
  styleId: "clean-luxury-tech";
  ratio: "9:16";
  language: "vi";
  aiProvider: AiProvider;
  tts: {
    provider: TtsProvider;
    voiceId?: string;
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
  voiceId: string;
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
