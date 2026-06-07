import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite config for the renderer (React) process only. Electron main/preload are
 * built separately. Dev server URL is passed to the main process via
 * VITE_DEV_SERVER_URL.
 */
export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
  },
});
