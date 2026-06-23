// Re-export the registry seams authored modules rely on so leaf packages (e.g.
// the desktop backend) can drive the registry through the @news/pipeline barrel.
export { unregisterComponent, unregisterTransition } from "@news/compositions";
export {
  admitAuthoredComponent,
  admitAuthoredTransition,
  DEFAULT_ADMISSION_POLICY,
  DEFAULT_TRANSITION_ADMISSION_POLICY,
  type AdmissionPolicy,
  type AdmissionResult,
  type TransitionAdmissionResult,
} from "./admission.js";
export {
  admitAuthoredSceneFile,
  admitAuthoredTransitionFile,
  type AuthoredRegistration,
  type AuthoredTransitionRegistration,
  type AdmitAuthoredSceneOptions,
} from "./register.js";
export {
  scaffoldProject,
  loadManifest,
  loadManifestAsSpec,
  manifestToVideoSpec,
  listAuthoredScenes,
  listAuthoredTransitions,
  manifestSceneFiles,
  manifestTransitionFiles,
  manifestBoundaryTransitionIds,
  admitProjectScenes,
  admitProjectAuthored,
  writeAuthoredScene,
  transitionFileName,
  emptyManifest,
  AUTHORED_TRANSITION_FILE_PREFIX,
  type Manifest,
  type ManifestScene,
  type ManifestSceneFile,
  type ManifestTransitionFile,
  type AdmitProjectResult,
  type AdmitProjectAuthoredResult,
  type AdmitProjectAuthoredOptions,
  type AuthoredComponentFile,
  type AuthoredTransitionFile,
} from "./manifest.js";
export { parseDurationFromPrompt } from "./parse-duration.js";
export {
  admitHyperframesScene,
  admitProjectHyperframes,
  ensureHyperframesVendor,
  hyperframesSceneFileName,
  hyperframesScenePath,
  listHyperframesSceneFiles,
  normalizeHyperframesSceneHtml,
  readHyperframesSceneSources,
  writeHyperframesScene,
  type HyperframesProjectAdmissionResult,
  type HyperframesSceneAdmissionContext,
  type HyperframesSceneAdmissionResult,
} from "./hyperframes.js";
