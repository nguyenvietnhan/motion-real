import { existsSync, readFileSync, writeFileSync, renameSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ELEVENLABS_DEFAULT_MODEL_ID,
  ElevenLabsClient,
  VivibeClient,
  defaultElevenLabsVoiceId,
  defaultVivibeVoiceId,
  elevenLabsApiKey,
  measureAudioDuration,
  vivibeApiKey,
  type CloudTtsProvider,
  type TtsClient,
} from "../packages/tts/src/index.js";
import { videoToolHome } from "../packages/pipeline/src/index.js";
import {
  computeWordsPerSecond,
  voiceCalibrationKey,
  type CalibrationSample,
} from "../apps/desktop/src/shared/settings-model.js";

/**
 * Vivibe read-rate calibration (freeform-engine K1/R5.4/D13).
 *
 * Sends a handful of fixed-length Vietnamese passages through the CONFIGURED
 * Vivibe voice, measures the REAL audio seconds each took, and derives the
 * average words/second (Σ words / Σ seconds). Writes the result + the voiceId it
 * was measured for back into the desktop settings JSON so the author prompt's
 * word-budget math uses the measured rate (replacing the baked ~4.7 guess). The
 * rate is voice-specific, so re-run this after changing the voice.
 *
 * Usage (needs the Vivibe key + voice id, same env the engine reads):
 *   npx tsx --env-file=.env scripts/calibrate-voice.ts
 *
 * It mirrors the real synth path: the SAME `VivibeClient.synthesize` +
 * `measureAudioDuration` the pipeline uses, so the measured rate reflects exactly
 * what a render produces. Read-only except for the settings file write (atomic).
 */

/**
 * Calibration passages: natural Vietnamese short-form narration, varied length
 * (~18–55 words) so the total-weighted average reflects real mixed pacing rather
 * than one sentence's quirk. Plain prose, digits as the content rules require, no
 * markup — exactly what the model is told to write.
 */
const PASSAGES: string[] = [
  "Trí tuệ nhân tạo đang thay đổi cách chúng ta làm việc mỗi ngày, từ soạn email đến phân tích dữ liệu phức tạp chỉ trong vài giây.",
  "Năm 2026, hơn 920 triệu người dùng smartphone trên toàn thế giới đã thử ít nhất một ứng dụng AI tạo sinh, một con số tăng gấp 3 lần so với 2 năm trước.",
  "Bí quyết không nằm ở việc làm nhiều hơn, mà ở việc chọn đúng thứ để làm và kiên trì với nó đủ lâu để thấy kết quả thật sự.",
  "Một chiếc xe điện trung bình hiện đi được 480 kilomet cho mỗi lần sạc, đủ cho cả tuần đi lại trong thành phố mà không cần lo lắng.",
  "Hãy thử tưởng tượng một ngày không điện thoại. Khó đúng không? Đó chính là mức độ mà công nghệ đã len lỏi vào từng phút giây cuộc sống của chúng ta.",
];

type DesktopSettings = {
  voiceProvider?: CloudTtsProvider;
  vivibeVoiceId?: string;
  elevenLabsVoiceId?: string;
  elevenLabsModelId?: string;
  voiceCalibrations?: Record<string, number>;
  // Legacy fields remain readable for migration compatibility.
  voiceId?: string;
  voiceApiKey?: string;
  voiceWordsPerSecond?: number;
  voiceWpsCalibratedFor?: string;
  [k: string]: unknown;
};

function settingsFilePath(): string {
  return join(videoToolHome(), "motionreal-settings.json");
}

function legacySettingsFilePath(): string {
  return join(videoToolHome(), "news-studio-settings.json");
}

/** Read one existing desktop settings JSON, warning clearly when unreadable. */
function readSettingsCandidate(path: string): { settings: DesktopSettings; ok: boolean } | null {
  if (!existsSync(path)) return null;
  try {
    return { settings: JSON.parse(readFileSync(path, "utf8")) as DesktopSettings, ok: true };
  } catch (e) {
    console.warn(`[calibrate] could not parse ${path}, trying next/defaults:`, e);
    return { settings: {}, ok: false };
  }
}

function readSettingsWithLegacy(canonicalPath: string, legacyPath: string): DesktopSettings {
  const paths = canonicalPath === legacyPath ? [canonicalPath] : [canonicalPath, legacyPath];
  for (const path of paths) {
    const candidate = readSettingsCandidate(path);
    if (candidate?.ok) return candidate.settings;
  }
  return {};
}

/** Atomic write so a crash mid-write never truncates the real settings file. */
function writeSettings(path: string, settings: DesktopSettings): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

async function main(): Promise<void> {
  const settingsPath = settingsFilePath();
  const settings = readSettingsWithLegacy(settingsPath, legacySettingsFilePath());

  const providerArg = process.argv.find((arg) => arg.startsWith("--provider="))?.split("=")[1]
    ?? (process.argv.includes("--provider") ? process.argv[process.argv.indexOf("--provider") + 1] : undefined);
  const provider: CloudTtsProvider = providerArg === "elevenlabs"
    ? "elevenlabs"
    : providerArg === "vivibe" ? "vivibe" : settings.voiceProvider ?? "vivibe";
  const apiKey = (provider === "vivibe" ? vivibeApiKey() : elevenLabsApiKey()).trim();
  const voiceId = ((provider === "vivibe"
    ? settings.vivibeVoiceId?.trim() || settings.voiceId?.trim() || defaultVivibeVoiceId()
    : settings.elevenLabsVoiceId?.trim() || defaultElevenLabsVoiceId()) || "").trim();
  const modelId = provider === "elevenlabs"
    ? settings.elevenLabsModelId?.trim() || ELEVENLABS_DEFAULT_MODEL_ID
    : undefined;
  if (!apiKey) {
    console.error(`[calibrate] Missing ${provider === "vivibe" ? "VIVIBE_API_KEY / VIETNAMESE_API_KEY" : "ELEVENLABS_API_KEY"} in .env.`);
    process.exitCode = 1;
    return;
  }
  if (!voiceId) {
    console.error(`[calibrate] Missing ${provider === "vivibe" ? "Vivibe" : "ElevenLabs"} voice id.`);
    process.exitCode = 1;
    return;
  }

  const client: TtsClient = provider === "vivibe" ? new VivibeClient({ apiKey }) : new ElevenLabsClient({ apiKey });
  const workDir = mkdtempSync(join(tmpdir(), "vivibe-calib-"));
  const samples: CalibrationSample[] = [];

  console.log(`[calibrate] provider=${provider} voice=${voiceId} — synthesizing ${PASSAGES.length} passages…`);
  try {
    for (let i = 0; i < PASSAGES.length; i += 1) {
      const text = PASSAGES[i]!;
      const outputPath = join(workDir, `passage-${i + 1}.mp3`);
      try {
        const result = await client.synthesize({ text, voiceId, speed: 1.0, outputPath, ...(modelId ? { modelId, languageCode: "vi" } : {}) });
        const seconds = await measureAudioDuration(result.audioPath);
        const words = text.trim().split(/\s+/).filter(Boolean).length;
        console.log(`[calibrate]   passage ${i + 1}: ${words} từ → ${seconds.toFixed(2)}s (${(words / seconds).toFixed(2)} từ/giây)`);
        samples.push({ text, seconds });
      } catch (e) {
        // One failed synth shouldn't abort the whole calibration; skip it and
        // calibrate from the rest (computeWordsPerSecond ignores bad samples).
        console.warn(`[calibrate]   passage ${i + 1} failed, skipping:`, e instanceof Error ? e.message : e);
      }
    }
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* best-effort temp cleanup */
    }
  }

  const wps = computeWordsPerSecond(samples);
  if (wps === undefined) {
    console.error("[calibrate] No usable measurements — settings left unchanged. Check the Vivibe key/voice/network and retry.");
    process.exitCode = 1;
    return;
  }

  settings.voiceCalibrations = {
    ...(settings.voiceCalibrations ?? {}),
    [voiceCalibrationKey({ provider, voiceId, ...(modelId ? { modelId } : {}), speed: 1 })]: wps,
  };
  delete settings.voiceWordsPerSecond;
  delete settings.voiceWpsCalibratedFor;
  writeSettings(settingsPath, settings);
  console.log(`[calibrate] OK — measured ${wps.toFixed(2)} từ/giây for voice ${voiceId}.`);
  console.log(`[calibrate] Saved provider-specific calibration to ${settingsPath}. The author prompt will use it on the next matching voice.`);
}

void main();
