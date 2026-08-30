import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { admitAuthoredSceneFiles } from "@motionreal/pipeline";

export type HarnessSceneFingerprints = {
  /** Manifest fields outside scenes; a change means every scene might be affected. */
  global: string;
  scenes: Record<string, string>;
};

/**
 * Bind a visual-refine request to the exact authored source, approved assets,
 * and review still bytes it saw. This is evidence for a normal bounded refine
 * pass, not a mandatory rewrite gate.
 */
export async function harnessReviewFingerprint(projectRoot: string, stills: readonly string[] = []): Promise<string> {
  const root = await realpath(projectRoot);
  const manifestPath = join(root, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    scenes: Array<{ image?: { ref?: unknown } }>;
  };
  const modules = (await readdir(join(root, "authored"), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx") && !entry.name.startsWith("_"))
    .map((entry) => join(root, "authored", entry.name));
  if (modules.length === 0) throw new Error("Không có source để đối chiếu ảnh review.");
  const assets = manifest.scenes.flatMap((scene) => {
    if (scene.image === undefined) return [];
    const ref = scene.image.ref;
    if (typeof ref !== "string" || !ref.startsWith("assets/") || ref.includes("\\") || ref.split("/").includes("..")) {
      throw new Error("Asset review phải nằm trong assets/ của project.");
    }
    return [join(root, ref)];
  });
  const digest = createHash("sha256");
  for (const path of [...new Set([manifestPath, ...modules, ...assets, ...stills])].sort()) {
    const actual = await realpath(path);
    const rel = relative(root, actual);
    if (!rel || rel.startsWith("..") || isAbsolute(rel) || !(await stat(actual)).isFile()) {
      throw new Error("Source/ảnh review phải là file bên trong project.");
    }
    const contentHash = createHash("sha256").update(await readFile(actual)).digest("hex");
    digest.update(JSON.stringify([rel.replaceAll("\\", "/"), contentHash]));
  }
  return digest.digest("hex");
}

/**
 * Determine the smallest safe still re-render scope after a visual-refine edit.
 * Scene source, its manifest entry and its referenced asset are fingerprinted
 * separately. A global manifest change deliberately falls back to every scene.
 */
export async function harnessSceneFingerprints(projectRoot: string): Promise<HarnessSceneFingerprints> {
  const root = await realpath(projectRoot);
  const manifestPath = join(root, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    scenes?: Array<{ id?: unknown; component?: unknown; image?: { ref?: unknown } }>;
    [key: string]: unknown;
  };
  if (!Array.isArray(manifest.scenes) || manifest.scenes.length === 0) {
    throw new Error("Manifest không có scene để xác định phạm vi visual refine.");
  }
  const authoredDir = join(root, "authored");
  const files = (await readdir(authoredDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx") && !entry.name.startsWith("_"))
    .map((entry) => join(authoredDir, entry.name)).sort();
  const admitted = await admitAuthoredSceneFiles(files, authoredDir);
  if (!admitted.ok) {
    throw new Error(`Không đối chiếu được source visual refine: ${admitted.violations.map((issue) => issue.message).join(" ")}`);
  }
  const filesByComponent = new Map(admitted.componentIds.map((id, index) => [id, admitted.files[index]! ]));
  const normalizedGlobal = { ...manifest, scenes: [] };
  const scenes: Record<string, string> = {};
  for (const scene of manifest.scenes) {
    const id = typeof scene.id === "string" ? scene.id : "";
    const component = typeof scene.component === "string" ? scene.component : "";
    const modulePath = filesByComponent.get(component);
    if (!id || !modulePath || scenes[id]) throw new Error("Manifest/source visual refine có scene hoặc component không hợp lệ.");
    const hash = createHash("sha256");
    hash.update(JSON.stringify(scene));
    hash.update(await readFile(modulePath));
    if (scene.image?.ref !== undefined) {
      const ref = scene.image.ref;
      if (typeof ref !== "string" || !ref.startsWith("assets/") || ref.includes("\\") || ref.split("/").includes("..")) {
        throw new Error("Asset visual refine phải nằm trong assets/ của project.");
      }
      hash.update(await readFile(join(root, ref)));
    }
    scenes[id] = hash.digest("hex");
  }
  return {
    global: createHash("sha256").update(JSON.stringify(normalizedGlobal)).digest("hex"),
    scenes,
  };
}
