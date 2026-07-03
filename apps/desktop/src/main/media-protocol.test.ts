import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUNDLED_DEFAULT_BGM_FILENAME, workspaceRoot } from "@motionreal/pipeline";

vi.mock("electron", () => ({
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
}));

import { isAllowedMediaPath, mediaUrl } from "./media-protocol.js";

const previousHome = process.env.VIDEO_TOOL_HOME;

afterEach(() => {
  process.env.VIDEO_TOOL_HOME = previousHome;
});

describe("media protocol path policy", () => {
  it("allows generated runtime media and bundled desktop assets", () => {
    const home = join(workspaceRoot(), ".video-tool");
    process.env.VIDEO_TOOL_HOME = home;
    const generatedStill = join(home, "projects", "p1", "review", "scene-01.png");
    const bundledBgm = join(workspaceRoot(), "apps", "desktop", "assets", "bgm", BUNDLED_DEFAULT_BGM_FILENAME);

    expect(isAllowedMediaPath(generatedStill)).toBe(true);
    expect(isAllowedMediaPath(bundledBgm)).toBe(true);
    expect(mediaUrl(generatedStill)).toMatch(/^media:\/\/file\//);
    expect(mediaUrl(bundledBgm)).toMatch(/^media:\/\/file\//);
  });

  it("refuses paths outside the allowed roots and traversal attempts", () => {
    const root = workspaceRoot();
    const home = join(root, ".video-tool");
    process.env.VIDEO_TOOL_HOME = home;

    expect(isAllowedMediaPath(join(root, "README.md"))).toBe(false);
    expect(mediaUrl(join(root, "README.md"))).toBeNull();
    expect(isAllowedMediaPath(join(home, "..", "README.md"))).toBe(false);
  });
});
