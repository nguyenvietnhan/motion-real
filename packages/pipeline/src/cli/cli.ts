import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { listComponents } from "@motionreal/compositions";
import { getStylePack, listStylePackIds } from "@motionreal/theme";
import { fontCoverageReport } from "@motionreal/blocks";
import {
  defaultElevenLabsVoiceId,
  defaultVivibeVoiceId,
  elevenLabsApiKey,
  vivibeApiKey,
} from "@motionreal/tts";
import type { TtsProvider } from "../types.js";
import { projectPaths, trackerPath as defaultTrackerPath } from "../store/store.js";
import { ingestUrl } from "../ingest/url-ingest.js";
import { readTracker, writeTracker, upsertItem, type TrackerItem, type TrackerStatus } from "../tracker/tracker.js";
import { runBulkLoop, type BulkWorker } from "../bulk/bulk.js";
import {
  scaffoldVideoProject,
  renderProject,
  renderSampleDraft,
  type RenderProjectOptions,
} from "../orchestrator.js";

/**
 * @motionreal/pipeline CLI — pure AUTHOR mode. Verbs:
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

const TTS_PROVIDERS: ReadonlySet<string> = new Set<TtsProvider>(["vivibe", "elevenlabs", "mock", "none"]);

const PARSE_OPTIONS = {
  tts: { type: "string" },
  concurrency: { type: "string" },
  sample: { type: "boolean" },
  out: { type: "string" },
  "no-cache": { type: "boolean" },
  draft: { type: "boolean" },
  "force-full": { type: "boolean" },
  id: { type: "string" },
  tracker: { type: "string" },
  limit: { type: "string" },
  status: { type: "string" },
  reason: { type: "string" },
  project: { type: "string" },
  title: { type: "string" },
  source: { type: "string" },
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
      case "ingest":
        return await runIngestVerb(values, positionals, emit, lines);
      case "tracker":
        return await runTrackerVerb(values, positionals, emit, lines);
      case "bulk":
        return await runBulkVerb(values, emit, lines);
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
    emit("Usage: author scaffold <id-or-topic> [--tts vivibe|elevenlabs|mock|none]");
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

  const provider = tts.value ?? (process.env.TTS_PROVIDER === "elevenlabs" ? "elevenlabs" : undefined);
  const result = await scaffoldVideoProject({ prompt: topic, tts: provider ? { provider } : undefined });
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
  emit(`  npm --workspace @motionreal/remotion run studio -- --props=${paths.lock}`);
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

// --- ingest / tracker / bulk ----------------------------------------------

async function runIngestVerb(values: ParsedValues, positionals: string[], emit: Emit, lines: string[]): Promise<CliResult> {
  const url = positionals[1];
  if (!url) {
    emit("Usage: ingest <url> [--id <id>]");
    return { exitCode: 1, lines };
  }
  const result = await ingestUrl(url, values.id ? { id: values.id } : {});
  emit(`Ingested ${result.metadata.title || url}`);
  emit(`  research: ${result.researchPath}`);
  emit(`  words: ${result.wordCount}`);
  return { exitCode: 0, lines };
}

async function runTrackerVerb(values: ParsedValues, positionals: string[], emit: Emit, lines: string[]): Promise<CliResult> {
  const sub = positionals[1];
  const path = values.tracker ?? defaultTrackerPath();

  if (sub === "list") {
    const items = await readTracker(path);
    if (items.length === 0) emit("(tracker empty)");
    for (const it of items) emit(`  [${it.status}] ${it.id}  ${it.title || it.url}${it.reason ? `  — ${it.reason}` : ""}`);
    emit(`${items.length} item(s) at ${path}`);
    return { exitCode: 0, lines };
  }

  if (sub === "add") {
    const url = positionals[2];
    if (!url) {
      emit("Usage: tracker add <url> [--id <id>] [--title <t>] [--source <s>] [--tracker <path>]");
      return { exitCode: 1, lines };
    }
    const items = await readTracker(path);
    const id = values.id ?? slugFromUrl(url);
    const item: TrackerItem = {
      id,
      url,
      title: values.title ?? "",
      source: values.source ?? "",
      status: "pending",
      updatedAt: new Date().toISOString(),
    };
    await writeTracker(upsertItem(items, item), path);
    emit(`Added tracker item ${id} (pending).`);
    return { exitCode: 0, lines };
  }

  if (sub === "update") {
    const id = positionals[2];
    if (!id) {
      emit("Usage: tracker update <id> [--status <s>] [--reason <r>] [--project <id>] [--tracker <path>]");
      return { exitCode: 1, lines };
    }
    const items = await readTracker(path);
    if (!items.some((it) => it.id === id)) {
      emit(`Tracker item not found: ${id}`);
      return { exitCode: 1, lines };
    }
    const patch: Partial<TrackerItem> & { id: string } = {
      id,
      updatedAt: new Date().toISOString(),
      ...(values.status ? { status: values.status as TrackerStatus } : {}),
      ...(values.reason !== undefined ? { reason: values.reason } : {}),
      ...(values.project !== undefined ? { projectId: values.project } : {}),
    };
    await writeTracker(upsertItem(items, patch), path);
    emit(`Updated tracker item ${id}.`);
    return { exitCode: 0, lines };
  }

  emit("Usage: tracker list | add <url> ... | update <id> ...");
  return { exitCode: 1, lines };
}

async function runBulkVerb(values: ParsedValues, emit: Emit, lines: string[]): Promise<CliResult> {
  const path = values.tracker ?? defaultTrackerPath();
  const limit = values.limit !== undefined ? Number(values.limit) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    emit(`Invalid --limit "${values.limit}". Use a positive integer.`);
    return { exitCode: 1, lines };
  }

  // CLI worker: finish already-authored projects via the orchestrator (draft →
  // full). Authoring itself is the agent's job (no in-tool planner), so an item
  // must carry a projectId whose authored scenes are ready.
  const worker: BulkWorker = async (item) => {
    if (!item.projectId) {
      throw new Error("no projectId: scaffold + author the project first, then set the item's projectId");
    }
    await renderProject(item.projectId, { quality: "draft" });
    await renderProject(item.projectId, { quality: "full" });
    return { projectId: item.projectId };
  };

  const { outcomes } = await runBulkLoop({
    worker,
    trackerPath: path,
    ...(limit !== undefined ? { limit } : {}),
    onItem: (o) => emit(`  [${o.status}] ${o.id}${o.reason ? `  — ${o.reason}` : ""}`),
  });
  const done = outcomes.filter((o) => o.status === "done").length;
  const failed = outcomes.filter((o) => o.status === "failed").length;
  const paused = outcomes.filter((o) => o.status === "paused-resumable").length;
  emit(`Bulk run: ${outcomes.length} processed — ${done} done, ${failed} failed, ${paused} paused.`);
  return { exitCode: failed > 0 ? 1 : 0, lines };
}

/** Deterministic slug from a URL host+path (fallback tracker id). */
function slugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const slug = `${u.hostname}${u.pathname}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48);
    return slug || "item";
  } catch {
    return "item";
  }
}

export type DoctorCheck = { name: string; ok: boolean; detail: string };
export type DoctorReport = { ok: boolean; checks: DoctorCheck[] };

export type DoctorDeps = {
  checkEnv?: () => DoctorCheck;
  checkFfmpeg?: () => Promise<DoctorCheck>;
  checkBrowser?: () => Promise<DoctorCheck>;
  checkRegistry?: () => DoctorCheck;
  checkStylePacks?: () => DoctorCheck;
  checkFonts?: () => DoctorCheck;
};

/**
 * Verify environment readiness: Vivibe `.env` config, ffmpeg, a usable headless
 * browser, registry health, the style-pack registry, per-pack Vietnamese font
 * coverage, and bundled font readiness. Each probe is injectable so tests never
 * spawn ffmpeg or download Chromium. ALL checks run (never
 * short-circuit) so a single report lists every failure (R6.4); overall ready
 * only when every check passes (R6.3). In pure AUTHOR mode the registry is empty
 * until a project's authored scenes are admitted, so the registry check reports
 * the count without failing on zero.
 */
export async function runDoctor(deps: DoctorDeps = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [
    (deps.checkEnv ?? defaultCheckEnv)(),
    await (deps.checkFfmpeg ?? defaultCheckFfmpeg)(),
    await (deps.checkBrowser ?? defaultCheckBrowser)(),
    (deps.checkRegistry ?? defaultCheckRegistry)(),
    (deps.checkStylePacks ?? defaultCheckStylePacks)(),
    (deps.checkFonts ?? defaultCheckFonts)(),
  ];
  return { ok: checks.every((check) => check.ok), checks };
}

function defaultCheckEnv(): DoctorCheck {
  const provider = process.env.TTS_PROVIDER === "elevenlabs" ? "elevenlabs" : "vivibe";
  const missing: string[] = [];
  if (provider === "vivibe") {
    if (!vivibeApiKey()) missing.push("VIVIBE_API_KEY/VIETNAMESE_API_KEY");
    if (!defaultVivibeVoiceId()) missing.push("VIVIBE_VOICE_ID/VIETNAMESE_VOICEID");
  } else {
    if (!elevenLabsApiKey()) missing.push("ELEVENLABS_API_KEY");
    if (!defaultElevenLabsVoiceId()) missing.push("ELEVENLABS_VOICE_ID");
  }
  return {
    name: `${provider === "vivibe" ? "Vivibe" : "ElevenLabs"} .env`,
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

/** R6.1: the neutral theme resolves (the multi-language registry was retired). */
export function defaultCheckStylePacks(): DoctorCheck {
  const ids = listStylePackIds();
  const ok = ids.length > 0 && !!getStylePack(ids[0]);
  return {
    name: "style packs",
    ok,
    detail: ok
      ? `${ids.length} theme(s): ${ids.join(", ")}`
      : "no theme registered (the neutral theme failed to resolve)",
  };
}

/** R6 / design §6: every style pack's font families cover the Vietnamese subset. */
export function defaultCheckFonts(): DoctorCheck {
  const coverage = new Map(fontCoverageReport().map((f) => [f.family, f.hasVietnamese]));
  const leading = (stack: string): string => (stack.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "");
  const problems: string[] = [];
  for (const id of listStylePackIds()) {
    const pack = getStylePack(id);
    if (!pack) continue;
    const families = pack.fonts;
    for (const [role, stack] of Object.entries(families)) {
      const family = leading(stack);
      if (coverage.get(family) !== true) {
        problems.push(`${id}.${role} → ${family || "(empty)"}`);
      }
    }
  }
  return {
    name: "fonts (vietnamese coverage)",
    ok: problems.length === 0,
    detail:
      problems.length === 0
        ? "all style-pack fonts load the vietnamese subset"
        : `font(s) missing vietnamese coverage or not loaded: ${problems.join(", ")}`,
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
  id?: string;
  tracker?: string;
  limit?: string;
  status?: string;
  reason?: string;
  project?: string;
  title?: string;
  source?: string;
};
type Emit = (line?: string) => void;

function resolveTts(value: string | undefined): { ok: true; value?: TtsProvider } | { ok: false; message: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (!TTS_PROVIDERS.has(value)) {
    return { ok: false, message: `Unknown --tts "${value}". Use one of: vivibe, elevenlabs, mock, none.` };
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
    "  author scaffold <id-or-topic> [--tts vivibe|elevenlabs|mock|none]   Create a project skeleton + empty manifest + authored/ dir",
    "  render <id> [--tts vivibe|elevenlabs|mock|none] [--concurrency N] [--no-cache] [--draft] [--force-full]",
    "                                      Draft-first: render --draft for a preview, then full (gated on a prior draft; --force-full to override)",
    "  render --sample [--out <path>]      Render the bundled no-voice sample draft (no Vivibe needed)",
    "  preview <id>                        Print the Studio command for a project's locked spec",
    "  ingest <url> [--id <id>]            Fetch an article into planning/<id>.md (text + metadata only)",
    "  tracker list | add <url> ... | update <id> ...   Manage the bulk work queue (--tracker <path>)",
    "  bulk [--tracker <path>] [--limit N]  Resumable bulk loop over the tracker (finishes authored projects)",
    "  doctor | probe                      Check .env (Vivibe), ffmpeg, browser, registry, style packs, and fonts",
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
