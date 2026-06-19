import { existsSync, readFileSync, writeFileSync, renameSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VivibeClient, measureAudioDuration } from "../packages/tts/src/index.js";
import { vivibeApiKey, defaultVivibeVoiceId, videoToolHome } from "../packages/pipeline/src/index.js";
import {
  computeWordsPerSecond,
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
  voiceId?: string;
  voiceApiKey?: string;
  voiceWordsPerSecond?: number;
  voiceWpsCalibratedFor?: string;
  [k: string]: unknown;
};

function settingsFilePath(): string {
  return join(videoToolHome(), "news-studio-settings.json");
}

/** Read the desktop settings JSON (or {} when absent/unreadable). */
function readSettings(path: string): DesktopSettings {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as DesktopSettings;
  } catch (e) {
    console.warn(`[calibrate] could not parse ${path}, treating as empty:`, e);
    return {};
  }
}

/** Atomic write so a crash mid-write never truncates the real settings file. */
function writeSettings(path: string, settings: DesktopSettings): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

async function main(): Promise<void> {
  const settingsPath = settingsFilePath();
  const settings = readSettings(settingsPath);

  // Voice config: a key/id saved in the settings UI wins, else the .env fallback
  // the engine reads (VIVIBE_API_KEY / VIETNAMESE_API_KEY, VIVIBE_VOICE_ID / …).
  const apiKey = (settings.voiceApiKey?.trim() || vivibeApiKey()).trim();
  const voiceId = (settings.voiceId?.trim() || defaultVivibeVoiceId() || "").trim();
  if (!apiKey) {
    console.error("[calibrate] Missing Vivibe API key. Set VIVIBE_API_KEY / VIETNAMESE_API_KEY in .env (or save it in Settings).");
    process.exitCode = 1;
    return;
  }
  if (!voiceId) {
    console.error("[calibrate] Missing Vivibe voice id. Set VIVIBE_VOICE_ID / VIETNAMESE_VOICEID in .env (or save it in Settings).");
    process.exitCode = 1;
    return;
  }

  const client = new VivibeClient({ apiKey });
  const workDir = mkdtempSync(join(tmpdir(), "vivibe-calib-"));
  const samples: CalibrationSample[] = [];

  console.log(`[calibrate] voice=${voiceId} — synthesizing ${PASSAGES.length} passages…`);
  try {
    for (let i = 0; i < PASSAGES.length; i += 1) {
      const text = PASSAGES[i]!;
      const outputPath = join(workDir, `passage-${i + 1}.mp3`);
      try {
        const result = await client.synthesize({ text, voiceId, speed: 1.0, outputPath });
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

  settings.voiceWordsPerSecond = wps;
  settings.voiceWpsCalibratedFor = voiceId;
  writeSettings(settingsPath, settings);
  console.log(`[calibrate] OK — measured ${wps.toFixed(2)} từ/giây for voice ${voiceId}.`);
  console.log(`[calibrate] Wrote voiceWordsPerSecond=${wps.toFixed(2)} to ${settingsPath}. The author prompt will use it on the next video.`);
}

void main();
