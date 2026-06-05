import {
  validateVideoSpecStructure,
  type VideoSpec,
} from "@news/schema";
import { knownComponentIds, validateProps } from "@news/compositions";
import { makeReport, type SafetyIssue, type SafetyReport } from "../types.js";
import { runContentRules } from "./content-rules.js";

/**
 * Tier-1 static safety grid (N1–N9): runs on the spec BEFORE TTS/lock. Pure,
 * fast, no render. Combines:
 *  - N1: structural rules (scene count/bounds, duration sum, ids, pacing)
 *  - N2: unknown component id
 *  - N3: per-component Zod prop validation
 *  - N6/N7: phonetic spellings / spaced abbreviations (hard)
 *  - N8: display/narration number rules (warning)
 *  - N9/N26/N27: media-ban (hard), weak hook & generic CTA (warning)
 */
export function runStaticGrid(spec: VideoSpec): SafetyReport {
  const issues: SafetyIssue[] = [];
  const known = knownComponentIds();

  // N1: structural (uses the registry's known ids for unknown-component detection too)
  const structural = validateVideoSpecStructure(spec, known);
  for (const message of structural.errors) {
    // Unknown-component messages are tagged N2; everything else is N1.
    const isUnknownComponent = /unknown component/i.test(message);
    issues.push({
      check: isUnknownComponent ? "N2" : "N1",
      severity: isUnknownComponent || !/words; minimum|too short/i.test(message) ? "error" : "warning",
      sceneId: message.match(/\bscene-[0-9]{2}\b/)?.[0],
      message,
    });
  }

  // N3: per-component prop validation against each component's Zod schema.
  for (const scene of spec.scenes) {
    if (!known.has(scene.component)) continue; // N2 already flagged it
    const result = validateProps(scene.component, scene.props ?? {});
    if (!result.ok) {
      for (const err of result.errors) {
        issues.push({
          check: "N3",
          severity: "error",
          sceneId: scene.id,
          path: err.path || undefined,
          message: `${scene.id} ${scene.component} props invalid at "${err.path || "(root)"}": ${err.message}`,
        });
      }
    }
  }

  // N6–N9 / N26 / N27: content rules
  issues.push(...runContentRules(spec));

  return makeReport(issues, ["lint"]);
}
