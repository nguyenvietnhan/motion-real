import { join } from "node:path";
import type { AuthoredRegistration } from "@motionreal/pipeline";
import type { AuthoredScene, ReauthorTarget } from "../agent/custom-loop-worker.js";
import type { ChatMessage } from "../gateway/ninerouter-client.js";
import { rawAiReplyLogFields } from "./authoring-log-policy.js";
import { normalizeAuthoredFontSizes } from "./normalize-fontsize.js";
import { normalizeAuthoredImports } from "./normalize-imports.js";
import { buildReauthorMessages } from "./prompt.js";
import { parseReauthorReply } from "./reply-parser.js";
import type { ResolvedScene, ResolveManifest } from "./scene-files.js";

type ReauthorLogger = {
  debug: (meta: unknown, message: string) => void;
  warn: (meta: unknown, message: string) => void;
  error: (meta: unknown, message: string) => void;
};

type ReauthorManifest = {
  scenes: { id: string; component: string; image?: { ref?: string } }[];
};

export type ReauthorRunnerArgs = {
  model: string;
  projectId: string;
  targets: readonly ReauthorTarget[];
  reviewDir: string;
  signal?: AbortSignal;
  loadManifest: (projectId: string) => Promise<ReauthorManifest>;
  resolveSceneFile: (
    projectId: string,
    sceneId: string,
    loadManifest: (projectId: string) => Promise<ResolveManifest>,
  ) => Promise<ResolvedScene | null>;
  readText: (path: string) => Promise<string>;
  writeText: (path: string, source: string) => Promise<void>;
  readStillDataUrl: (path: string) => string | undefined;
  chat: (model: string, messages: ChatMessage[], signal?: AbortSignal) => Promise<string>;
  admitOne: (path: string) => Promise<AuthoredRegistration>;
  unregisterComponent: (componentId: string) => void;
  logger: ReauthorLogger;
};

/**
 * Code-level self-repair for flagged authored scenes. The backend supplies all
 * filesystem, manifest, chat, admission, and registry effects; this runner owns
 * the per-scene retry, parse, fake-fix guard, and rollback policy.
 */
export async function runReauthor(args: ReauthorRunnerArgs): Promise<{ scenes: AuthoredScene[] }> {
  const done: AuthoredScene[] = [];
  const imageSceneIds = await imageSceneIdsForReauthor(args);

  for (const target of args.targets) {
    if (args.signal?.aborted) break;
    const resolved = await args.resolveSceneFile(args.projectId, target.sceneId, (id) =>
      args.loadManifest(id).catch((error) => {
        args.logger.warn({ err: error, projectId: id, sceneId: target.sceneId }, "scene manifest unreadable during reauthor resolution");
        return { scenes: [] };
      }),
    );
    if (!resolved) {
      args.logger.error({ sceneId: target.sceneId }, "[reauthor] cannot resolve authored file; skipping");
      continue;
    }

    const applied = await reauthorOneScene({ ...args, target, resolved, imageSceneIds });
    if (applied) {
      done.push({ sceneId: target.sceneId, stillPath: join(args.reviewDir, `${target.sceneId}.png`) });
    }
  }

  return { scenes: done };
}

async function imageSceneIdsForReauthor(args: ReauthorRunnerArgs): Promise<Set<string>> {
  const manifest = await args.loadManifest(args.projectId).catch((error) => {
    args.logger.warn({ err: error, projectId: args.projectId }, "reauthor manifest unreadable; image-preservation hints unavailable");
    return undefined;
  });
  return new Set(
    (manifest?.scenes ?? [])
      .filter((scene) => !!scene.image?.ref)
      .map((scene) => scene.id),
  );
}

async function reauthorOneScene(
  args: ReauthorRunnerArgs & {
    target: ReauthorTarget;
    resolved: ResolvedScene;
    imageSceneIds: Set<string>;
  },
): Promise<boolean> {
  const { componentId, path } = args.resolved;
  let originalCode: string;
  try {
    originalCode = await args.readText(path);
  } catch (error) {
    args.logger.error({ err: error, sceneId: args.target.sceneId, componentId }, "[reauthor] cannot read scene file");
    return false;
  }

  const maxAttempts = 2;
  let feedback: string | undefined;
  let lastGeneratedCode: string | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const stillDataUrl = needsVision(args.target.issues) || args.target.visual
      ? args.readStillDataUrl(join(args.reviewDir, `${args.target.sceneId}.png`))
      : undefined;
    const intent = [args.target.intent, feedback].filter((text) => text && text.trim()).join("\n\n") || undefined;
    const messages = buildReauthorMessages({
      sceneId: args.target.sceneId,
      componentId,
      currentCode: lastGeneratedCode ?? originalCode,
      ...(args.target.issues ? { issues: args.target.issues } : {}),
      ...(intent ? { intent } : {}),
      ...(stillDataUrl ? { stillDataUrl } : {}),
      ...(args.imageSceneIds.has(args.target.sceneId) ? { hasImage: true } : {}),
    });

    let reply: string;
    try {
      reply = await args.chat(args.model, messages, args.signal);
    } catch (error) {
      args.logger.error({ err: error, sceneId: args.target.sceneId }, "[reauthor] AI call failed");
      break;
    }

    const parsed = parseReauthorReply(reply, componentId);
    if (!parsed.ok) {
      args.logger.error(
        { sceneId: args.target.sceneId, reason: parsed.reason, detail: parsed.detail, ...rawAiReplyLogFields(reply) },
        "[reauthor] parse failed",
      );
      continue;
    }

    if (attempt > 0 && !isLogicChanged(lastGeneratedCode ?? originalCode, parsed.module.code)) {
      args.logger.error({ sceneId: args.target.sceneId, attempt: attempt + 1 }, "[reauthor] reject fake fix: no logic change detected");
      feedback = `Lần trước bạn không thay đổi bất kỳ logic cốt lõi nào của mã nguồn mà chỉ thay đổi khoảng trắng hoặc chú thích (comment). Bạn bắt buộc phải thay đổi mã nguồn thực tế để sửa lỗi đã nêu!`;
      continue;
    }

    lastGeneratedCode = parsed.module.code;
    await args.writeText(path, normalizeAuthoredFontSizes(normalizeAuthoredImports(parsed.module.code)));
    args.unregisterComponent(componentId);
    const admission = await args.admitOne(path);
    if (admission.ok) return true;

    const violationText = admission.violations.map((violation) => `  ${violation.check} ${violation.path}: ${violation.message}`).join("\n");
    const last = attempt + 1 >= maxAttempts;
    args.logger.error(
      { sceneId: args.target.sceneId, attempt: attempt + 1, action: last ? "rolling-back" : "retrying-with-feedback", violations: violationText },
      "[reauthor] re-admit failed",
    );
    feedback =
      `Lần trước mã bị TỪ CHỐI khi nạp:\n${violationText}\n\n` +
      `Sửa theo AUTHOR mode hiện tại: chỉ import react, remotion, zod, @motionreal/compositions; KHÔNG import @motionreal/blocks, @motionreal/theme, hay bất kỳ design/theme package nào; ` +
      `mã phải là TSX parse được, giữ nguyên id "${componentId}", chỉ dùng API được phép. Trả về lại đúng một khối tsx.`;
  }

  await args.writeText(path, originalCode);
  args.unregisterComponent(componentId);
  await args.admitOne(path).catch((error) =>
    args.logger.debug({ err: error, sceneId: args.target.sceneId, componentId }, "[reauthor] re-admit of restored original failed"),
  );
  return false;
}

/**
 * Vision-guided repair applies to objective visual layout defects represented by
 * N14. Advisory contrast/style feedback stays outside this automatic repair path.
 */
function needsVision(issues?: ReauthorTarget["issues"]): boolean {
  return (issues ?? []).some((issue) => issue.check === "N14");
}

export function isLogicChanged(oldCode: string, newCode: string): boolean {
  const clean = (s: string) => {
    const noComments = s.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, "$1");
    return noComments.replace(/\s+/g, "");
  };
  return clean(oldCode) !== clean(newCode);
}
