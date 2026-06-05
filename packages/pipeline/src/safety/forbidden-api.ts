import { readFileSync, readdirSync, type Dirent } from "node:fs";
import { extname, join, relative } from "node:path";
import { makeReport, type SafetyIssue, type SafetyReport } from "../types.js";
import { workspaceRoot } from "../renderer.js";

/**
 * Forbidden-API guard for registered scene code (N5, Requirement 7.1).
 *
 * Registered Remotion scene components must be pure functions of the frame, so
 * they may not reach for nondeterministic or unsafe APIs. This is the static,
 * source-text analogue of math_video_tool's F26/F27/F28 lint: scan the
 * compositions sources for banned constructs and flag each as a hard error.
 * Randomness must come only from Remotion's `random(seed)`.
 *
 * The matchers are deliberately precise (word-ish boundaries, member-access /
 * call shapes, quoted module specifiers) so that legitimate identifiers do not
 * false-positive — e.g. `Math.abs` is fine while `Math.random` is not, and a
 * comment mentioning a "process" is fine while `process.env` is not.
 */

type ForbiddenRule = {
  /** Human-readable token name used in the issue message. */
  token: string;
  /** Precise matcher applied per source line. */
  pattern: RegExp;
  /** Why it is banned + the deterministic alternative. */
  hint: string;
};

const FORBIDDEN_RULES: ForbiddenRule[] = [
  {
    token: "Math.random",
    pattern: /\bMath\s*\.\s*random\b/,
    hint: "Use Remotion's random(seed) for deterministic randomness.",
  },
  {
    token: "Date.now",
    pattern: /\bDate\s*\.\s*now\b/,
    hint: "Scene visuals must be pure functions of the frame; no wall-clock time.",
  },
  {
    token: "new Date(",
    pattern: /\bnew\s+Date\b/,
    hint: "Scene visuals must be pure functions of the frame; no wall-clock time.",
  },
  {
    token: "fetch(",
    pattern: /\bfetch\s*\(/,
    hint: "No network access in scene code.",
  },
  {
    token: "XMLHttpRequest",
    pattern: /\bXMLHttpRequest\b/,
    hint: "No network access in scene code.",
  },
  {
    token: "require(",
    pattern: /\brequire\s*\(/,
    hint: "No CommonJS require in scene code; use static ESM imports.",
  },
  {
    token: "import(",
    pattern: /\bimport\s*\(/,
    hint: "No dynamic import in scene code; use static ESM imports.",
  },
  {
    token: "fs module",
    pattern: /["'](?:node:)?fs(?:\/promises)?["']/,
    hint: "No filesystem access in scene code.",
  },
  {
    token: "child_process module",
    pattern: /["'](?:node:)?child_process["']/,
    hint: "No subprocess access in scene code.",
  },
  {
    token: "process.",
    pattern: /\bprocess\s*\./,
    hint: "No Node process access in scene code; scenes run in the render context only.",
  },
  {
    token: "eval(",
    pattern: /\beval\s*\(/,
    hint: "No dynamic code evaluation in scene code.",
  },
  {
    token: "Function(",
    pattern: /\bFunction\s*\(/,
    hint: "No dynamic Function construction in scene code.",
  },
  {
    token: "dangerouslySetInnerHTML",
    pattern: /\bdangerouslySetInnerHTML\b/,
    hint: "No raw HTML injection in scene code.",
  },
];

/** Absolute path to the registered scene sources (resolved from the workspace root). */
export function compositionsSrcDir(): string {
  return join(workspaceRoot(), "packages", "compositions", "src");
}

/**
 * Lint every `.ts`/`.tsx` source under `dir` (default: the compositions package
 * sources) for forbidden constructs. Each violation becomes a hard N5 error.
 */
export function lintSceneSources(dir: string = compositionsSrcDir()): SafetyReport {
  const issues: SafetyIssue[] = [];
  const files = collectSourceFiles(dir).sort();

  for (const file of files) {
    const rel = relative(dir, file).split("\\").join("/");
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of FORBIDDEN_RULES) {
        if (rule.pattern.test(line)) {
          const location = `${rel}:${index + 1}`;
          issues.push({
            check: "N5",
            severity: "error",
            path: location,
            message: `Forbidden API "${rule.token}" in scene source at ${location}. ${rule.hint}`,
          });
        }
      }
    });
  }

  return makeReport(issues, ["lint"]);
}

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = extname(entry.name);
    if ((ext === ".ts" || ext === ".tsx") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}
