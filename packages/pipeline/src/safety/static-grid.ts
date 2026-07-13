import {
  validateVideoSpecStructure,
  type VideoSpec,
} from "@motionreal/schema";
import { knownComponentIds, validateProps } from "@motionreal/compositions";
import { makeReport, type SafetyIssue, type SafetyReport } from "../types.js";
import { runContentRules } from "./content-rules.js";

/**
 * Tier-1 static safety grid (N1–N9): runs on the spec BEFORE TTS/lock. Pure,
 * fast, no render. Combines:
 * - N1: structural rules (free pacing: sequential ids, single-paragraph
 * narration, scannable headline, per-scene narration floor)
 * - N2: unknown component id
 * - N3: per-component Zod prop validation
 * - N6/N7: phonetic spellings / spaced abbreviations (hard)
 * - N8: display/narration number rules (warning)
 * - N9/N26/N27: media-ban (hard), weak hook & generic CTA (warning)
 */
export type StaticGridOptions = {
  /**
   * AI-authored component ids admitted from project.tsx files. They are known
   * to the eventual Remotion bundle, but are intentionally not imported into the
   * Node host registry during admission.
   */
  authoredComponentIds?: Iterable<string>;
};

export function runStaticGrid(spec: VideoSpec, opts: StaticGridOptions = {}): SafetyReport {
  const issues: SafetyIssue[] = [];
  const authored = new Set(opts.authoredComponentIds ?? []);
  const known = new Set([...knownComponentIds(), ...authored]);

  // N1: structural (uses the registry's known ids for unknown-component detection too)
  const structural = validateVideoSpecStructure(spec, known);
  for (const message of structural.errors) {
    // Only the CRASH / no-video class hard-blocks; everything else is advisory
    // (the video renders fine, so it must not be gated). Hard:
    // - unknown component (N2) — nothing to render for that scene;
    // - empty spec — there is no video at all;
    // - duplicate scene id — the per-scene still is written to `<id>.png` and the
    // scene's React key is its id, so a duplicate collides both (broken frame
    // extraction + caption routing); never a legitimate authored choice.
    // Advisory (warnings): a non-sequential `scene-NN` id (a cosmetic convention —
    // the renderer keys by whatever id is given), a multiline narration (TTS +
    // captions tolerate it), and the headline/narration word-count floors (a long
    // headline that truly overflows is still caught by render-oracle N14).
    const isUnknownComponent = /unknown component/i.test(message);
    const isEmptySpec = /at least one scene|must contain scenes/i.test(message);
    const isDuplicateId = /duplicate scene id/i.test(message);
    const isHard = isUnknownComponent || isEmptySpec || isDuplicateId;
    issues.push({
      check: isUnknownComponent ? "N2" : "N1",
      severity: isHard ? "error" : "warning",
      sceneId: message.match(/\bscene-[0-9]{2}\b/)?.[0],
      message,
    });
  }

  // N3: per-component prop validation against each component's Zod schema.
  // The framework passes `headline`/`eyebrow`/`body`/`image` to a scene as
  // TOP-LEVEL props (`SceneComponentProps`, beside `props`), NOT inside `props`.
  // But models recurrently declare them INSIDE the authored `schema` (`schema:
  // z.object({ headline: z.string, … })`) — then `validateProps(component,
  // scene.props)` sees `props={}` and reports a phantom "headline: expected
  // string, received undefined", a wall of hard errors that blocks a video which
  // would otherwise render fine (at render time `headline` arrives top-level). So
  // validate against the MERGED view: a correct schema (props-only) strips the
  // extra top-level keys by Zod's default, and a schema that mistakenly declares
  // them is satisfied by the real top-level values. Mirrors the `theme.colors`
  // tolerance philosophy — an AI contract-boundary slip must not hard-block a
  // renderable video.
  for (const scene of spec.scenes) {
    if (!known.has(scene.component)) continue; // N2 already flagged it
    if (authored.has(scene.component)) continue; // schema lives in untrusted authored code; N10/render gates cover crash-class failures.
    const mergedProps = {
      ...(scene.props ?? {}),
      headline: scene.headline,
      ...(scene.eyebrow !== undefined ? { eyebrow: scene.eyebrow } : {}),
      ...(scene.body !== undefined ? { body: scene.body } : {}),
      ...(scene.image !== undefined ? { image: scene.image } : {}),
    };
    const result = validateProps(scene.component, mergedProps);
    if (!result.ok) {
      for (const err of result.errors) {
        issues.push({
          check: "N3",
          // Prop-shape mismatch is ADVISORY, not a hard block. Authored scenes
          // carry defaults and a render-time error boundary catches real crashes,
          // so a Zod mismatch must not stop a video that otherwise renders.
          severity: "warning",
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
