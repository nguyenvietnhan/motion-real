import { describe, expect, it } from "vitest";
import { isLegacyElectronShortcut } from "./shell-identity.js";

describe("Windows shell identity", () => {
  it("only removes the old Electron host shortcut for Motion Real", () => {
    const aumid = "com.motionreal.desktop";

    expect(
      isLegacyElectronShortcut(
        { target: "V:\\OLD_MOTION_REAL\\node_modules\\electron\\dist\\electron.exe", appUserModelId: aumid },
        aumid,
      ),
    ).toBe(true);
    expect(isLegacyElectronShortcut({ target: "C:\\Other\\electron.exe", appUserModelId: aumid }, aumid)).toBe(false);
    expect(
      isLegacyElectronShortcut(
        { target: "V:\\motion_real\\node_modules\\electron\\dist\\electron.exe", appUserModelId: "other.app" },
        aumid,
      ),
    ).toBe(false);
  });
});
