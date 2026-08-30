import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const CSP_BASE = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: media:",
  "media-src 'self' data: blob: media:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "frame-src http://127.0.0.1:*",
];

function contentSecurityPolicy(dev: boolean): string {
  return [
    ...CSP_BASE,
    dev
      ? "connect-src 'self' http://localhost:20128 http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*"
      : "connect-src 'self' http://localhost:20128 http://127.0.0.1:*",
    dev
      ? "script-src 'self' 'unsafe-eval'"
      : "script-src 'self'",
  ].join("; ");
}

/**
 * Vite config for the renderer (React) process only. Electron main/preload are
 * built separately. Dev server URL is passed to the main process via
 * VITE_DEV_SERVER_URL.
 */
export default defineConfig(({ command }) => {
  const dev = command === "serve";
  const csp = contentSecurityPolicy(dev);
  return {
    root: "src/renderer",
    base: "./",
    plugins: [
      react(),
      {
        name: "motionreal-csp",
        transformIndexHtml(html) {
          return dev
            ? html
            : html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
        },
      },
    ],
    server: { headers: { "Content-Security-Policy": csp } },
    build: {
      outDir: "../../dist/renderer",
      emptyOutDir: true,
    },
  };
});
