/** Run with: npm run probe:opencode */
import { formatPocResult, runOpenCodePoc } from "../src/main/harness/opencode-poc.js";

const report = await runOpenCodePoc();
console.log(formatPocResult(report));
process.exitCode = report.status === "pass" ? 0 : 1;
