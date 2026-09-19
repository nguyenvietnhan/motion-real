import { lstat, readdir, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const LEGACY_ROOTS = ["agent-probes", "agent-runtime", "agent-sessions"] as const;
const LEGACY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const VOICE_TEST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const VOICE_TEST_DIR = "voice-tests";
const VOICE_TEST_NAME = /^voice-test-[A-Za-z0-9-]+$/;

type EntryStat = {
  mtimeMs: number;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
};

type DirectoryEntry = {
  name: string;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
};

export type RuntimeCleanupDeps = {
  lstat: (path: string) => Promise<EntryStat>;
  readdir: (path: string) => Promise<DirectoryEntry[]>;
  rm: (path: string, options: { recursive: true; force: true }) => Promise<void>;
  now: () => number;
  warn: (details: unknown, message: string) => void;
};

const defaultDeps: RuntimeCleanupDeps = {
  lstat,
  readdir: async (path) => (await readdir(path, { withFileTypes: true })).map((entry) => ({
    name: entry.name,
    isDirectory: () => entry.isDirectory(),
    isSymbolicLink: () => entry.isSymbolicLink(),
  })),
  rm,
  now: () => Date.now(),
  warn: (details, message) => console.warn(`[desktop] ${message}`, details),
};

/**
 * Best-effort cleanup for artifacts from retired Agent runtimes and interrupted
 * voice tests. The scope is intentionally a fixed allowlist under VIDEO_TOOL_HOME;
 * project data, active caches, and Harness data are never traversed here.
 */
export async function sweepRuntimeArtifacts(rootDir: string, overrides: Partial<RuntimeCleanupDeps> = {}): Promise<void> {
  const deps = { ...defaultDeps, ...overrides };
  const root = resolve(rootDir);
  const now = deps.now();

  for (const name of LEGACY_ROOTS) {
    const path = safeChild(root, name);
    if (!path) continue;
    await removeStaleDirectory(path, now - LEGACY_MAX_AGE_MS, deps, "legacy Agent artifact cleanup failed");
  }

  const voiceTests = safeChild(root, VOICE_TEST_DIR);
  if (!voiceTests) return;
  let voiceRoot: EntryStat;
  try {
    voiceRoot = await deps.lstat(voiceTests);
  } catch (error) {
    if (isMissing(error)) return;
    deps.warn({ err: error, path: voiceTests }, "voice-test cleanup skipped; root is unavailable");
    return;
  }
  if (!voiceRoot.isDirectory() || voiceRoot.isSymbolicLink()) return;

  let entries: DirectoryEntry[];
  try {
    entries = await deps.readdir(voiceTests);
  } catch (error) {
    deps.warn({ err: error, path: voiceTests }, "voice-test cleanup skipped; root cannot be listed");
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !VOICE_TEST_NAME.test(entry.name)) continue;
    const path = safeChild(voiceTests, entry.name);
    if (!path) continue;
    await removeStaleDirectory(path, now - VOICE_TEST_MAX_AGE_MS, deps, "voice-test artifact cleanup failed");
  }
}

async function removeStaleDirectory(
  path: string,
  cutoff: number,
  deps: RuntimeCleanupDeps,
  warning: string,
): Promise<void> {
  try {
    const info = await deps.lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || info.mtimeMs > cutoff) return;
    await deps.rm(path, { recursive: true, force: true });
  } catch (error) {
    if (!isMissing(error)) deps.warn({ err: error, path }, warning);
  }
}

function safeChild(root: string, ...parts: string[]): string | undefined {
  const path = resolve(root, ...parts);
  const relation = relative(root, path);
  return relation && !relation.startsWith("..") && !isAbsolute(relation) ? path : undefined;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}
