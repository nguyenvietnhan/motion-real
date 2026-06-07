import type { ActivationOutcome, LicenseService } from "./license-manager.js";

/**
 * Concrete network License_Service client (web-dashboard Task 6.1, Req 1.1–1.6).
 *
 * The only code that talks to the external license provider (Gumroad / Lemon
 * Squeezy / Keygen). It speaks a small JSON contract and maps every response to
 * an `ActivationOutcome`; the 30s timeout + offline/timeout mapping is applied
 * by `LicenseManager` (which wraps these calls in an `AbortSignal` race), so a
 * thrown/aborted fetch propagates and is classified there. The activation key is
 * sent here and NEVER returned over IPC.
 */

type FetchLike = (url: string, init: { method: string; body: string; signal: AbortSignal; headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<{ status?: string }>;
}>;

export type LicenseServiceConfig = {
  endpoint: string;
  fetchImpl?: FetchLike;
};

/** Map a provider status string to an outcome reason. */
function statusToOutcome(status: string | undefined): ActivationOutcome {
  switch (status) {
    case "valid":
      return { ok: true, nodeLocked: true };
    case "limit":
      return { ok: false, reason: "limit" };
    case "revoked":
      return { ok: false, reason: "revoked" };
    default:
      return { ok: false, reason: "invalid" };
  }
}

/** Map a non-2xx HTTP status to an outcome reason. */
function httpStatusToOutcome(status: number): ActivationOutcome {
  if (status === 409) return { ok: false, reason: "limit" };
  if (status === 410) return { ok: false, reason: "revoked" };
  return { ok: false, reason: "invalid" };
}

export class HttpLicenseService implements LicenseService {
  private readonly endpoint: string;
  private readonly fetchImpl: FetchLike;

  constructor(config: LicenseServiceConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  private async call(path: string, payload: Record<string, string>, signal: AbortSignal): Promise<ActivationOutcome> {
    const res = await this.fetchImpl(`${this.endpoint}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) return httpStatusToOutcome(res.status);
    const body = await res.json();
    return statusToOutcome(body.status);
  }

  activate(key: string, machineId: string, signal: AbortSignal): Promise<ActivationOutcome> {
    return this.call("/activate", { key, machineId }, signal);
  }

  verify(machineId: string, signal: AbortSignal): Promise<ActivationOutcome> {
    return this.call("/verify", { machineId }, signal);
  }
}
