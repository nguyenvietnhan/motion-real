import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { listComponents } from "@news/compositions";
import { defaultVivibeVoiceId, vivibeApiKey } from "@news/tts";
import type { TtsProvider } from "../types.js";
import { projectPaths } from "../store/store.js";
import {
  scaffoldVideoProject,
  renderProject,
  renderSampleDraft,
  type RenderProjectOptions,
} from "../orchestrator.js";

/**
 * @news/pipeline CLI — pure AUTHOR mode. Verbs:
 *
 *   author scaffold <id-or-topic> [--tts ...]   Create a project skeleton + empty manifest + authored/ dir
 *   render <id> [--tts ...] [--concurrency N] [--no-cache] | render --sample
 *   preview <id>
 *   doctor | probe
 *
 * `main(argv)` returns an exit code + the lines it would print (testable without
 * spawning processes); a thin runner wires it to process.argv/exit for real use.
 */

export type CliResult = {
  exitCode: number;
  lines: string[];
};

const TTS_PROVIDERS: ReadonlySet<string> = new Set<TtsProvider>(["vivibe", "mock", "none"]);

const PARSE_OPTIONS = {
  tts: { type: "string" },
  concurrency: { type: "string" },
  sample: { type: "boolean" },
  out: { type: "string" },
  "no-cache": { type: "boolean" },
  draft: { type: "boolean" },
  "force-full": { type: "boolean" },
} as const;

export async function main(argv: string[]): Promise<CliResult> {
  const lines: string[] = [];
  const emit = (line = "") => {
    lines.push(line);
  };

  let parsed: ReturnType<typeof parseArgs<{ options: typeof PARSE_OPTIONS; args: string[]; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: argv, options: PARSE_OPTIONS, allowPositionals: true });
  } catch (error) {
    emit(`Argument error: ${errMessage(error)}`);
    emit(usage());
    return { exitCode: 1, lines };
  }

  const { values, positionals } = parsed;
  const verb = positionals[0];

  try {
    switch (verb) {
      case "author":
        return await runAuthor(values, positionals, emit, lines);
      case "render":
        return await runRender(values, positionals, emit, lines);
      case "preview":
        return runPreview(positionals, emit, lines);
      case "doctor":
      case "probe":
        return await runDoctorVerb(emit, lines);
      default:
        emit(verb ? `Unknown command: ${verb}` : "No command given.");
        emit(usage());
        return { exitCode: 1, lines };
    }
  } catch (error) {
    emit(`Error: ${errMessage(error)}`);
    return { exitCode: 1, lines };
  }
}

// --- author scaffold -------------------------------------------------------

async function runAuthor(
  values: ParsedValues,
  positionals: string[],
  emit: Emit,
  lines: string[],
): Promise<CliResult> {
  const sub = positionals[1];
  if (sub !== "scaffold") {
    emit("Usage: author scaffold <id-or-topic> [--tts vivibe|mock|none]");
    return { exitCode: 1, lines };
  }
  const topic = positionals.slice(2).join(" ").trim();
  if (!topic) {
    emit("author scaffold requires an <id-or-topic>.");
    emit(usage());
    return { exitCode: 1, lines };
  }

  const tts = resolveTts(values.tts);
  if (!tts.ok) {
    emit(tts.message);
    return { exitCode: 1, lines };
  }

  const result = await scaffoldVideoProject({ prompt: topic, tts: tts.value ? { provider: tts.value } : undefined });
  emit(`Scaffolded project ${result.projectId} (state: ${result.brief.state}).`);
  emit(`  manifest: ${result.manifestPath}`);
  emit(`  authored: ${result.authoredDir}`);
  emit("Next: write authored scene .tsx modules under authored/, fill manifest.json, then:");
  emit(`  pipeline render ${result.projectId}`);
  return { exitCode: 0, lines };
}

// --- render ---------------------------------------------------------------

async function runRender(
  values: ParsedValues,
  positionals: string[],
  emit: Emit,
  lines: string[],
): Promise<CliResult> {
  const concurrency = parseConcurrency(values.concurrency);

  if (values.sample) {
    const result = await renderSampleDraft({ outPath: values.out, concurrency });
    emit(`Rendered no-voice sample draft → ${result.outPath}`);
    emit(`  ${result.durationInFrames} frames @ ${result.fps} fps.`);
    return { exitCode: 0, lines };
  }

  const id = positionals[1];
  if (!id) {
    emit("render requires a <id> (or --sample for the bundled no-voice draft).");
    emit(usage());
    return { exitCode: 1, lines };
  }

  const tts = resolveTts(values.tts);
  if (!tts.ok) {
    emit(tts.message);
    return { exitCode: 1, lines };
  }

  const renderOpts: RenderProjectOptions = { concurrency, noCache: Boolean(values["no-cache"]) };
  if (tts.value) renderOpts.ttsProvider = tts.value;
  // Draft-first: `--draft` renders the fast low-res preview; a full render is
  // gated on a prior draft unless `--force-full` is given.
  if (values.draft) renderOpts.quality = "draft";
  if (values["force-full"]) renderOpts.forceFull = true;
  const result = await renderProject(id, renderOpts);

  const kind = values.draft ? "draft" : "full";
  emit(`Rendered ${id} (${kind}) → ${result.mp4Path}${result.cached ? " (from cache)" : ""}`);
  if (!result.report.ok) {
    emit("  Render oracles / review checklist incomplete — project is not yet 'done'.");
  }
  return { exitCode: 0, lines };
}

// --- preview --------------------------------------------------------------

function runPreview(positionals: string[], emit: Emit, lines: string[]): CliResult {
  const id = positionals[1];
  if (!id) {
    emit("preview requires a <id>.");
    emit(usage());
    return { exitCode: 1, lines };
  }

  const paths = projectPaths(id);
  const specPath = existsSync(paths.lock) ? paths.lock : existsSync(paths.spec) ? paths.spec : paths.manifest;
  if (!existsSync(specPath)) {
    emit(`No manifest/spec found for project ${id}. Run 'pipeline author scaffold' first.`);
    return { exitCode: 1, lines };
  }

  const kind = specPath === paths.lock ? "locked" : specPath === paths.spec ? "draft" : "manifest";
  emit(`Preview ${id} (${kind}): ${specPath}`);
  emit("Launch Remotion Studio with the locked spec via inputProps, e.g.:");
  emit(`  npm --workspace @news/remotion run studio -- --props=${paths.lock}`);
  return { exitCode: 0, lines };
}

// --- doctor / probe -------------------------------------------------------

async function runDoctorVerb(emit: Emit, lines: string[]): Promise<CliResult> {
  const report = await runDoctor();
  emit("Doctor — environment readiness");
  for (const check of report.checks) {
    emit(`  [${check.ok ? "PASS" : "FAIL"}] ${check.name}: ${check.detail}`);
  }
  emit(report.ok ? "All checks passed." : "One or more checks failed; see items above.");
  return { exitCode: report.ok ? 0 : 1, lines };
}

export type DoctorCheck = { name: string; ok: boolean; detail: string };
export type DoctorReport = { ok: boolean; checks: DoctorCheck[] };

export type DoctorDeps = {
  checkEnv?: () => DoctorCheck;
  checkFfmpeg?: () => Promise<DoctorCheck>;
  checkBrowser?: () => Promise<DoctorCheck>;
  checkRegistry?: () => DoctorCheck;
};

/**
 * Verify environment readiness: Vivibe `.env` config, ffmpeg, a usable headless
 * browser, and registry health. Each probe is injectable so tests never spawn
 * ffmpeg or download Chromium. In pure AUTHOR mode the registry is empty until a
 * project's authored scenes are admitted, so the registry check reports the
 * count without failing on zero.
 */
export async function runDoctor(deps: DoctorDeps = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [
    (deps.checkEnv ?? defaultCheckEnv)(),
    await (deps.checkFfmpeg ?? defaultCheckFfmpeg)(),
    await (deps.checkBrowser ?? defaultCheckBrowser)(),
    (deps.checkRegistry ?? defaultCheckRegistry)(),
  ];
  return { ok: checks.every((check) => check.ok), checks };
}

function defaultCheckEnv(): DoctorCheck {
  const missing: string[] = [];
  if (!vivibeApiKey()) missing.push("VIVIBE_API_KEY/VIETNAMESE_API_KEY");
  if (!defaultVivibeVoiceId()) missing.push("VIVIBE_VOICE_ID/VIETNAMESE_VOICEID");
  return {
    name: "Vivibe .env",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "API key + voice id configured" : `missing: ${missing.join(", ")}`,
  };
}

async function defaultCheckFfmpeg(): Promise<DoctorCheck> {
  const ok = await probeCommand("ffmpeg", ["-version"]);
  return {
    name: "ffmpeg",
    ok,
    detail: ok ? "ffmpeg is on PATH" : "ffmpeg not found on PATH (needed for audio concat / contact sheet)",
  };
}

async function defaultCheckBrowser(): Promise<DoctorCheck> {
  try {
    const { ensureBrowser } = await import("@remotion/renderer");
    await ensureBrowser({ logLevel: "error" });
    return { name: "browser", ok: true, detail: "headless Chromium available" };
  } catch (error) {
    return { name: "browser", ok: false, detail: `headless browser unavailable: ${errMessage(error)}` };
  }
}

function defaultCheckRegistry(): DoctorCheck {
  const count = listComponents().length;
  return {
    name: "registry",
    ok: true,
    detail:
      count > 0
        ? `${count} component(s) registered`
        : "0 components (pure AUTHOR mode: scenes register per project at render time)",
  };
}

function probeCommand(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { shell: false, stdio: "ignore" });
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

// --- arg helpers ----------------------------------------------------------

type ParsedValues = {
  tts?: string;
  concurrency?: string;
  sample?: boolean;
  out?: string;
  "no-cache"?: boolean;
  draft?: boolean;
  "force-full"?: boolean;
};
type Emit = (line?: string) => void;

function resolveTts(value: string | undefined): { ok: true; value?: TtsProvider } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (!TTS_PROVIDERS.has(value)) {
    return { ok: false, message: `Unknown --tts "${value}". Use one of: vivibe, mock, none.` };
  }
  return { ok: true, value: value as TtsProvider };
}

function parseConcurrency(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function usage(): string {
  return [
    "Usage: pipeline <command> [options]",
    "",
    "Commands:",
    "  author scaffold <id-or-topic> [--tts vivibe|mock|none]   Create a project skeleton + empty manifest + authored/ dir",
    "  render <id> [--tts vivibe|mock|none] [--concurrency N] [--no-cache] [--draft] [--force-full]",
    "                                      Draft-first: render --draft for a preview, then full (gated on a prior draft; --force-full to override)",
    "  render --sample [--out <path>]      Render the bundled no-voice sample draft (no Vivibe needed)",
    "  preview <id>                        Print the Studio command for a project's locked spec",
    "  doctor | probe                      Check .env (Vivibe), ffmpeg, browser, and registry health",
  ].join("\n");
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- thin runner ----------------------------------------------------------

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  main(process.argv.slice(2))
    .then((result) => {
      for (const line of result.lines) console.log(line);
      process.exit(result.exitCode);
    })
    .catch((error) => {
      console.error(errMessage(error));
      process.exit(1);
    });
}
