import { describe, expect, it } from "vitest";
import { z } from "zod";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getComponent, listComponents } from "@news/compositions";
import { admitAuthoredComponent, admitAndRegisterAuthored } from "./index.js";

/**
 * AI AUTHOR admission-gate self-tests (Requirement 13). Non-vacuous: a clean
 * authored module is admitted (and completes the registration handshake), while
 * each policy violation class — banned import (N4), banned API (N5), missing
 * required export (N4), and a non-literal registerComponent id (N4) — is rejected
 * with the matching violation. The bad modules are NEVER imported (admission is
 * a pure static gate), proving banned code never reaches the loader.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => join(here, "__fixtures__", name);

describe("admitAuthoredComponent (static AST gate)", () => {
  it("admits a clean authored module and returns its component id", () => {
    const result = admitAuthoredComponent(fixture("clean-card.tsx"));
    expect(result.admitted).toBe(true);
    if (result.admitted) expect(result.componentId).toBe("authored-demo-card");
  });

  it("rejects an import outside the whitelist (N4)", () => {
    const result = admitAuthoredComponent(fixture("banned-import.tsx"));
    expect(result.admitted).toBe(false);
    if (!result.admitted) {
      expect(result.violations.some((v) => v.check === "N4" && /node:fs/.test(v.message))).toBe(true);
    }
  });

  it("rejects a banned API (N5: Math.random)", () => {
    const result = admitAuthoredComponent(fixture("banned-api.tsx"));
    expect(result.admitted).toBe(false);
    if (!result.admitted) {
      expect(result.violations.some((v) => v.check === "N5" && /Math\.random/.test(v.message))).toBe(true);
    }
  });

  it("rejects evasive reaches for dangerous globals (N5: aliasing, computed access, globalThis, constructor chain)", () => {
    // The hardened gate must catch the indirections the old identifier-shaped
    // matchers missed (audit P1-1): `globalThis`, aliasing a banned global,
    // `x["process"]` computed access, and the `.constructor.constructor` chain.
    const result = admitAuthoredComponent(fixture("banned-evasion.tsx"));
    expect(result.admitted).toBe(false);
    if (!result.admitted) {
      const messages = result.violations.map((v) => v.message).join(" ");
      expect(result.violations.every((v) => v.check === "N5" || v.check === "N4")).toBe(true);
      expect(messages).toMatch(/globalThis/);
      expect(messages).toMatch(/process/);
      expect(messages).toMatch(/constructor/);
    }
  });

  it("rejects a module missing required exports (N4: schema/example)", () => {
    const result = admitAuthoredComponent(fixture("missing-export.tsx"));
    expect(result.admitted).toBe(false);
    if (!result.admitted) {
      const messages = result.violations.map((v) => v.message).join(" ");
      expect(messages).toMatch(/schema/);
      expect(messages).toMatch(/example/);
    }
  });

  it("rejects a non-literal registerComponent id (N4)", () => {
    const result = admitAuthoredComponent(fixture("no-literal-id.tsx"));
    expect(result.admitted).toBe(false);
    if (!result.admitted) {
      expect(result.violations.some((v) => /literal string id/.test(v.message))).toBe(true);
    }
  });
});

describe("admitAndRegisterAuthored (handshake)", () => {
  it("admits, imports, and registers a clean module so the planner can reference it", async () => {
    const result = await admitAndRegisterAuthored(fixture("clean-card.tsx"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.componentId).toBe("authored-demo-card");
      expect(getComponent("authored-demo-card")).toBeDefined();
      expect(listComponents().map((d) => d.id)).toContain("authored-demo-card");
    }
  });

  it("never registers a module that fails admission", async () => {
    const result = await admitAndRegisterAuthored(fixture("banned-api.tsx"));
    expect(result.ok).toBe(false);
    // The banned module was rejected statically and never imported/registered.
    expect(getComponent("authored-bad-api")).toBeUndefined();
  });

  it("mirrors the default export into the registry when a second instance didn't register it", async () => {
    // Simulate the Windows dual-instance case: the authored module's import
    // side-effect registered into a DIFFERENT @news/compositions registry, so
    // this registry has nothing — but the default export is a valid definition.
    const id = "authored-mirror-demo";
    expect(getComponent(id)).toBeUndefined();
    const def = {
      id,
      displayName: "Authored Mirror Demo",
      promptGuide: "x",
      schema: z.object({ label: z.string() }),
      Component: () => null,
      example: { label: "Mirror" },
    };
    const result = await admitAndRegisterAuthored(fixture("mirror-card.tsx"), {
      load: async () => ({ default: def, schema: def.schema, example: def.example }),
    });
    expect(result.ok).toBe(true);
    // The handshake mirrored the un-registered definition into this registry.
    expect(getComponent(id)).toBeDefined();
  });
});
