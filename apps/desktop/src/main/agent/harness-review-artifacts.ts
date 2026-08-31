import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { decodePng, type AuthoringReviewRequest, type ReviewArtifact } from "@motionreal/pipeline";

export async function assertHarnessReviewArtifacts(input: {
  projectRoot: string;
  request: AuthoringReviewRequest;
  artifacts: readonly ReviewArtifact[];
}): Promise<void> {
  if (input.artifacts.length === 0) throw new Error("Visual refine thiếu evidence artifact.");
  const evidenceRoot = await realpath(join(input.projectRoot, "review", "evidence"));
  const allowedScenes = new Set([...input.request.reviewSceneIds, ...input.request.contextSceneIds]);
  const profileById = new Map(input.request.scenes.map((scene) => [scene.sceneId, scene] as const));
  const paths = new Set<string>();
  const overviewCounts = new Map(input.request.reviewSceneIds.map((id) => [id, 0]));

  for (const artifact of input.artifacts) {
    const actual = await realpath(artifact.path).catch((_error: unknown) => undefined);
    if (!actual) throw new Error(`Không tìm thấy evidence PNG: ${artifact.path}`);
    const rel = relative(evidenceRoot, actual);
    if (!rel || rel.startsWith("..") || isAbsolute(rel) || dirname(actual) !== evidenceRoot || !actual.toLowerCase().endsWith(".png")) {
      throw new Error("Evidence artifact phải nằm trực tiếp trong project/review/evidence.");
    }
    if (paths.has(actual)) throw new Error("Evidence artifact có path trùng.");
    paths.add(actual);
    const info = await stat(actual);
    if (!info.isFile() || info.size === 0) throw new Error(`Evidence PNG rỗng: ${rel}`);
    try { decodePng(await readFile(actual)); }
    catch (_error) { throw new Error(`Evidence PNG không đọc được: ${rel}`); }

    if (artifact.panels.length === 0 || artifact.panels.some((panel, index) => panel.index !== index)) {
      throw new Error(`Evidence ${rel} có panel index không hợp lệ.`);
    }
    if (artifact.panels.some((panel) => !allowedScenes.has(panel.sceneId))
      || artifact.sceneIds.some((sceneId) => !allowedScenes.has(sceneId))) {
      throw new Error(`Evidence ${rel} tham chiếu scene lạ.`);
    }
    const panelSceneIds = new Set(artifact.panels.map((panel) => panel.sceneId));
    if (artifact.sceneIds.length === 0 || artifact.sceneIds.some((sceneId) => !panelSceneIds.has(sceneId))) {
      throw new Error(`Evidence ${rel} có sceneIds không khớp panels.`);
    }
    validateArtifactShape(artifact, rel);
    if (artifact.kind === "overview") {
      for (const panel of artifact.panels) {
        if (overviewCounts.has(panel.sceneId)) overviewCounts.set(panel.sceneId, overviewCounts.get(panel.sceneId)! + 1);
      }
    }
  }

  for (const [sceneId, count] of overviewCounts) {
    if (count !== 1) throw new Error(`${sceneId} phải có đúng một overview panel; nhận ${count}.`);
    const profile = profileById.get(sceneId);
    if (!profile) throw new Error(`${sceneId} thiếu review profile.`);
    const expectedMotion = profile.temporalMode === "stepped"
      ? "cue-filmstrip"
      : profile.temporalMode === "continuous" ? "dense-filmstrip" : undefined;
    if (expectedMotion && !input.artifacts.some((artifact) => artifact.kind === expectedMotion && artifact.sceneIds.includes(sceneId))) {
      throw new Error(`${sceneId} thiếu ${expectedMotion}.`);
    }
    if (profile.detailMode === "fine"
      && !input.artifacts.some((artifact) => artifact.kind === "detail" && artifact.sceneIds.includes(sceneId))) {
      throw new Error(`${sceneId} thiếu detail artifact.`);
    }
  }
}

function validateArtifactShape(artifact: ReviewArtifact, label: string): void {
  const count = artifact.panels.length;
  if (artifact.kind === "overview" && (count > 6 || artifact.panels.some((panel) => panel.sample !== "overview"))) {
    throw new Error(`Evidence ${label} không phải overview tối đa 6 panel.`);
  }
  if (artifact.kind === "cue-filmstrip" && (count < 3 || count > 5)) {
    throw new Error(`Evidence ${label} phải có 3-5 cue-filmstrip panel.`);
  }
  if (artifact.kind === "dense-filmstrip" && (count < 5 || count > 7)) {
    throw new Error(`Evidence ${label} phải có 5-7 dense-filmstrip panel.`);
  }
  if (artifact.kind === "detail" && (count !== 1 || artifact.panels[0]?.sample !== "detail")) {
    throw new Error(`Evidence ${label} phải có đúng một detail panel.`);
  }
  if (artifact.kind === "transition" && (count !== 3
    || artifact.panels.map((panel) => panel.sample).join(",") !== "transition-before,transition-mid,transition-after")) {
    throw new Error(`Evidence ${label} phải có đủ ba transition panel.`);
  }
}
