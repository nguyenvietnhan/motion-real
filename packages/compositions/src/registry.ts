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

export type SceneTransitionProps = {
  /** 0→1 progress across the fixed transition overlap. */
  progress: number;
  /** Whether this wrapper is rendering the outgoing or incoming scene. */
  direction: "entering" | "exiting";
  /** Fixed transition length in frames for this render. */
  durationInFrames: number;
  /** The scene content that must remain mounted during the transition. */
  children: React.ReactNode;
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
  /**
   * Optional AI-authored visual transition from this scene into the next one.
   * Runtime still owns timing/audio; this component only wraps entering/exiting
   * pixels during the fixed transition overlap.
   */
  transitionToNext?: React.FC<SceneTransitionProps>;
  /** Example payload used for docs and fixtures. */
  example: P;
};

const registry = new Map<string, SceneComponentDefinition>();

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
