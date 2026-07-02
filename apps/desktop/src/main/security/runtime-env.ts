import { existsSync, readFileSync } from "node:fs";

export type BootVoiceEnv = Readonly<{
  vivibeApiKey: string;
  vivibeVoiceId?: string;
  elevenLabsApiKey: string;
  elevenLabsVoiceId?: string;
}>;

type ReadEnvFileDeps = {
  exists(path: string): boolean;
  readText(path: string): string;
  warn(error: unknown): void;
};

const DEFAULT_READ_ENV_FILE_DEPS: ReadEnvFileDeps = {
  exists: existsSync,
  readText: (path) => readFileSync(path, "utf8"),
  warn: (error) => console.warn("[env] failed to load .env:", error),
};

export function parseEnvText(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const key = m[1]!;
    let value = m[2]!;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function readEnvFile(path: string, deps: ReadEnvFileDeps = DEFAULT_READ_ENV_FILE_DEPS): Record<string, string> {
  if (!deps.exists(path)) return {};
  try {
    return parseEnvText(deps.readText(path));
  } catch (error) {
    deps.warn(error);
    return {};
  }
}

export function resolveBootVoiceEnv(
  processEnv: Record<string, string | undefined>,
  fileEnv: Record<string, string | undefined>,
): BootVoiceEnv {
  const trim = (value: string | undefined) => value?.trim();
  return Object.freeze({
    vivibeApiKey:
      trim(processEnv.VIVIBE_API_KEY) ||
      trim(processEnv.VIETNAMESE_API_KEY) ||
      trim(fileEnv.VIVIBE_API_KEY) ||
      trim(fileEnv.VIETNAMESE_API_KEY) ||
      "",
    vivibeVoiceId:
      trim(processEnv.VIVIBE_VOICE_ID) ||
      trim(processEnv.VIETNAMESE_VOICEID) ||
      trim(fileEnv.VIVIBE_VOICE_ID) ||
      trim(fileEnv.VIETNAMESE_VOICEID),
    elevenLabsApiKey:
      trim(processEnv.ELEVENLABS_API_KEY) ||
      trim(fileEnv.ELEVENLABS_API_KEY) ||
      "",
    elevenLabsVoiceId:
      trim(processEnv.ELEVENLABS_VOICE_ID) ||
      trim(fileEnv.ELEVENLABS_VOICE_ID),
  });
}
