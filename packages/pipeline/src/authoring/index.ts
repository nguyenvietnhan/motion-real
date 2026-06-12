// Re-export the registry seams authored scenes rely on so leaf packages (e.g.
// the desktop backend) can drive the registry through the @news/pipeline barrel.
export { unregisterComponent } from "@news/compositions";
export {
  admitAuthoredComponent,
  DEFAULT_ADMISSION_POLICY,
  type AdmissionPolicy,
  type AdmissionResult,
} from "./admission.js";
export {
  admitAndRegisterAuthored,
  setAuthoredLoader,
  type AuthoredRegistration,
  type AdmitAndRegisterOptions,
} from "./register.js";
export {
  scaffoldProject,
  loadManifest,
  loadManifestAsSpec,
  manifestToVideoSpec,
  listAuthoredScenes,
  manifestSceneFiles,
  admitProjectScenes,
  writeAuthoredScene,
  emptyManifest,
  type Manifest,
  type ManifestScene,
  type ManifestSceneFile,
  type AdmitProjectResult,
} from "./manifest.js";
export { parseDurationFromPrompt } from "./parse-duration.js";
