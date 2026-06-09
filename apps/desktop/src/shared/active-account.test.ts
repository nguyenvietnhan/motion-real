import { describe, expect, it } from "vitest";
import { activeAccount } from "./active-account.js";
import type { AiAccountState } from "./types.js";

describe("activeAccount", () => {
  it("returns undefined when there is no connected account", () => {
    expect(activeAccount({ kind: "disconnected" })).toBeUndefined();
    expect(activeAccount({ kind: "connecting", provider: "codex" })).toBeUndefined();
  });

  it("selects the single 9router-active account", () => {
    const account: AiAccountState = {
      kind: "connected",
      accounts: [
        { provider: "antigravity", label: "old-gemini@example.com", active: false },
        { provider: "codex", label: "codex@example.com", active: true },
      ],
      selectedModel: { id: "cx/gpt-5.5", label: "cx/gpt-5.5" },
    };

    expect(activeAccount(account)?.label).toBe("codex@example.com");
  });

  it("falls back to the first account when the active signal is absent or ambiguous", () => {
    const noFlag: AiAccountState = {
      kind: "connected",
      accounts: [
        { provider: "gemini", label: "first@example.com" },
        { provider: "codex", label: "second@example.com" },
      ],
    };
    const manyFlags: AiAccountState = {
      kind: "connected",
      accounts: [
        { provider: "gemini", label: "first@example.com", active: true },
        { provider: "codex", label: "second@example.com", active: true },
      ],
    };

    expect(activeAccount(noFlag)?.label).toBe("first@example.com");
    expect(activeAccount(manyFlags)?.label).toBe("first@example.com");
  });
});
