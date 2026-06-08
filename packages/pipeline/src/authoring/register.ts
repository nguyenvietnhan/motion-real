import { pathToFileURL } from "node:url";
import { getComponent, registerComponent, validateProps, type SceneComponentDefinition } from "@news/compositions";
import type { SafetyIssue } from "../types.js";
import { admitAuthoredComponent, DEFAULT_ADMISSION_POLICY, type AdmissionPolicy } from "./admission.js";

/**
 * The authored-component handshake (Requirement 13.4). An AI-authored scene id
 * may be referenced by the planner ONLY after it (1) passes the static AST
 * admission gate, then (2) successfully self-registers via the normal
 * registerComponent path and exposes a `schema` + an `example` that parses
 * against it. This module wires (1)→(2): admission first (so a banned module is
 * never imported), and only on success does it import the module to complete the
 * runtime registration handshake.
 *
 * "Sandboxing" note: scene code only ever executes inside the Remotion
 * webpack/Chromium render context; this handshake performs the registration
 * verification (registry + zod) without granting scene code any Node authority,
 * and the AST gate has already proven no fs/process/network/eval reach the
 * loader. Full bundling reuses the renderer's webpack override.
 */

export type AuthoredRegistration =
  | { ok: true; componentId: string }
  | { ok: false; violations: SafetyIssue[] };

/**
 * A process-wide default loader for the registration handshake. Hosts whose
 * runtime cannot `import()` a `.tsx` directly (e.g. the bundled Electron main,
 * which is plain Node ESM with no `.tsx` loader) register one here at startup so
 * EVERY admission call — including the one inside `renderProject` — uses it,
 * without threading the loader through every layer. The `npx tsx` build-script
 * path leaves this unset and falls back to a plain dynamic import.
 */
let defaultLoad: ((fileUrl: string) => Promise<unknown>) | undefined;

/** Set (or clear) the process-wide default authored-module loader. */
export function setAuthoredLoader(load: ((fileUrl: string) => Promise<unknown>) | undefined): void {
  defaultLoad = load;
}

export type AdmitAndRegisterOptions = {
  policy?: AdmissionPolicy;
  /** Injectable importer (defaults to a real dynamic import); used by tests. */
  load?: (fileUrl: string) => Promise<unknown>;
};

/**
 * Admit an authored module and, if admitted, complete the registration
 * handshake. Returns the component id on success or the blocking violations.
 */
export async function admitAndRegisterAuthored(
  tsxPath: string,
  options: AdmitAndRegisterOptions = {},
): Promise<AuthoredRegistration> {
  const policy = options.policy ?? DEFAULT_ADMISSION_POLICY;
  const admission = admitAuthoredComponent(tsxPath, policy);
  if (!admission.admitted) {
    return { ok: false, violations: admission.violations };
  }

  const componentId = admission.componentId;
  const load = options.load ?? defaultLoad ?? ((url: string) => import(url));

  let mod: Record<string, unknown>;
  try {
    mod = (await load(pathToFileURL(tsxPath).href)) as Record<string, unknown>;
  } catch (error) {
    return {
      ok: false,
      violations: [
        {
          check: "N4",
          severity: "error",
          path: tsxPath,
          message: `Authored module failed to load during the registration handshake: ${msg(error)}`,
        },
      ],
    };
  }

  const violations: SafetyIssue[] = [];

  // The import side-effect must have registered the component under its id.
  // When an authored file is loaded from the project store, package resolution can
  // occasionally materialize a second @news/compositions registry instance via
  // the workspace junction. In that case the default export is still the
  // component definition returned by registerComponent(...); mirror it into this
  // registry before treating the handshake as failed.
  if (!getComponent(componentId) && isSceneDefinition(mod.default, componentId)) {
    try {
      registerComponent(mod.default);
    } catch (error) {
      violations.push({
        check: "N4",
        severity: "error",
        path: tsxPath,
        message: `Authored module default export could not be mirrored into the registry: ${msg(error)}`,
      });
    }
  }

  if (!getComponent(componentId)) {
    violations.push({
      check: "N4",
      severity: "error",
      path: tsxPath,
      message: `Authored module did not register a component with id "${componentId}" on import.`,
    });
  }

  // `example` must parse against the registered component's schema (N3-style).
  if (mod.example === undefined) {
    violations.push({ check: "N4", severity: "error", path: tsxPath, message: 'Authored module is missing the `example` export.' });
  } else if (getComponent(componentId)) {
    const result = validateProps(componentId, mod.example);
    if (!result.ok) {
      for (const err of result.errors) {
        violations.push({
          check: "N3",
          severity: "error",
          path: `${tsxPath}#example${err.path ? `.${err.path}` : ""}`,
          message: `Authored example does not satisfy its own schema: ${err.message}`,
        });
      }
    }
  }

  if (mod.schema === undefined) {
    violations.push({ check: "N4", severity: "error", path: tsxPath, message: 'Authored module is missing the `schema` export.' });
  }

  if (violations.length > 0) return { ok: false, violations };
  return { ok: true, componentId };
}

function isSceneDefinition(value: unknown, componentId: string): value is SceneComponentDefinition {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SceneComponentDefinition>;
  return candidate.id === componentId && Boolean(candidate.schema) && typeof candidate.Component === "function";
}

function msg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
