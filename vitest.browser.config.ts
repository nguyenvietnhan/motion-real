import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

/** Small real-browser smoke suite; Node unit tests remain in vitest.config.ts. */
const localEdge = process.platform === "win32" && !process.env.CI;

export default defineConfig({
  test: {
    include: ["apps/desktop/src/renderer/**/*.browser.test.tsx"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(localEdge ? { launchOptions: { channel: "msedge" } } : {}),
      instances: [{ browser: "chromium" }],
      viewport: { width: 1280, height: 800 },
      screenshotDirectory: ".vitest-attachments/screenshots",
    },
  },
});
