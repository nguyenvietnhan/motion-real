import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";

export const AUTHORING_V1_DIR = join("handoff", "authoring-v1");

type SceneManifest = { scenes?: Array<{ component?: unknown }> };

export async function archiveHarnessAuthoringV1(input: {
  draftRoot: string;
  manifestPath: string;
  authoredDir: string;
  stills: Array<{ sceneId: string; path: string }>;
}): Promise<{ baseline: string; stills: string[] }> {
  const target = join(input.draftRoot, AUTHORING_V1_DIR);
  if (!(await isDirectory(target))) {
    const temporary = join(input.draftRoot, "handoff", `.authoring-v1-${randomUUID()}`);
    try {
      await mkdir(join(temporary, "stills"), { recursive: true });
      await cp(input.manifestPath, join(temporary, "manifest.json"));
      await cp(input.authoredDir, join(temporary, "authored"), { recursive: true });
      await Promise.all(input.stills.map(({ sceneId, path }) => cp(path, join(temporary, "stills", `${sceneId}.png`))));
      await assertBaselineComplete(temporary, input.stills.map((still) => still.sceneId));
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }
  await assertBaselineComplete(target, input.stills.map((still) => still.sceneId));
  return {
    baseline: AUTHORING_V1_DIR.replaceAll("\\", "/"),
    stills: input.stills.map(({ sceneId }) => `${AUTHORING_V1_DIR.replaceAll("\\", "/")}/stills/${sceneId}.png`),
  };
}

export async function assertHarnessCreativeRewrite(input: {
  baselineDir: string;
  authoredDir: string;
}): Promise<void> {
  const baselineManifest = JSON.parse(await readFile(join(input.baselineDir, "manifest.json"), "utf8")) as SceneManifest;
  const components = manifestComponents(baselineManifest);
  const unchanged: string[] = [];
  for (const component of components) {
    const file = `${component}.tsx`;
    const before = await readFile(join(input.baselineDir, "authored", file));
    const after = await readFile(join(input.authoredDir, file)).catch((_error) => null);
    if (after?.equals(before)) unchanged.push(file);
  }
  if (unchanged.length > 0) {
    throw new Error(`Creative rewrite V2 chưa viết lại các scene: ${unchanged.join(", ")}. Chỉ đổi màu/glow/khung/pulse không được tính là rewrite.`);
  }
}

async function assertBaselineComplete(root: string, sceneIds: string[]): Promise<void> {
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as SceneManifest;
  const components = manifestComponents(manifest);
  const authored = new Set(await readdir(join(root, "authored")));
  const missingModules = components.filter((component) => !authored.has(`${component}.tsx`));
  if (missingModules.length > 0) throw new Error(`Không archive được source V1: thiếu ${missingModules.join(", ")}.tsx.`);
  const missingStills: string[] = [];
  for (const sceneId of sceneIds) {
    const file = join(root, "stills", `${sceneId}.png`);
    if (!(await stat(file).catch((_error) => null))?.isFile()) missingStills.push(basename(file));
  }
  if (missingStills.length > 0) throw new Error(`Không archive được still V1: thiếu ${missingStills.join(", ")}.`);
}

function manifestComponents(manifest: SceneManifest): string[] {
  if (!Array.isArray(manifest.scenes) || manifest.scenes.length === 0) {
    throw new Error("Không archive được source V1: manifest thiếu scenes.");
  }
  const components = manifest.scenes.map((scene) => typeof scene?.component === "string" ? scene.component.trim() : "");
  if (components.some((component) => !component) || new Set(components).size !== components.length) {
    throw new Error("Không archive được source V1: component id thiếu hoặc trùng.");
  }
  return components;
}

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch((_error) => null))?.isDirectory() === true;
}
