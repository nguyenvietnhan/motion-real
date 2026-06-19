import { spawnSync } from "node:child_process";
import { join } from "node:path";

/** Environment names that commonly carry credentials rather than configuration. */
const SECRET_ENV_NAME =
  /(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIALS?)(?:$|_)/i;

export function isSensitiveEnvironmentKey(key: string): boolean {
  return SECRET_ENV_NAME.test(key);
}

/**
 * Copy only non-secret environment entries into a target. Existing target values
 * win, matching Node's usual env-file precedence without ever materializing a
 * credential from `.env` in the Electron main process environment.
 */
export function applyNonSensitiveEnvironment(
  values: Readonly<Record<string, string>>,
  target: NodeJS.ProcessEnv = process.env,
): void {
  for (const [key, value] of Object.entries(values)) {
    if (!isSensitiveEnvironmentKey(key) && target[key] === undefined) target[key] = value;
  }
}

/** Remove credential-looking variables in place and return the removed names. */
export function scrubSensitiveEnvironment(env: NodeJS.ProcessEnv = process.env): string[] {
  const removed: string[] = [];
  for (const key of Object.keys(env)) {
    if (!isSensitiveEnvironmentKey(key)) continue;
    delete env[key];
    removed.push(key);
  }
  return removed.sort();
}

/** Defense in depth for subprocesses started after boot. */
export function sanitizedChildEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !isSensitiveEnvironmentKey(key)));
}

export type PrivilegeStatus = "standard" | "elevated" | "unknown";

type PrivilegeProbeResult = {
  status: number | null;
  stdout: string;
  error?: unknown;
};

export type PrivilegeProbeOptions = {
  platform?: NodeJS.Platform;
  getuid?: () => number;
  runWindowsProbe?: () => PrivilegeProbeResult;
};

function runWindowsPrivilegeProbe(): PrivilegeProbeResult {
  const windowsRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
  const powershell = join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script =
    "$id=[Security.Principal.WindowsIdentity]::GetCurrent();" +
    "$p=New-Object Security.Principal.WindowsPrincipal($id);" +
    "if($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){'elevated'}else{'standard'}";
  const result = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    env: sanitizedChildEnvironment(),
  });
  return { status: result.status, stdout: result.stdout ?? "", ...(result.error ? { error: result.error } : {}) };
}

/**
 * Detect the privilege of the CURRENT token, not merely whether the account is a
 * member of Administrators. WindowsPrincipal returns false for a filtered UAC
 * token and true only when this process is actually elevated.
 */
export function detectProcessPrivilege(opts: PrivilegeProbeOptions = {}): PrivilegeStatus {
  const platform = opts.platform ?? process.platform;
  if (platform === "win32") {
    const result = (opts.runWindowsProbe ?? runWindowsPrivilegeProbe)();
    if (result.error || result.status !== 0) return "unknown";
    const answer = result.stdout.trim().toLowerCase();
    if (answer.endsWith("elevated")) return "elevated";
    if (answer.endsWith("standard")) return "standard";
    return "unknown";
  }

  const getuid = opts.getuid ?? process.getuid;
  if (!getuid) return "standard";
  try {
    return getuid() === 0 ? "elevated" : "standard";
  } catch {
    return "unknown";
  }
}

/** A non-empty message means startup must stop before opening the app window. */
export function privilegeStartupError(status: PrivilegeStatus): string | undefined {
  if (status === "standard") return undefined;
  if (status === "elevated") {
    return "News Studio đang chạy với quyền Administrator/root. Hãy đóng ứng dụng và mở lại từ tài khoản hoặc terminal không nâng quyền.";
  }
  return "Không thể xác minh quyền của tiến trình. Vì an toàn, News Studio chưa khởi động. Hãy mở lại từ terminal người dùng thông thường.";
}
