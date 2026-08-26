import { join, normalize } from "node:path";

export function isLegacyElectronShortcut(
  details: { target?: string; appUserModelId?: string },
  appUserModelId: string,
): boolean {
  const legacySuffix = normalize(join("node_modules", "electron", "dist", "electron.exe")).toLowerCase();
  return (
    details.appUserModelId === appUserModelId &&
    normalize(details.target ?? "").toLowerCase().endsWith(legacySuffix)
  );
}
