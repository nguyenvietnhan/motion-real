import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { type SpikeResult } from "./types.js";

/**
 * Read/write the committed POC_Spike artifact (web-dashboard Task 2.4). The
 * file lives at `apps/desktop/spike-result.json`; implementation task 5.1 reads
 * `decision` from it to choose the Agent_Worker adapter (Y vs X).
 */
const here = dirname(fileURLToPath(import.meta.url));
export const SPIKE_RESULT_PATH = resolve(here, "../../spike-result.json");

export async function loadSpikeResult(path: string = SPIKE_RESULT_PATH): Promise<SpikeResult> {
  return JSON.parse(await readFile(path, "utf8")) as SpikeResult;
}

export async function writeSpikeResult(
  result: SpikeResult,
  path: string = SPIKE_RESULT_PATH,
): Promise<void> {
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
