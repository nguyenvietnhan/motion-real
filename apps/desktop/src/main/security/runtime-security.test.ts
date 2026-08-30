import { describe, expect, it } from "vitest";
import {
  applyNonSensitiveEnvironment,
  detectProcessPrivilege,
  isTrustedApplicationPageUrl,
  privilegeStartupError,
  sanitizedChildEnvironment,
  scrubSensitiveEnvironment,
} from "./runtime-security.js";

describe("runtime security environment", () => {
  it("removes credential variables while preserving runtime configuration", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "bin",
      VIDEO_TOOL_HOME: "store",
      VITE_DEV_SERVER_URL: "http://localhost:5174",
      VIVIBE_API_KEY: "vivibe-secret",
      GITHUB_TOKEN: "github-secret",
      AWS_SECRET_ACCESS_KEY: "aws-secret",
    };

    expect(scrubSensitiveEnvironment(env)).toEqual([
      "AWS_SECRET_ACCESS_KEY",
      "GITHUB_TOKEN",
      "VIVIBE_API_KEY",
    ]);
    expect(env).toEqual({
      PATH: "bin",
      VIDEO_TOOL_HOME: "store",
      VITE_DEV_SERVER_URL: "http://localhost:5174",
    });
  });

  it("never copies secrets from an env file or into a child process", () => {
    const target: NodeJS.ProcessEnv = { PATH: "existing" };
    applyNonSensitiveEnvironment(
      { PATH: "replacement", LUCYLAB_ENDPOINT: "https://tts.test", AI_API_KEY: "secret" },
      target,
    );
    expect(target).toEqual({ PATH: "existing", LUCYLAB_ENDPOINT: "https://tts.test" });

    expect(
      sanitizedChildEnvironment({ PATH: "bin", OPENAI_API_KEY: "secret", AUTH_TOKEN: "secret" }),
    ).toEqual({ PATH: "bin" });
  });
});

describe("runtime security privilege gate", () => {
  it("distinguishes standard and elevated Windows tokens", () => {
    expect(
      detectProcessPrivilege({
        platform: "win32",
        runWindowsProbe: () => ({ status: 0, stdout: "standard\r\n" }),
      }),
    ).toBe("standard");
    expect(
      detectProcessPrivilege({
        platform: "win32",
        runWindowsProbe: () => ({ status: 0, stdout: "elevated\r\n" }),
      }),
    ).toBe("elevated");
  });

  it("fails closed when Windows privilege cannot be verified", () => {
    const status = detectProcessPrivilege({
      platform: "win32",
      runWindowsProbe: () => ({ status: 1, stdout: "" }),
    });
    expect(status).toBe("unknown");
    expect(privilegeStartupError(status)).toMatch(/Không thể xác minh/);
  });

  it("blocks root/elevated and permits a standard Unix user", () => {
    expect(detectProcessPrivilege({ platform: "linux", getuid: () => 0 })).toBe("elevated");
    expect(detectProcessPrivilege({ platform: "linux", getuid: () => 1000 })).toBe("standard");
    expect(privilegeStartupError("elevated")).toMatch(/Administrator\/root/);
    expect(privilegeStartupError("standard")).toBeUndefined();
  });
});

describe("renderer origin boundary", () => {
  it("accepts only the loaded app page or its dev-server origin", () => {
    expect(
      isTrustedApplicationPageUrl(
        "file:///V:/Projects/motion-real/apps/desktop/dist/renderer/index.html?restore=1",
        "file:///V:/Projects/motion-real/apps/desktop/dist/renderer/index.html",
      ),
    ).toBe(true);
    expect(
      isTrustedApplicationPageUrl(
        "file:///V:/Projects/motion-real/apps/desktop/dist/renderer/other.html",
        "file:///V:/Projects/motion-real/apps/desktop/dist/renderer/index.html",
      ),
    ).toBe(false);
    expect(
      isTrustedApplicationPageUrl("http://localhost:5174/agent", "http://localhost:5174/"),
    ).toBe(true);
    expect(isTrustedApplicationPageUrl("http://127.0.0.1:5174/", "http://localhost:5174/")).toBe(false);
    expect(isTrustedApplicationPageUrl("not a URL", "http://localhost:5174/")).toBe(false);
  });
});
