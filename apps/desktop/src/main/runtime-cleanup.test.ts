import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { sweepRuntimeArtifacts, type RuntimeCleanupDeps } from "./runtime-cleanup.js";

const ROOT = "V:/MotionReal/.video-tool";
const NOW = 31 * 24 * 60 * 60 * 1000;

function directory(mtimeMs: number, symlink = false) {
  return { mtimeMs, isDirectory: () => true, isSymbolicLink: () => symlink };
}

function cleanupDeps(overrides: Partial<RuntimeCleanupDeps> = {}): RuntimeCleanupDeps {
  return {
    lstat: async () => {
      const error = Object.assign(new Error("missing"), { code: "ENOENT" });
      throw error;
    },
    readdir: async () => [],
    rm: async () => undefined,
    now: () => NOW,
    warn: () => undefined,
    ...overrides,
  };
}

describe("runtime artifact cleanup", () => {
  it("removes only legacy roots older than 30 days", async () => {
    const rm = vi.fn(async () => undefined);
    const stale = NOW - 30 * 24 * 60 * 60 * 1000;
    const deps = cleanupDeps({
      lstat: async (path) => {
        if (path.endsWith("voice-tests")) throw Object.assign(new Error("missing"), { code: "ENOENT" });
        return directory(path.endsWith("agent-probes") ? stale : stale + 1);
      },
      rm,
    });

    await sweepRuntimeArtifacts(ROOT, deps);

    expect(rm).toHaveBeenCalledOnce();
    expect(rm).toHaveBeenCalledWith(join(ROOT, "agent-probes"), { recursive: true, force: true });
  });

  it("removes stale voice-test directories after 24 hours and keeps newer ones", async () => {
    const rm = vi.fn(async () => undefined);
    const deps = cleanupDeps({
      lstat: async (path) => {
        if (path.endsWith("voice-tests")) return directory(NOW);
        if (path.endsWith("voice-test-old")) return directory(NOW - 24 * 60 * 60 * 1000);
        if (path.endsWith("voice-test-fresh")) return directory(NOW - 24 * 60 * 60 * 1000 + 1);
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
      readdir: async () => [
        { name: "voice-test-old", isDirectory: () => true, isSymbolicLink: () => false },
        { name: "voice-test-fresh", isDirectory: () => true, isSymbolicLink: () => false },
        { name: "not-a-voice-test", isDirectory: () => true, isSymbolicLink: () => false },
      ],
      rm,
    });

    await sweepRuntimeArtifacts(ROOT, deps);

    expect(rm).toHaveBeenCalledOnce();
    expect(rm).toHaveBeenCalledWith(join(ROOT, "voice-tests", "voice-test-old"), { recursive: true, force: true });
  });

  it("never follows symlinks and logs filesystem failures without blocking startup", async () => {
    const rm = vi.fn(async () => undefined);
    const warn = vi.fn();
    const deps = cleanupDeps({
      lstat: async (path) => {
        if (path.endsWith("agent-probes")) return directory(0, true);
        if (path.endsWith("agent-runtime")) throw new Error("access denied");
        if (path.endsWith("voice-tests")) return directory(NOW);
        if (path.endsWith("voice-test-link")) return directory(0, true);
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
      readdir: async () => [
        { name: "voice-test-link", isDirectory: () => true, isSymbolicLink: () => true },
        { name: "../../outside", isDirectory: () => true, isSymbolicLink: () => false },
      ],
      rm,
      warn,
    });

    await expect(sweepRuntimeArtifacts(ROOT, deps)).resolves.toBeUndefined();
    expect(rm).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ path: join(ROOT, "agent-runtime") }), "legacy Agent artifact cleanup failed");
  });
});
