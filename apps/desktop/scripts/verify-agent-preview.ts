/**
 * Verifies the exact Developer Preview runtime before the Electron UI enables
 * it. The process cannot read Main's in-memory credential, so the user must
 * supply a short-lived local 9router key through the environment.
 */
import { runVideoAgentVerification } from "../src/main/harness/video-agent-preview.js";

const apiKey = process.env.MOTIONREAL_9ROUTER_API_KEY?.trim();
if (!apiKey) {
  console.error("Set MOTIONREAL_9ROUTER_API_KEY for this one local verification run.");
  process.exitCode = 1;
} else {
  const report = await runVideoAgentVerification(apiKey);
  console.log(JSON.stringify({ status: report.status, completedAt: report.completedAt, assertions: report.assertions, failedAt: report.failedAt }, null, 2));
  process.exitCode = report.status === "pass" ? 0 : 1;
}
