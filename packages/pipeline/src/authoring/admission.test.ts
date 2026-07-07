import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { getComponent, unregisterComponent } from "@motionreal/compositions";
import { admitAuthoredComponent, admitAuthoredSceneFile } from "./index.js";

/**
 * AI AUTHOR admission-gate self-tests (Requirement 13). Non-vacuous: a clean
 * authored module is admitted without host import/registration, while
 * each policy violation class — banned import (N4), banned/crash-prone construct
 * (N5), missing required export (N4), and a non-literal registerComponent id
 * (N4) — is rejected with the matching violation. The bad modules are NEVER
 * imported (admission is a pure static gate), proving banned code never executes
 * in the host.
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

  it("rejects whitelisted package subpath imports (N4)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "motionreal-admission-subpath-"));
    try {
      const template = (importLine: string, id: string) => `
import React from "react";
${importLine}
import { registerComponent } from "@motionreal/compositions";
import { z } from "zod";
export const schema = z.object({});
export const example = {};
const Comp: React.FC = () => <div>ok</div>;
export default registerComponent({
  id: "${id}",
  displayName: "Test",
  promptGuide: "Test",
  schema,
  Component: Comp,
  example,
});
`;
      const cases = [
        {
          file: "theme-context.tsx",
          id: "authored-subpath-theme-context",
          importLine: 'import { ThemeProvider } from "@motionreal/compositions/theme-context";',
          spec: "@motionreal/compositions/theme-context",
        },
        {
          file: "scene-image-subpath.tsx",
          id: "authored-subpath-scene-image",
          importLine: 'import { SceneImage } from "@motionreal/compositions/scene-image";',
          spec: "@motionreal/compositions/scene-image",
        },
      ];

      for (const c of cases) {
        const path = join(dir, c.file);
        await writeFile(path, template(c.importLine, c.id));
        const result = admitAuthoredComponent(path);
        expect(result.admitted).toBe(false);
        if (!result.admitted) {
          expect(result.violations.some((v) => v.check === "N4" && v.message.includes(c.spec))).toBe(true);
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a banned API (N5: Math.random)", () => {
    const result = admitAuthoredComponent(fixture("banned-api.tsx"));
    expect(result.admitted).toBe(false);
    if (!result.admitted) {
      expect(result.violations.some((v) => v.check === "N5" && /Math\.random/.test(v.message))).toBe(true);
    }
  });

  it("rejects literal interpolate input ranges that are not strictly increasing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "motionreal-admission-interpolate-"));
    try {
      const template = (range: string, outputRange: string, id: string) => `
import React from "react";
import { interpolate } from "remotion";
import { registerComponent } from "@motionreal/compositions";
import { z } from "zod";
export const schema = z.object({});
export const example = {};
const Comp: React.FC = () => {
  const progress = 0.5;
  const x = interpolate(progress, ${range}, ${outputRange}, { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <div style={{ opacity: x }}>ok</div>;
};
export default registerComponent({
  id: "${id}",
  displayName: "Test",
  promptGuide: "Test",
  schema,
  Component: Comp,
  example,
});
`;
      const invalid = join(dir, "invalid.tsx");
      await writeFile(invalid, template("[340, 360, 60]", "[0, 1, 0]", "authored-invalid-interpolate"));
      const invalidResult = admitAuthoredComponent(invalid);
      expect(invalidResult.admitted).toBe(false);
      if (!invalidResult.admitted) {
        expect(invalidResult.violations.some((v) => v.check === "N5" && /strictly increasing/.test(v.message))).toBe(true);
      }

      const negative = join(dir, "negative.tsx");
      await writeFile(negative, template("[0, -18]", "[0, 1]", "authored-negative-interpolate"));
      const negativeResult = admitAuthoredComponent(negative);
      expect(negativeResult.admitted).toBe(false);
      if (!negativeResult.admitted) {
        expect(negativeResult.violations.some((v) => v.check === "N5" && /\[0, -18\]|strictly increasing/.test(v.message))).toBe(true);
      }

      const valid = join(dir, "valid.tsx");
      await writeFile(valid, template("[0, 0.5, 1]", "[0, 1, 0]", "authored-valid-interpolate"));
      const validResult = admitAuthoredComponent(valid);
      expect(validResult.admitted).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
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

  it("allows safe SVG namespaces exactly, but rejects prefix bypass and protocol-relative URLs with host dot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "news-admission-"));
    try {
      const template = (literal: string) => `
import React from "react";
import { registerComponent } from "@motionreal/compositions";
import { z } from "zod";
export const schema = z.object({});
export const example = {};
const Comp = () => <div className="${literal}" />;
export default registerComponent({
  id: "authored-test-comp",
  displayName: "Test",
  promptGuide: "Test",
  schema,
  Component: Comp,
  example,
});
`;
      // 1. Safe namespace (exact match) -> should PASS
      const p1 = join(dir, "p1.tsx");
      await writeFile(p1, template("http://www.w3.org/2000/svg"));
      expect(admitAuthoredComponent(p1).admitted).toBe(true);

      // 2. Prefix bypass -> should FAIL
      const p2 = join(dir, "p2.tsx");
      await writeFile(p2, template("http://www-w3-org.proxy.ustclug.org/2000/svg.evil.com"));
      const r2 = admitAuthoredComponent(p2);
      expect(r2.admitted).toBe(false);
      if (!r2.admitted) {
        expect(r2.violations.some((v) => v.check === "N5" && /remote\/file URL literal/.test(v.message))).toBe(true);
      }

      // 3. Comment-like string without dot (e.g. //TODO) -> should PASS
      const p3 = join(dir, "p3.tsx");
      await writeFile(p3, template("//TODO"));
      expect(admitAuthoredComponent(p3).admitted).toBe(true);

      // 4. Protocol-relative URL with dot -> should FAIL
      const p4 = join(dir, "p4.tsx");
      await writeFile(p4, template("//google.com"));
      const r4 = admitAuthoredComponent(p4);
      expect(r4.admitted).toBe(false);
      if (!r4.admitted) {
        expect(r4.violations.some((v) => v.check === "N5" && /remote\/file URL literal/.test(v.message))).toBe(true);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
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
