import {
  parseAiJsonOutput,
  VideoSpecSchema,
  type DurationPreset,
  type VideoSpec,
} from "@news/schema";
import type { AiProvider, SafetyIssue } from "../types.js";
import { runStaticGrid } from "../safety/static-grid.js";
import { buildPlannerPrompt } from "./catalog.js";
import { buildMockSpec } from "./mock.js";

export { buildPlannerPrompt, buildPlannerCatalog } from "./catalog.js";
export { buildMockSpec } from "./mock.js";

export type PlanInput = {
  prompt: string;
  duration: DurationPreset;
  aiProvider: AiProvider;
};

export type PlanResult = {
  spec: VideoSpec;
  issues: SafetyIssue[]; // remaining warnings (errors would have thrown)
  attempts: number;
};

/**
 * Plan a VideoSpec from a prompt. PICK mode: the planner may only reference
 * registered components. Mock mode returns an evidence-safe spec; external
 * providers run a validate-and-retry loop against the static grid.
 */
export async function planVideoSpec(input: PlanInput): Promise<PlanResult> {
  const config = resolveExternalConfig(input.aiProvider);
  if (!config) {
    const spec = buildMockSpec(input.prompt, input.duration);
    const report = parseAndValidate(JSON.stringify(spec), input.duration);
    return { spec: report.spec, issues: report.warnings, attempts: 1 };
  }
  if (!config.apiKey) {
    throw new Error(
      `${config.label} planner selected but AI_API_KEY is missing. Set it in .env or switch AI_PROVIDER to mock.`,
    );
  }
  return planWithOpenAiCompatible(input, config);
}

type ExternalConfig = { apiBase: string; apiKey: string; label: string; model: string };

function resolveExternalConfig(provider: AiProvider): ExternalConfig | null {
  if (provider === "deepseek") {
    return {
      apiBase: pickReal(process.env.AI_API_BASE_URL, "https://api.deepseek.com"),
      apiKey: process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || "",
      label: "DeepSeek",
      model: pickReal(process.env.AI_MODEL, "deepseek-v4-flash"),
    };
  }
  if (provider === "openai-compatible") {
    return {
      apiBase: process.env.AI_API_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: process.env.AI_API_KEY ?? "",
      label: "OpenAI-compatible",
      model: process.env.AI_MODEL ?? "gpt-4.1-mini",
    };
  }
  return null;
}

function pickReal(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed !== "https://api.openai.com/v1" && trimmed !== "gpt-4.1-mini" ? trimmed : fallback;
}

async function planWithOpenAiCompatible(input: PlanInput, config: ExternalConfig): Promise<PlanResult> {
  const system = buildPlannerPrompt(input.prompt, input.duration);
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: system },
    { role: "user", content: "Hãy tạo video-spec.json ngay bây giờ." },
  ];

  let lastError = "";
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const raw = await callChatCompletions(config, messages);
    try {
      const { spec, warnings } = parseAndValidate(raw, input.duration);
      return { spec, issues: warnings, attempts: attempt };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      messages.push({ role: "assistant", content: raw });
      messages.push({
        role: "user",
        content: `Đầu ra trước đó không hợp lệ:\n${lastError}\n\nHãy sửa và chỉ trả về JSON hợp lệ.`,
      });
    }
  }
  throw new Error(`AI planner failed validation after ${maxAttempts} attempts: ${lastError}`);
}

/** Parse + schema-validate + static-grid; throws on any hard error. */
function parseAndValidate(raw: string, duration: DurationPreset): { spec: VideoSpec; warnings: SafetyIssue[] } {
  const parsed = parseAiJsonOutput(raw);
  const schema = VideoSpecSchema.safeParse(parsed);
  if (!schema.success) {
    throw new Error(schema.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const spec = schema.data;
  if (spec.duration !== duration) {
    throw new Error(`Spec duration must equal requested preset ${duration}, got ${spec.duration}.`);
  }
  const report = runStaticGrid(spec);
  const errors = report.issues.filter((i) => i.severity === "error");
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
  return { spec, warnings: report.issues };
}

async function callChatCompletions(
  config: ExternalConfig,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const url = `${config.apiBase.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.7,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    throw new Error(`${config.label} request failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`${config.label} returned no content.`);
  }
  return content;
}
