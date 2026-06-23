import type React from "react";
import { z } from "zod";
import type { SceneImage } from "@news/schema";

/**
 * Open, extensible component registry. Each scene component declares its own
 * prop schema so validation lives next to the visual — adding a new visual is
 * "write a component + register it", not "edit a 40-entry enum and a giant
 * switch statement". This is the core of the stability/diversity tradeoff:
 * diversity is unbounded code, stability comes from per-component schemas.
 */

export type SceneComponentProps<P = Record<string, unknown>> = {
  headline: string;
  body?: string;
  eyebrow?: string;
  props: P;
  /**
   * The scene's single optional LOCAL image (≤1 per scene; see
   * `SceneImageSchema`). Render it via the sanctioned `<SceneImage>` block —
   * authored `.tsx` cannot import `Img`/`staticFile` directly (admission N5).
   */
  image?: SceneImage;
};

export type BoundarySceneInfo = {
  id: string;
  component: string;
  headline: string;
  body?: string;
  eyebrow?: string;
  narration: string;
  props: Record<string, unknown>;
  startFrame: number;
  durationInFrames: number;
};

export type SceneBoundaryTransitionProps = {
  /** Normalized transition progress through this boundary, clamped to [0, 1]. */
  progress: number;
  /** Fixed boundary duration in frames. */
  durationInFrames: number;
  /** Stable boundary id, e.g. "scene-01-to-scene-02". */
  boundaryId: string;
  /** Rendered outgoing scene layer at the correct local frame. */
  from: React.ReactNode;
  /** Rendered incoming scene layer at the correct local frame. */
  to: React.ReactNode;
  /** Metadata for the outgoing scene. */
  fromScene: BoundarySceneInfo;
  /** Metadata for the incoming scene. */
  toScene: BoundarySceneInfo;
};

export type SceneComponentDefinition<P = any> = {
  id: string;
  displayName: string;
  /** Short guidance for the AI planner on when to pick this component. */
  promptGuide: string;
  /** Zod schema for the `props` payload this component expects. */
  schema: z.ZodType<P>;
  /** The React component that renders the scene's visual. */
  Component: React.FC<SceneComponentProps<P>>;
  /** Example payload used for docs and fixtures. */
  example: P;
};

export type SceneBoundaryTransitionDefinition = {
  id: string;
  displayName: string;
  /** The React component that owns the full-frame transition stage. */
  Component: React.FC<SceneBoundaryTransitionProps>;
};

const registry = new Map<string, SceneComponentDefinition>();
const transitionRegistry = new Map<string, SceneBoundaryTransitionDefinition>();

export function registerComponent<P>(def: SceneComponentDefinition<P>): SceneComponentDefinition<P> {
  if (registry.has(def.id)) {
    throw new Error(`Duplicate scene component id: ${def.id}`);
  }
  registry.set(def.id, def as SceneComponentDefinition);
  return def;
}

export function getComponent(id: string): SceneComponentDefinition | undefined {
  return registry.get(id);
}

export function unregisterComponent(id: string): void {
  registry.delete(id);
}

export function listComponents(): SceneComponentDefinition[] {
  return [...registry.values()];
}

export function knownComponentIds(): ReadonlySet<string> {
  return new Set(registry.keys());
}

export function registerTransition(def: SceneBoundaryTransitionDefinition): SceneBoundaryTransitionDefinition {
  if (transitionRegistry.has(def.id)) {
    throw new Error(`Duplicate scene transition id: ${def.id}`);
  }
  transitionRegistry.set(def.id, def);
  return def;
}

export function getTransition(id: string): SceneBoundaryTransitionDefinition | undefined {
  return transitionRegistry.get(id);
}

export function unregisterTransition(id: string): void {
  transitionRegistry.delete(id);
}

export function listTransitions(): SceneBoundaryTransitionDefinition[] {
  return [...transitionRegistry.values()];
}

export type PropValidationIssue = { path: string; message: string };

export function validateProps(
  componentId: string,
  props: unknown,
): { ok: boolean; errors: PropValidationIssue[] } {
  const def = registry.get(componentId);
  if (!def) {
    return { ok: false, errors: [{ path: "", message: `Unknown component "${componentId}".` }] };
  }
  const result = def.schema.safeParse(props);
  if (result.success) return { ok: true, errors: [] };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}
