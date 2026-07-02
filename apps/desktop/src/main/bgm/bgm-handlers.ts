import { BUNDLED_DEFAULT_BGM_TRACK_NAME, bundledDefaultBgmPath, type BgmTrack } from "@news/pipeline";
import type { BgmTrackVM } from "../../shared/types.js";

export const BUNDLED_BGM_NAME = BUNDLED_DEFAULT_BGM_TRACK_NAME;

type ManifestWithBgm = Record<string, unknown> & { bgm?: unknown };

export type BgmListDeps = {
  workspaceRoot: () => string;
  exists: (path: string) => boolean;
  fileSize: (path: string) => number;
  listBgmTracks: () => Promise<BgmTrack[]>;
  mediaUrl: (path: string) => string | null;
  warn: (details: unknown, message: string) => void;
};

export type BgmHandlerDeps = BgmListDeps & {
  pickAudioFiles: () => Promise<string[] | null>;
  addBgmTrack: (path: string) => Promise<BgmTrack>;
  removeBgmTrack: (name: string) => Promise<void>;
  loadManifest: (projectId: string) => Promise<ManifestWithBgm>;
  writeManifest: (projectId: string, manifest: ManifestWithBgm) => Promise<void>;
};

export type BgmHandlers = {
  "bgm:list": () => Promise<BgmTrackVM[]>;
  "bgm:add": () => Promise<BgmTrackVM[]>;
  "bgm:remove": (name: unknown) => Promise<BgmTrackVM[]>;
  "bgm:getForProject": (projectId: unknown) => Promise<string | null>;
  "bgm:setForProject": (projectId: unknown, name: unknown) => Promise<void>;
};

/** Map a library BGM track to its renderer VM (label + preview URL stay local). */
export function bgmTrackViewModel(track: BgmTrack, mediaUrl: (path: string) => string | null): BgmTrackVM {
  const mb = track.sizeBytes / (1024 * 1024);
  const sizeLabel = mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(track.sizeBytes / 1024))} KB`;
  const builtIn = track.name === BUNDLED_BGM_NAME;
  return {
    name: track.name,
    label: builtIn ? "Nhạc nền mặc định" : track.name,
    sizeLabel,
    previewUrl: mediaUrl(track.path) ?? "",
    builtIn,
  };
}

function bundledDefaultTrack(deps: BgmListDeps): BgmTrack | null {
  const path = bundledDefaultBgmPath(deps.workspaceRoot());
  if (!deps.exists(path)) return null;
  try {
    return { name: BUNDLED_BGM_NAME, path, sizeBytes: deps.fileSize(path) };
  } catch (error) {
    deps.warn({ err: error, path }, "failed to read bundled BGM asset");
    return null;
  }
}

/** Keep the bundled track visible as a virtual built-in next to user tracks. */
export async function listBgmViewModels(deps: BgmListDeps): Promise<BgmTrackVM[]> {
  const userTracks = (await deps.listBgmTracks()).filter((track) => track.name !== BUNDLED_BGM_NAME);
  const bundled = bundledDefaultTrack(deps);
  return [...(bundled ? [bundled] : []), ...userTracks].map((track) => bgmTrackViewModel(track, deps.mediaUrl));
}

export function createBgmHandlers(deps: BgmHandlerDeps): BgmHandlers {
  const list = () => listBgmViewModels(deps);

  return {
    "bgm:list": list,
    "bgm:add": async () => {
      const picked = await deps.pickAudioFiles();
      for (const path of picked ?? []) {
        try {
          await deps.addBgmTrack(path);
        } catch (error) {
          deps.warn({ err: error, path }, "bgm:add skipped file");
        }
      }
      return list();
    },
    "bgm:remove": async (name) => {
      const trackName = String(name);
      if (trackName !== BUNDLED_BGM_NAME) await deps.removeBgmTrack(trackName);
      return list();
    },
    "bgm:getForProject": async (projectId) => {
      const id = String(projectId);
      try {
        const manifest = await deps.loadManifest(id);
        const bgm = manifest.bgm;
        return typeof bgm === "string" && bgm.length > 0 ? bgm : null;
      } catch (error) {
        deps.warn({ err: error, projectId: id }, "bgm:getForProject failed");
        return null;
      }
    },
    "bgm:setForProject": async (projectId, name) => {
      const id = String(projectId);
      try {
        const manifest = await deps.loadManifest(id);
        const chosen = typeof name === "string" && name.length > 0 ? name : undefined;
        await deps.writeManifest(id, { ...manifest, ...(chosen ? { bgm: chosen } : { bgm: undefined }) });
      } catch (error) {
        deps.warn({ err: error, projectId: id }, "bgm:setForProject failed");
      }
    },
  };
}
