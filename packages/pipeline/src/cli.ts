import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { parseDurationPreset } from "@news/schema";

import { listComponents } from "@news/compositions";
import { defaultVivibeVoiceId, vivibeApiKey } from "@news/tts";
import type { AiProvider, TtsProvider } from "./types.js";
import { projectPaths } from "./store.js";
import { workspaceRoot } from "./renderer.js";
import {
  createVideoProject,
  renderProject,
  renderSampleDraft,
  type RenderProjectOptions,
} from "./orchestrator.js";

/**
 * @news/pipeline CLI (design B.7) — the `mvlib.build` front door. Verbs:
 *
 *   create <prompt> --duration <60|90|120|180> [--provider ...] [--tts ...]
 *   render <id> [--tts ...] [--concurrency N] | render --sample
 *   preview <id>
 *   doctor | probe
 *
 * `main(argv)` is pure-ish and TESTABLE: it returns an exit code + the lines it
 * would print rather than calling process.exit, so unit tests can drive verbs
 * without spawning processes. A thin runner at the bottom (guarded by
 * import.meta.url) wires it to process.argv / process.exit for real CLI use.
 * Arguments are parsed with node:util parseArgs (no new dependency).
 */

export type CliResult = {
  exitCode: number;
  lines: string[];
};

const PROVIDERS: ReadonlySet<string> = new Set<AiProvider>(["mock", "openai-compatible", "deepseek"]);
const TTS_PROVIDERS: ReadonlySet<string> = new Set<TtsProvider>(["vivibe", "mock", "none"]);

const PARSE_OPTIONS = {
  duration: { type: "string" },
  provider: { type: "string" },
  tts: { type: "string" },
  concurrency: { type: "string" },
  sample: { type: "boolean" },
  out: { type: "string" },
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
      case "create":
        return await runCreate(values, positionals, emit, lines);
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

// --- create ---------------------------------------------------------------

async function runCreate(
  values: ParsedValues,
  positionals: string[],
  emit: Emit,
  lines: string[],
): Promise<CliResult> {
  const prompt = positionals[1];
  if (!prompt) {
    emit("create requires a <prompt>.");
    emit(usage());
    return { exitCode: 1, lines };
  }

  let duration;
  try {
    duration = parseDurationPreset(values.duration);
  } catch (error) {
    emit(errMessage(error));
    return { exitCode: 1, lines };
  }

  const provider = resolveProvider(values.provider);
  if (!provider.ok) {
    emit(provider.message);
    return { exitCode: 1, lines };
  }
  const tts = resolveTts(values.tts);
  if (!tts.ok) {
    emit(tts.message);
    return { exitCode: 1, lines };
  }

  const result = await createVideoProject({
    prompt,
    duration,
    aiProvider: provider.value,
    tts: { provider: tts.value },
  });

  emit(`Created project ${result.projectId} (state: ${result.brief.state}).`);
  emit(`  spec:   ${projectPaths(result.projectId).spec}`);
  if (result.report.issues.length > 0) {
    emit(`  warnings: ${result.report.issues.length} advisory issue(s) — see the static grid.`);
  }
  emit(`Next: pipeline render ${result.projectId}`);
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

  const renderOpts: RenderProjectOptions = { concurrency };
  if (tts.value) renderOpts.ttsProvider = tts.value;
  const result = await renderProject(id, renderOpts);

  emit(`Rendered ${id} → ${result.mp4Path}${result.cached ? " (from cache)" : ""}`);
  if (!result.report.ok) {
    emit("  Review checklist is incomplete — project is not yet 'done'. Complete the review gate (N25).");
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
  const specPath = existsSync(paths.lock) ? paths.lock : paths.spec;
  if (!existsSync(specPath)) {
    emit(`No spec found for project ${id}. Run 'pipeline create' first.`);
    return { exitCode: 1, lines };
  }

  const kind = specPath === paths.lock ? "locked" : "draft";
  emit(`Preview ${id} (${kind} spec): ${specPath}`);
  emit("Launch Remotion Studio with the spec via inputProps, e.g.:");
  emit(`  npm --workspace @news/remotion run studio -- --props=${specPath}`);
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
 * Verify environment readiness (Requirement 12.2): Vivibe `.env` config, ffmpeg,
 * a usable headless browser, and registry health. Each probe is injectable so
 * tests never spawn ffmpeg or download Chromium; defaults run the real checks.
 * `ok` is false if any check fails (the runner exits non-zero), and every check
 * reports its missing item by name.
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
    ok: count > 0,
    detail: count > 0 ? `${count} component(s) registered` : "no components registered",
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
  duration?: string;
  provider?: string;
  tts?: string;
  concurrency?: string;
  sample?: boolean;
  out?: string;
};
type Emit = (line?: string) => void;

function resolveProvider(value: string | undefined): { ok: true; value: AiProvider } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: "mock" };
  if (!PROVIDERS.has(value)) {
    return { ok: false, message: `Unknown --provider "${value}". Use one of: mock, openai-compatible, deepseek.` };
  }
  return { ok: true, value: value as AiProvider };
}

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
    "  create <prompt> --duration <60|90|120|180> [--provider mock|openai-compatible|deepseek] [--tts vivibe|mock|none]",
    "  render <id> [--tts vivibe|mock|none] [--concurrency N]",
    "  render --sample [--out <path>]      Render the bundled no-voice sample draft (no Vivibe needed)",
    "  preview <id>                        Print the Studio command for a project's locked/draft spec",
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
