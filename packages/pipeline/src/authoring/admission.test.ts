import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getComponent, getTransition, unregisterComponent, unregisterTransition } from "@news/compositions";
import {
  admitAuthoredComponent,
  admitAuthoredSceneFile,
  admitAuthoredTransition,
  admitAuthoredTransitionFile,
} from "./index.js";

/**
 * AI AUTHOR admission-gate self-tests (Requirement 13). Non-vacuous: a clean
 * authored module is admitted without host import/registration, while
 * each policy violation class — banned import (N4), banned API (N5), missing
 * required export (N4), and a non-literal registerComponent id (N4) — is rejected
 * with the matching violation. The bad modules are NEVER imported (admission is
 * a pure static gate), proving banned code never executes in the host.
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

  it("rejects host-RCE bypass: global root + runtime-built computed key + import.meta (N5)", () => {
    // The exact bypass the audit found: `global.process.getBuiltinModule(...)`
    // (old gate skipped `process` in a property-name slot AND had no `global` ban),
    // plus `self["ev"+"al"]` (runtime-built key dodged the by-name check), plus
    // `import.meta.url` (MetaProperty was unguarded).
    const result = admitAuthoredComponent(fixture("banned-host-rce.tsx"));
    expect(result.admitted).toBe(false);
    if (!result.admitted) {
      const messages = result.violations.map((v) => v.message).join(" ");
      expect(messages).toMatch(/global/);
      expect(messages).toMatch(/self/);
      expect(messages).toMatch(/eval/);
      expect(messages).toMatch(/import\.meta/);
    }
  });

  it.each([
    ["no-substitution template", "banned-template-constructor.tsx"],
    ["const alias", "banned-alias-constructor.tsx"],
    ["String.fromCharCode alias", "banned-charcode-constructor.tsx"],
  ])("rejects constructor-chain bypass via %s (N5)", (_label, name) => {
    const result = admitAuthoredComponent(fixture(name));
    expect(result.admitted).toBe(false);
    if (!result.admitted) {
      const messages = result.violations.map((v) => v.message).join(" ");
      expect(messages).toMatch(/constructor|String\.fromCharCode|forbidden API|string literal/);
    }
  });

  it("admits ordinary numeric/static-key indexing (regression: a too-broad ban would roll back valid scenes)", () => {
    // `colors[i]`, `springs[i + 1]`, and a single-literal `obj["alpha"]` are all
    // patterns dataviz scenes use constantly — they must still admit. Only
    // NAME-BUILDING keys (concat/template/call) are rejected.
    const result = admitAuthoredComponent(fixture("indexing-ok.tsx"));
    expect(result.admitted).toBe(true);
    if (result.admitted) expect(result.componentId).toBe("authored-indexing-ok");
  });

  it("rejects raw media primitives (N5: Img/staticFile) — images must go through <SceneImage>", () => {
    const result = admitAuthoredComponent(fixture("banned-media.tsx"));
    expect(result.admitted).toBe(false);
    if (!result.admitted) {
      const messages = result.violations.map((v) => v.message).join(" ");
      expect(result.violations.every((v) => v.check === "N5")).toBe(true);
      expect(messages).toMatch(/Img/);
      expect(messages).toMatch(/staticFile/);
    }
  });

  it("rejects raw JSX media carriers and hard-coded remote URL literals (N5/N9)", () => {
    const result = admitAuthoredComponent(fixture("banned-raw-media-url.tsx"));
    expect(result.admitted).toBe(false);
    if (!result.admitted) {
      const messages = result.violations.map((v) => v.message).join(" ");
      expect(messages).toMatch(/<img>/);
      expect(messages).toMatch(/createElement\("iframe"\)/);
      expect(messages).toMatch(/remote\/file URL literal/);
    }
  });

  it("allows local SVG fragment paint-server refs like url(#gradient)", () => {
    const result = admitAuthoredComponent(fixture("svg-fragment-url-ok.tsx"));
    expect(result.admitted).toBe(true);
    if (result.admitted) expect(result.componentId).toBe("authored-svg-fragment-url-ok");
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

  it("rejects malformed TSX syntax without relying on a host import", () => {
    const result = admitAuthoredComponent(fixture("banned-invalid-syntax.tsx"));
    expect(result.admitted).toBe(false);
    if (!result.admitted) {
      expect(result.violations.some((v) => v.check === "N4" && /invalid TSX syntax/.test(v.message))).toBe(true);
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

describe("admitAuthoredSceneFile (pure no-host-execution admission)", () => {
  it("admits a clean module without importing/registering it in the host registry", async () => {
    const id = "authored-demo-card";
    unregisterComponent(id);
    const result = await admitAuthoredSceneFile(fixture("clean-card.tsx"));
    expect(result).toEqual({ ok: true, componentId: id });
    expect(getComponent(id)).toBeUndefined();
  });

  it("rejects a banned module without importing/registering it", async () => {
    const result = await admitAuthoredSceneFile(fixture("banned-api.tsx"));
    expect(result.ok).toBe(false);
    expect(getComponent("authored-bad-api")).toBeUndefined();
  });
});

describe("authored boundary transition admission", () => {
  it("admits a clean transition with only a default export", async () => {
    const id = "scene-01-to-scene-02";
    unregisterTransition(id);
    expect(admitAuthoredTransition(fixture("clean-transition.tsx"))).toEqual({ admitted: true, transitionId: id });
    expect(await admitAuthoredTransitionFile(fixture("clean-transition.tsx"))).toEqual({ ok: true, transitionId: id });
    expect(getTransition(id)).toBeUndefined();
  });

  it("rejects banned APIs with N5", () => {
    const result = admitAuthoredTransition(fixture("banned-transition-api.tsx"));
    expect(result.admitted).toBe(false);
    if (!result.admitted) expect(result.violations.some((v) => v.check === "N5" && /Math\.random/.test(v.message))).toBe(true);
  });

  it("rejects a transition missing its default export", () => {
    const result = admitAuthoredTransition(fixture("missing-transition-default.tsx"));
    expect(result.admitted).toBe(false);
    if (!result.admitted) expect(result.violations.some((v) => /default/.test(v.message))).toBe(true);
  });

  it("rejects a non-literal registerTransition id", () => {
    const result = admitAuthoredTransition(fixture("no-literal-transition-id.tsx"));
    expect(result.admitted).toBe(false);
    if (!result.admitted) expect(result.violations.some((v) => /literal string id/.test(v.message))).toBe(true);
  });
});
