import type { SafetyIssue } from "../types.js";
import { admitAuthoredComponent } from "./admission.js";

/**
 * Authored admission handshake without host execution.
 *
 * SECURITY boundary: authored.tsx is untrusted model output. It must be parsed
 * and admitted before bundling, but it must NOT be imported into the Electron /
 * Node host process. The Remotion render entry imports admitted authored scenes
 * later inside the browser render context so their registerComponent side effect
 * reaches the runtime registry without giving top-level code host privileges.
 */

export type AuthoredRegistration =
  | { ok: true; componentId: string }
  | { ok: false; violations: SafetyIssue[] };

/**
 * Admit one authored scene module and return its component id. Pure with respect
 * to authored code: reads/parses the file only; never imports or executes it.
 */
export async function admitAuthoredSceneFile(tsxPath: string): Promise<AuthoredRegistration> {
  const admission = admitAuthoredComponent(tsxPath);
  if (!admission.admitted) {
    return { ok: false, violations: admission.violations };
  }
  return { ok: true, componentId: admission.componentId };
}
