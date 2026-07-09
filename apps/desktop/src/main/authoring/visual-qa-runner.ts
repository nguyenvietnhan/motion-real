import { join } from "node:path";
import type { AuthoredRegistration } from "@motionreal/pipeline";
import type { VisualDefect, SceneSnapshot } from "../agent/agent-worker.js";
import type { ChatMessage } from "../gateway/ninerouter-client.js";
import { logAuthoringFailure } from "./authoring-failure.js";
import { extractJsonObject } from "./manifest-schema.js";
import { buildVisualQaMessages } from "./prompt.js";
import type { ResolvedScene, ResolveManifest } from "./scene-files.js";

type VisualQaLogger = {
  debug: (meta: unknown, message: string) => void;
  warn: (meta: unknown, message: string) => void;
  error: (meta: unknown, message: string) => void;
};

type VisualQaManifest = {
  scenes: { id: string }[];
};

export type VisualQaRunnerArgs = {
  model?: string;
  projectId: string;
  sceneIds?: string[];
  signal?: AbortSignal;
  loadManifest: (projectId: string) => Promise<VisualQaManifest | null>;
  reviewDir: string;
  readStillDataUrl: (path: string) => string | undefined;
  /**
   * Full multimodal chat. Visual QA intentionally does NOT use vision-fallback
   * text-only degradation — preserve that contract at the call site.
   */
  chat: (model: string, messages: ChatMessage[], signal?: AbortSignal) => Promise<string>;
  logger: VisualQaLogger;
};

export type SceneSnapshotArgs = {
  projectId: string;
  sceneIds: readonly string[];
  loadManifest: (projectId: string) => Promise<ResolveManifest>;
  resolveSceneFile: (
    projectId: string,
    sceneId: string,
    loadManifest: (projectId: string) => Promise<ResolveManifest>,
  ) => Promise<ResolvedScene | null>;
  readText: (path: string) => Promise<string>;
  logger: VisualQaLogger;
};

export type SceneRestoreArgs = {
  projectId: string;
  snapshot: SceneSnapshot;
  loadManifest: (projectId: string) => Promise<ResolveManifest>;
  resolveSceneFile: (
    projectId: string,
    sceneId: string,
    loadManifest: (projectId: string) => Promise<ResolveManifest>,
  ) => Promise<ResolvedScene | null>;
  writeText: (path: string, source: string) => Promise<void>;
  unregisterComponent: (componentId: string) => void;
  admitOne: (path: string) => Promise<AuthoredRegistration>;
  logger: VisualQaLogger;
};

/** Parse the visual-QA JSON reply into high-severity, known-scene defects (tolerant). */
export function parseVisualDefects(
  reply: string,
  knownScenes: Set<string>,
  logger?: VisualQaLogger,
): VisualDefect[] {
  const json = extractJsonObject(reply);
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    if (logger) {
      logAuthoringFailure(
        logger,
        { class: "visual-qa-parse", err: error },
        "visual-QA JSON parse failed; treating reply as no defects",
        "warn",
      );
    }
    return [];
  }
  const issues = (raw as { issues?: unknown })?.issues;
  if (!Array.isArray(issues)) return [];
  const out: VisualDefect[] = [];
  const seen = new Set<string>();
  for (const it of issues) {
    const o = it as { sceneId?: unknown; issue?: unknown; severity?: unknown };
    const sceneId = typeof o.sceneId === "string" ? o.sceneId : "";
    const issue = typeof o.issue === "string" ? o.issue.trim() : "";
    const severity = typeof o.severity === "string" ? o.severity.toLowerCase() : "high";
    // Only act on clearly-flagged, known scenes; ignore "low" hunches + hallucinated ids.
    if (severity !== "high" || !knownScenes.has(sceneId) || issue === "" || seen.has(sceneId)) continue;
    seen.add(sceneId);
    out.push({ sceneId, issue });
  }
  return out;
}

/**
 * Best-effort AI visual layout QA on rendered stills. No model, no stills, a
 * vision failure, or an unparseable reply all yield `[]` (never block pipeline).
 */
export async function runVisualQa(args: VisualQaRunnerArgs): Promise<VisualDefect[]> {
  if (!args.model) return [];
  const manifest = await args.loadManifest(args.projectId);
  if (!manifest) return [];

  const wanted = args.sceneIds && args.sceneIds.length > 0 ? new Set(args.sceneIds) : null;
  const known = new Set<string>();
  const scenes: { sceneId: string; stillDataUrl: string }[] = [];
  for (const s of manifest.scenes) {
    if (wanted && !wanted.has(s.id)) continue;
    known.add(s.id);
    const url = args.readStillDataUrl(join(args.reviewDir, `${s.id}.png`));
    if (url) scenes.push({ sceneId: s.id, stillDataUrl: url });
  }
  if (scenes.length === 0) return [];

  let reply: string;
  try {
    reply = await args.chat(args.model, buildVisualQaMessages(scenes), args.signal);
  } catch (error) {
    logAuthoringFailure(
      args.logger,
      { class: "visual-qa-provider", projectId: args.projectId, err: error },
      "[visual-qa] vision call failed; skipping QA",
      "warn",
    );
    return [];
  }
  return parseVisualDefects(reply, known, args.logger);
}

/** Snapshot the current authored source of the named scenes (for QA rollback). */
export async function snapshotAuthoredScenes(args: SceneSnapshotArgs): Promise<SceneSnapshot> {
  const snap: SceneSnapshot = [];
  for (const sceneId of args.sceneIds) {
    const resolved = await args.resolveSceneFile(args.projectId, sceneId, args.loadManifest);
    if (!resolved) continue;
    try {
      snap.push({ sceneId, code: await args.readText(resolved.path) });
    } catch (e) {
      args.logger.warn({ err: e, projectId: args.projectId, sceneId }, "[visual-qa] snapshot read failed");
    }
  }
  return snap;
}

/** Restore authored source from a snapshot + re-admit so the next render uses it. */
export async function restoreAuthoredScenes(args: SceneRestoreArgs): Promise<void> {
  for (const { sceneId, code } of args.snapshot) {
    const resolved = await args.resolveSceneFile(args.projectId, sceneId, args.loadManifest);
    if (!resolved) continue;
    try {
      await args.writeText(resolved.path, code);
      args.unregisterComponent(resolved.componentId);
      await args.admitOne(resolved.path).catch((e) =>
        args.logger.debug({ err: e, projectId: args.projectId, sceneId }, "[visual-qa] re-admit after restore failed"),
      );
    } catch (e) {
      args.logger.warn({ err: e, projectId: args.projectId, sceneId }, "[visual-qa] restore failed");
    }
  }
}
