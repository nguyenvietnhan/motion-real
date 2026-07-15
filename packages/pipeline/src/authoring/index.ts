// Re-export the registry seams authored scenes rely on so leaf packages (e.g.
// the desktop backend) can drive the registry through the @motionreal/pipeline barrel.
export { unregisterComponent } from "@motionreal/compositions";
export {
  admitAuthoredComponent,
  type AdmissionResult,
} from "./admission.js";
export {
  admitAuthoredSceneFile,
  type AuthoredRegistration,
} from "./register.js";
export {
  scaffoldProject,
  loadManifest,
  loadManifestAsSpec,
  manifestToVideoSpec,
  listAuthoredScenes,
  manifestSceneFiles,
  admitAuthoredSceneFiles,
  admitProjectScenes,
  writeAuthoredScene,
  emptyManifest,
  type Manifest,
  type ManifestScene,
  type ManifestSceneFile,
  type AdmitProjectResult,
} from "./manifest.js";
export {
  parseDurationSecondsFromPrompt,
  resolveEffectiveDuration,
  nearestDurationTier,
  isDurationTier,
  type EffectiveDuration,
  type EffectiveDurationSource,
} from "./parse-duration.js";
export {
  normalizeAuthoredSource,
  stripReactNativeStyleKeys,
  isReactNativeStyleKey,
  isCssStyleObjectLiteral,
  REACT_NATIVE_STYLE_KEYS,
} from "./normalize-authored-source.js";
