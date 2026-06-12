export { runStaticGrid } from "./static-grid.js";
export { runContentRules } from "./content-rules.js";
export { runBuildGridStatic, typecheckIssues, bundleIssues } from "./build-grid.js";
export { typecheckAuthoredScenes } from "./typecheck-authored.js";
export { lintSceneSources, compositionsSrcDir } from "./forbidden-api.js";
export {
  runRenderGrid,
  RENDER_ORACLES,
  checkSafeArea,
  checkContentZone,
  checkOverlap,
  checkTruncation,
  checkContrast,
  checkDeadAir,
  checkPacing,
  checkTransition,
  checkAudioSync,
  checkDuration,
  checkCaptions,
  checkRichness,
  frameDiffFraction,
  type Frame,
  type Rect,
  type RenderOracle,
  type RenderGridOptions,
  type RenderGridArtifacts,
} from "./render-grid.js";
export { decodePng, encodePngRGBA, PngFilter, type DecodedImage, type PngFilterType } from "./png.js";
export { gate, makeReport } from "../types.js";
