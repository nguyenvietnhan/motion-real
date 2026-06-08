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
  admitProjectScenes,
  writeAuthoredScene,
  emptyManifest,
  type Manifest,
  type ManifestScene,
  type AdmitProjectResult,
} from "./manifest.js";
