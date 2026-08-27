import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUNDLED_DEFAULT_BGM_FILENAME, workspaceRoot } from "@motionreal/pipeline";
import type { MediaPathPolicy, MediaProtocolFs } from "./media-protocol.js";

vi.mock("electron", () => ({
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
}));

import {
  absolutePathFromMediaRoute,
  classifyMediaPath,
  isAllowedMediaPath,
  mediaUrl,
  resolveMediaRequest,
} from "./media-protocol.js";

const previousHome = process.env.VIDEO_TOOL_HOME;

afterEach(() => {
  process.env.VIDEO_TOOL_HOME = previousHome;
});

function policyFor(home: string): MediaPathPolicy {
  return {
    videoToolHome: home,
    bundledAssetsRoot: join(workspaceRoot(), "apps", "desktop", "assets"),
  };
}

function mockFs(opts: {
  files: Record<string, { size: number; real?: string }>;
  realpathMap?: Record<string, string>;
}): MediaProtocolFs {
  const realpathMap = opts.realpathMap ?? {};
  return {
    realpath: async (path) => {
      const key = resolve(path);
      if (realpathMap[key]) return resolve(realpathMap[key]);
      if (opts.files[key]) return resolve(opts.files[key]!.real ?? key);
      // roots and intermediate dirs resolve to themselves when present as prefixes
      for (const f of Object.keys(opts.files)) {
        if (f === key || f.startsWith(key + "\\") || f.startsWith(key + "/")) {
          return key;
        }
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    stat: async (path) => {
      const key = resolve(path);
      const f = opts.files[key];
      if (!f) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return { size: f.size, isFile: () => true };
    },
    createReadStream: () => {
      throw new Error("stream not used in unit tests");
    },
  };
}

describe("media protocol path policy", () => {
  it("allows project assets, review stills, renders, staging, bgm, and bundled assets", () => {
    const home = join(workspaceRoot(), ".video-tool");
    process.env.VIDEO_TOOL_HOME = home;
    const policy = policyFor(home);

    const cases: Array<{ path: string; kind: string }> = [
      { path: join(home, "projects", "p1", "assets", "abc.png"), kind: "project-asset" },
      { path: join(home, "projects", "p1", "review", "scene-01.png"), kind: "project-review" },
      { path: join(home, "projects", "p1", "review", "thumbnail.png"), kind: "project-review" },
      { path: join(home, "projects", "p1", "renders", "p1.draft.mp4"), kind: "project-render" },
      { path: join(home, "projects", "p1", "renders", "p1.mp4"), kind: "project-render" },
      { path: join(home, "staging", "deadbeef.jpg"), kind: "staging" },
      { path: join(home, "bgm", "track.mp3"), kind: "bgm" },
      { path: join(home, "agent-drafts", "agent-12345678-1234-1234-1234-123456789abc", "assets", "found.png"), kind: "agent-asset" },
      {
        path: join(workspaceRoot(), "apps", "desktop", "assets", "bgm", BUNDLED_DEFAULT_BGM_FILENAME),
        kind: "bundled-asset",
      },
    ];

    for (const c of cases) {
      const classified = classifyMediaPath(c.path, policy);
      expect(classified?.kind, c.path).toBe(c.kind);
      expect(isAllowedMediaPath(c.path, policy), c.path).toBe(true);
      const url = mediaUrl(c.path, policy);
      expect(url, c.path).toMatch(/^media:\/\/file\//);
      expect(url, c.path).not.toMatch(/[A-Za-z]:\\/);
      expect(url, c.path).not.toContain(home.replace(/\\/g, "/"));
    }
  });

  it("allows known image/video/audio extensions under allowed folders", () => {
    const home = join(workspaceRoot(), ".video-tool");
    const policy = policyFor(home);
    for (const ext of [".png", ".jpeg", ".jpg", ".webp", ".gif", ".mp4", ".webm", ".mov", ".mp3", ".m4a", ".wav"]) {
      const path = join(home, "projects", "p1", "assets", `file${ext}`);
      expect(isAllowedMediaPath(path, policy), ext).toBe(true);
    }
  });

  it("denies settings, planning, events, TSX, JSON, and unknown extensions", () => {
    const home = join(workspaceRoot(), ".video-tool");
    const policy = policyFor(home);
    const denied = [
      join(home, "motionreal-settings.json"),
      join(home, "planning", "article.md"),
      join(home, "projects", "p1", "events.ndjson"),
      join(home, "projects", "p1", "authored", "scene.tsx"),
      join(home, "projects", "p1", "brief.json"),
      join(home, "projects", "p1", "manifest.json"),
      join(home, "projects", "p1", "evidence.json"),
      join(home, "projects", "p1", "assets", "notes.txt"),
      join(home, "projects", "p1", "audio", "narration.wav"), // audio dir not allowed
      join(home, "projects", "p1", "assets", "payload.json"),
      join(home, "agent-drafts", "agent-12345678-1234-1234-1234-123456789abc", "motionreal-agent.json"),
      join(home, "agent-drafts", "not-an-agent", "assets", "found.png"),
      join(workspaceRoot(), "README.md"),
    ];
    for (const path of denied) {
      expect(isAllowedMediaPath(path, policy), path).toBe(false);
      expect(mediaUrl(path, policy), path).toBeNull();
    }
  });

  it("denies traversal and paths outside allowed roots", () => {
    const home = join(workspaceRoot(), ".video-tool");
    const policy = policyFor(home);
    expect(isAllowedMediaPath(join(home, "..", "README.md"), policy)).toBe(false);
    expect(isAllowedMediaPath(join(home, "projects", "p1", "assets", "..", "..", "brief.json"), policy)).toBe(
      false,
    );
    expect(mediaUrl(join(workspaceRoot(), "README.md"), policy)).toBeNull();
  });

  it("denies invalid project ids in project media paths", () => {
    const home = join(workspaceRoot(), ".video-tool");
    const policy = policyFor(home);
    expect(isAllowedMediaPath(join(home, "projects", "..", "assets", "x.png"), policy)).toBe(false);
    expect(isAllowedMediaPath(join(home, "projects", "con", "assets", "x.png"), policy)).toBe(false);
  });
});

describe("media URL route round-trip", () => {
  it("rebuilds absolute paths from route-relative media URLs", () => {
    const home = resolve(join(workspaceRoot(), ".video-tool-media-test"));
    const policy = policyFor(home);
    const abs = join(home, "projects", "proj-abc", "review", "scene-01.png");
    const url = mediaUrl(abs, policy);
    expect(url).toBe("media://file/project-review/proj-abc/scene-01.png");

    const rebuilt = absolutePathFromMediaRoute("project-review", ["proj-abc", "scene-01.png"], policy);
    expect(resolve(rebuilt!)).toBe(resolve(abs));
  });

  it("round-trips only the assets zone of a valid Agent workspace", () => {
    const home = resolve(join(workspaceRoot(), ".video-tool-media-test"));
    const policy = policyFor(home);
    const draftId = "agent-12345678-1234-1234-1234-123456789abc";
    const abs = join(home, "agent-drafts", draftId, "assets", "logo.png");
    expect(mediaUrl(abs, policy)).toBe(`media://file/agent-asset/${draftId}/logo.png`);
    expect(resolve(absolutePathFromMediaRoute("agent-asset", [draftId, "logo.png"], policy)!)).toBe(resolve(abs));
    expect(absolutePathFromMediaRoute("agent-asset", ["bad", "logo.png"], policy)).toBeNull();
  });

  it("rejects wrong host, query, fragment, and empty routes in resolveMediaRequest", async () => {
    const home = resolve(join(workspaceRoot(), ".video-tool-media-test"));
    const policy = policyFor(home);
    const fs = mockFs({ files: {} });

    expect((await resolveMediaRequest("media://other/project-asset/p1/a.png", policy, fs)).ok).toBe(false);
    const withQuery = await resolveMediaRequest("media://file/project-asset/p1/a.png?x=1", policy, fs);
    expect(withQuery.ok).toBe(false);
    if (!withQuery.ok) expect(withQuery.status).toBe(403);
    // Cover preview once used ?t= nonce — that must stay 403 (use #rN instead).
    const coverQuery = await resolveMediaRequest(
      "media://file/project-review/p1/thumbnail.png?t=1",
      policy,
      fs,
    );
    expect(coverQuery.ok).toBe(false);
    if (!coverQuery.ok) expect(coverQuery.status).toBe(403);
    // Cache-bust fragment on stills (storyboard appends #rN) must not 403.
    const withHash = await resolveMediaRequest("media://file/project-review/p1/scene-01.png#r3", policy, fs);
    // Missing file → 404 after allow, not 403 from hash policy.
    expect(withHash.ok).toBe(false);
    if (!withHash.ok) expect(withHash.status).toBe(404);
    const emptyRoute = await resolveMediaRequest("media://file/", policy, fs);
    expect(emptyRoute.ok).toBe(false);
    if (!emptyRoute.ok) expect(emptyRoute.status).toBe(403);
  });
});

describe("resolveMediaRequest realpath and allow matrix", () => {
  it("serves an allowed file after realpath containment", async () => {
    const home = resolve(join(workspaceRoot(), ".video-tool-media-test"));
    const policy = policyFor(home);
    const abs = resolve(join(home, "projects", "p1", "renders", "p1.draft.mp4"));
    const zoneRoot = resolve(join(home, "projects", "p1", "renders"));
    const fs = mockFs({
      files: { [abs]: { size: 1024 } },
      realpathMap: { [abs]: abs, [zoneRoot]: zoneRoot },
    });

    const url = mediaUrl(abs, policy)!;
    const result = await resolveMediaRequest(url, policy, fs);
    expect(result).toEqual({
      ok: true,
      absolutePath: abs,
      contentType: "video/mp4",
      size: 1024,
    });
  });

  it("serves review stills with storyboard cache-bust fragment #rN", async () => {
    const home = resolve(join(workspaceRoot(), ".video-tool-media-test"));
    const policy = policyFor(home);
    const abs = resolve(join(home, "projects", "p1", "review", "scene-01.png"));
    const zoneRoot = resolve(join(home, "projects", "p1", "review"));
    const fs = mockFs({
      files: { [abs]: { size: 2048 } },
      realpathMap: { [abs]: abs, [zoneRoot]: zoneRoot },
    });
    const url = `${mediaUrl(abs, policy)!}#r7`;
    const result = await resolveMediaRequest(url, policy, fs);
    expect(result).toEqual({
      ok: true,
      absolutePath: abs,
      contentType: "image/png",
      size: 2048,
    });
  });

  it("returns 404 when the allowed target is missing", async () => {
    const home = resolve(join(workspaceRoot(), ".video-tool-media-test"));
    const policy = policyFor(home);
    const abs = resolve(join(home, "projects", "p1", "review", "missing.png"));
    const url = mediaUrl(abs, policy)!;
    const fs = mockFs({ files: {} });
    const result = await resolveMediaRequest(url, policy, fs);
    expect(result).toEqual({ ok: false, status: 404 });
  });

  it("denies symlink/junction escape via injected realpath", async () => {
    const home = resolve(join(workspaceRoot(), ".video-tool-media-test"));
    const policy = policyFor(home);
    const lexical = resolve(join(home, "projects", "p1", "assets", "escape.png"));
    const zoneRoot = resolve(join(home, "projects", "p1", "assets"));
    const outside = resolve(join(workspaceRoot(), "README.md"));
    const fs = mockFs({
      files: {
        [lexical]: { size: 10, real: outside },
      },
      realpathMap: {
        [lexical]: outside,
        [zoneRoot]: zoneRoot,
      },
    });
    // Override stat for the realpath target so we would serve if containment failed
    fs.stat = async (path) => {
      if (resolve(path) === outside) return { size: 10, isFile: () => true };
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };

    const url = mediaUrl(lexical, policy)!;
    const result = await resolveMediaRequest(url, policy, fs);
    expect(result).toEqual({ ok: false, status: 403 });
  });

  it("denies percent-decoded traversal segments", async () => {
    const home = resolve(join(workspaceRoot(), ".video-tool-media-test"));
    const policy = policyFor(home);
    const fs = mockFs({ files: {} });
    const evil = "media://file/project-asset/p1/" + encodeURIComponent("..") + "/brief.json";
    const result = await resolveMediaRequest(evil, policy, fs);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("denies directory targets (isFile false)", async () => {
    const home = resolve(join(workspaceRoot(), ".video-tool-media-test"));
    const policy = policyFor(home);
    const abs = resolve(join(home, "projects", "p1", "assets", "nested.png"));
    // Use a file path that classifies, but stat reports not a file (dir)
    const zoneRoot = resolve(join(home, "projects", "p1", "assets"));
    const fs: MediaProtocolFs = {
      realpath: async (p) => resolve(p),
      stat: async () => ({ size: 0, isFile: () => false }),
      createReadStream: () => {
        throw new Error("unused");
      },
    };
    // Ensure realpath of target "exists"
    const url = mediaUrl(abs, policy)!;
    // mock realpath success for root and target
    fs.realpath = async (p) => {
      const r = resolve(p);
      if (r === abs || r === zoneRoot) return r;
      return r;
    };
    const result = await resolveMediaRequest(url, policy, fs);
    expect(result).toEqual({ ok: false, status: 403 });
  });
});

describe("Range request semantics (unit-level parse via resolve + headers)", () => {
  it("classified render MP4 is Range-capable content type", () => {
    const home = join(workspaceRoot(), ".video-tool");
    const policy = policyFor(home);
    const draft = join(home, "projects", "p1", "renders", "p1.draft.mp4");
    const classified = classifyMediaPath(draft, policy);
    expect(classified?.contentType).toBe("video/mp4");
  });
});
