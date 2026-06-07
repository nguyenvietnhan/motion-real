import path from "node:path";
import { fileURLToPath } from "node:url";
import { Config } from "@remotion/cli/config";

/**
 * Remotion render/studio configuration.
 * Entry point lives in src/index.ts (registerRoot).
 */

/**
 * Resolve this config file's directory robustly in BOTH module contexts:
 *  - native ESM, where `import.meta.url` is a valid file URL, and
 *  - the Remotion CLI, which transpiles the config to CJS and evaluates it with
 *    `import.meta` empty (so `import.meta.url` is `undefined`). Calling
 *    `fileURLToPath(undefined)` there throws ERR_INVALID_ARG_TYPE, which is the
 *    crash this guards against. The CLI runs with cwd = apps/remotion (the
 *    config dir), so `process.cwd()` is the correct fallback.
 */
function configDir(): string {
  try {
    if (typeof import.meta !== "undefined" && import.meta.url) {
      return path.dirname(fileURLToPath(import.meta.url));
    }
  } catch {
    /* fall through to cwd-based resolution under the CLI's CJS eval */
  }
  return process.cwd();
}

const here = configDir();
const pkg = (name: string) => path.resolve(here, "..", "..", "packages", name, "src", "index.ts");

Config.setVideoImageFormat("jpeg");
Config.setConcurrency(2);

Config.overrideWebpackConfig((config) => {
  return {
    ...config,
    resolve: {
      ...config.resolve,
      extensions: [".ts", ".tsx", ".js", ".jsx", ...(config.resolve?.extensions ?? [])],
      // TypeScript (Bundler/NodeNext) writes `.js` specifiers for `.ts` files;
      // teach webpack to resolve them to the real TypeScript sources.
      extensionAlias: {
        ".js": [".ts", ".tsx", ".js"],
        ".jsx": [".tsx", ".jsx"],
      },
      alias: {
        ...(config.resolve?.alias ?? {}),
        "@news/schema": pkg("schema"),
        "@news/design": pkg("design"),
        "@news/blocks": pkg("blocks"),
        "@news/compositions": pkg("compositions"),
      },
    },
  };
});
