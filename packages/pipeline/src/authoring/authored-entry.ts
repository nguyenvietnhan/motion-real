import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";

/**
 * AUTHOR-mode render bundling (the missing link for Requirement 13.5).
 *
 * The base Remotion bundle only contains the components imported by
 * `@motionreal/compositions`. AI-authored scenes live outside that barrel — in a
 * project's `authored/` dir — so they are not in the default bundle. This
 * generator writes a project-specific Remotion entry that:
 * 1. imports every (already admitted) authored scene module, whose
 * `registerComponent(...)` side effect puts it in the SAME registry the
 * master `VideoComposition` reads from, and
 * 2. registers the MotionReal video composition ids driven by the project's
 * locked spec.
 *
 * The renderer then bundles THIS entry (with the workspace webpack override that
 * aliases `@motionreal/*` to their TS sources), so authored scenes render exactly like
 * built-in ones — but the code is per-project and lives in the project folder,
 * keeping each video self-contained.
 */

export type AuthoredEntryOptions = {
  /** Absolute path to write the generated entry (inside the project folder). */
  entryPath: string;
  /** Absolute paths to the admitted authored scene `.tsx` files. */
  authoredFiles: readonly string[];
  /** Absolute path to the project's `video-spec.lock.json`. */
  lockJsonPath: string;
  /** Optional content fingerprint used to make the generated entry idempotent. */
  cacheToken?: string;
};

/** Build the entry source text (pure; exported for unit testing). */
export function buildAuthoredEntrySource(opts: AuthoredEntryOptions): string {
  const dir = dirname(opts.entryPath);
  const importLines = opts.authoredFiles
    .map((file) => `import ${JSON.stringify(toModuleSpecifier(dir, file))};`)
    .join("\n");
  const lockRel = toRelImport(dir, opts.lockJsonPath);

  return `// GENERATED — per-project Remotion entry for AUTHOR-mode render. Safe to delete; regenerated each render.
// SOURCE-FINGERPRINT: ${opts.cacheToken ?? "none"}
import React from "react";
import { Composition, registerRoot } from "remotion";
import { z } from "zod";
import { FPS, LockedVideoSpecSchema, geometry } from "@motionreal/schema";
import { VideoComposition } from "@motionreal/compositions";
${importLines}
import lockedSpec from ${JSON.stringify(lockRel)};

const spec = lockedSpec as unknown as import("@motionreal/schema").LockedVideoSpec;
const initialGeometry = geometry();
// NewsVideo: legacy composition id for old saved render commands/entries.
// New work targets MotionRealVideo. Removal needs owner-approved sunset.
const VIDEO_COMPOSITION_IDS = ["MotionRealVideo", "NewsVideo"] as const;
const videoSchema = z.object({
  spec: LockedVideoSpecSchema,
  measure: z.boolean().optional(),
  strictSceneErrors: z.boolean().optional(),
});

const Root: React.FC = () =>
  React.createElement(
    React.Fragment,
    null,
    VIDEO_COMPOSITION_IDS.map((id) =>
      React.createElement(Composition, {
        key: id,
        id,
        component: VideoComposition,
        schema: videoSchema,
        defaultProps: { spec },
        width: initialGeometry.canvas.width,
        height: initialGeometry.canvas.height,
        fps: spec.fps ?? FPS,
        durationInFrames: spec.durationInFrames,
        calculateMetadata: ({ props }: { props: { spec: typeof spec; measure?: boolean; strictSceneErrors?: boolean } }) => {
          const g = geometry();
          return {
            durationInFrames: props.spec.durationInFrames,
            fps: props.spec.fps ?? FPS,
            width: g.canvas.width,
            height: g.canvas.height,
          };
        },
      }),
    ),
  );

registerRoot(Root);
`;
}

/** Write the generated entry to disk and return its path. */
export async function generateAuthoredEntry(opts: AuthoredEntryOptions): Promise<string> {
  await mkdir(dirname(opts.entryPath), { recursive: true });
  const cacheToken = opts.cacheToken ?? (await authoredEntryFingerprint(opts.authoredFiles, opts.lockJsonPath));
  const source = buildAuthoredEntrySource({ ...opts, cacheToken });
  const existing = await readFile(opts.entryPath, "utf8").catch(() => undefined);
  if (existing !== source) {
    await writeFile(opts.entryPath, source, "utf8");
  }
  return opts.entryPath;
}

/** Relative module specifier for an authored scene (extension stripped; webpack resolves.tsx). */
function toModuleSpecifier(fromDir: string, file: string): string {
  return toRelImport(fromDir, file).replace(/\.(tsx|ts|jsx|js)$/i, "");
}

/** Forward-slashed, dot-prefixed relative import path. */
function toRelImport(fromDir: string, target: string): string {
  let rel = relative(fromDir, target).split("\\").join("/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

async function authoredEntryFingerprint(authoredFiles: readonly string[], lockJsonPath: string): Promise<string> {
  const h = createHash("sha256");
  for (const file of authoredFiles) {
    h.update(relative(dirname(lockJsonPath), file).split("\\").join("/"));
    h.update("\0");
    try {
      h.update(await readFile(file));
    } catch {
      h.update("missing");
    }
    h.update("\0");
  }
  h.update(relative(dirname(lockJsonPath), lockJsonPath).split("\\").join("/"));
  h.update("\0");
  try {
    h.update(await readFile(lockJsonPath));
  } catch {
    h.update("missing");
  }
  return h.digest("hex");
}
