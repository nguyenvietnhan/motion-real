import type { PrepromptPayload } from "../agent/agent-worker.js";

/**
 * Edit routing (web-dashboard Task 4.9, design §edit routing, Req 8.6/8.7/8.8/
 * 8.14). The MOST safety-relevant pure logic in the app: it decides which edits
 * apply directly to the manifest (no AI) and which require re-authoring.
 *
 * Property 7: every `plain-text` edit applies to the manifest with NO AI; every
 * `visual` edit re-authors ONLY its named scene id (the re-rendered set is a
 * subset of the visually-edited ids). Plain-text edits are routed through the
 * engine's content normalization before the manifest write (done by the caller).
 */

export type EditClass = "plain-text" | "visual";

export type ParsedSceneEdit = {
  sceneId: string;
  /** A plain-text edit only changes the WORDING of these fields. */
  textChanges?: Partial<{ headline: string; narration: string; cta: string }>;
  /** Anything else (imagery, layout, structure, restyle) is a visual intent. */
  visualIntent?: string;
};

export type PlainTextEdit = {
  sceneId: string;
  textChanges: Partial<{ headline: string; narration: string; cta: string }>;
};

export type RouteResult = {
  plainText: PlainTextEdit[];
  visual: { sceneIds: string[]; preprompt: PrepromptPayload };
};

const hasVisualIntent = (e: ParsedSceneEdit): boolean => (e.visualIntent ?? "").trim().length > 0;

const hasTextChanges = (e: ParsedSceneEdit): boolean =>
  e.textChanges !== undefined &&
  (["headline", "narration", "cta"] as const).some((k) => e.textChanges?.[k] !== undefined);

/**
 * Pure, total. An edit is `plain-text` ONLY when it carries wording changes and
 * NO visual intent; everything else (a visual intent, or an empty/ambiguous
 * edit) is `visual` so it goes through the Agent_Worker rather than silently
 * skipping a real change.
 */
export function classify(edit: ParsedSceneEdit): EditClass {
  if (hasVisualIntent(edit)) return "visual";
  if (hasTextChanges(edit)) return "plain-text";
  return "visual";
}

function distinct(ids: string[]): string[] {
  return [...new Set(ids)];
}

/** Split parsed edits + global notes into the two execution paths. */
export function routeEdits(edits: ParsedSceneEdit[], globalNotes: string): RouteResult {
  const plainText: PlainTextEdit[] = [];
  const visualIds: string[] = [];
  const perSceneIntent: Record<string, string> = {};

  for (const edit of edits) {
    if (classify(edit) === "visual") {
      visualIds.push(edit.sceneId);
      perSceneIntent[edit.sceneId] = (edit.visualIntent ?? "").trim();
    } else {
      plainText.push({ sceneId: edit.sceneId, textChanges: { ...edit.textChanges } });
    }
  }

  const affectedSceneIds = distinct(visualIds);
  const preprompt: PrepromptPayload = {
    contractRef: "SKILL.md+AGENTS.md",
    affectedSceneIds,
    perSceneIntent,
    globalNotes,
  };
  return { plainText, visual: { sceneIds: affectedSceneIds, preprompt } };
}
