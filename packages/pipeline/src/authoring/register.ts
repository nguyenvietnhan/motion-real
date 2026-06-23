import type { SafetyIssue } from "../types.js";
import {
  admitAuthoredComponent,
  admitAuthoredTransition,
  DEFAULT_ADMISSION_POLICY,
  DEFAULT_TRANSITION_ADMISSION_POLICY,
  type AdmissionPolicy,
} from "./admission.js";

/**
 * Authored admission handshake without host execution.
 *
 * SECURITY boundary: authored .tsx is untrusted model output. It must be parsed
 * and admitted before bundling, but it must NOT be imported into the Electron /
 * Node host process. The Remotion render entry imports admitted authored scenes
 * later inside the browser render context so their registerComponent side effect
 * reaches the runtime registry without giving top-level code host privileges.
 */

export type AuthoredRegistration =
  | { ok: true; componentId: string }
  | { ok: false; violations: SafetyIssue[] };

export type AuthoredTransitionRegistration =
  | { ok: true; transitionId: string }
  | { ok: false; violations: SafetyIssue[] };

export type AdmitAuthoredSceneOptions = {
  policy?: AdmissionPolicy;
};

/**
 * Admit one authored scene module and return its component id. Pure with respect
 * to authored code: reads/parses the file only; never imports or executes it.
 */
export async function admitAuthoredSceneFile(
  tsxPath: string,
  options: AdmitAuthoredSceneOptions = {},
): Promise<AuthoredRegistration> {
  const admission = admitAuthoredComponent(tsxPath, options.policy ?? DEFAULT_ADMISSION_POLICY);
  if (!admission.admitted) {
    return { ok: false, violations: admission.violations };
  }
  return { ok: true, componentId: admission.componentId };
}

/**
 * Admit one authored boundary-transition module and return its transition id.
 * Pure with respect to authored code: reads/parses the file only; never imports
 * or executes it.
 */
export async function admitAuthoredTransitionFile(
  tsxPath: string,
  options: AdmitAuthoredSceneOptions = {},
): Promise<AuthoredTransitionRegistration> {
  const admission = admitAuthoredTransition(tsxPath, options.policy ?? DEFAULT_TRANSITION_ADMISSION_POLICY);
  if (!admission.admitted) {
    return { ok: false, violations: admission.violations };
  }
  return { ok: true, transitionId: admission.transitionId };
}
