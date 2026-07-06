import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { authorReplyParseSummary, inspectAuthorReply, parseAuthorModuleBatchReply, parseAuthorReply, parseReauthorReply } from "./reply-parser.js";
import { JSON_ONLY_AUTHOR_REPLY } from "./__fixtures__/authoring-failure-incidents.js";

/**
 * Property tests for the AI_Output_Contract parser (desktop-author-mode).
 * Generators build well-formed replies (manifest JSON + per-id ```tsx blocks)
 * and adversarial variants (missing a block, marker≠literal) to prove the parser
 * is total and correct.
 */

const HEAD = "abcdefghijklmnopqrstuvwxyz".split("");
const TAIL = "abcdefghijklmnopqrstuvwxyz0123456789-".split("");

/** A valid open component id: /^[a-z][a-z0-9-]{1,40}$/. */
const idArb = fc
  .tuple(fc.constantFrom(...HEAD), fc.array(fc.constantFrom(...TAIL), { minLength: 1, maxLength: 12 }))
  .map(([h, rest]) => h + rest.join(""));

// Manifest metadata is PROSE per the AI_Output_Contract — code (and thus the
// ``` fence delimiter) only ever appears in the separate ```tsx blocks. So the
// generator excludes backticks from manifest strings: a ``` embedded in metadata
// would be a contract violation that corrupts fence boundaries for the WHOLE
// reply. Everything else (quotes, braces, backslashes, unicode) stays adversarial.
const nonEmpty = (max: number) => fc.string({ minLength: 1, maxLength: max }).map((s) => s.replace(/`/g, "").trim() || "x");

/** A code block for one component id, with optional marker + override literal id. */
function codeBlock(id: string, opts: { marker?: string; literal?: string } = {}): string {
  const literal = opts.literal ?? id;
  const markerLine = opts.marker === undefined ? `// component: ${id}\n` : opts.marker ? `// component: ${opts.marker}\n` : "";
  return [
    "```tsx",
    `${markerLine}import React from "react";`,
    'import { registerComponent } from "@motionreal/compositions";',
    "export const schema = {};",
    "export const example = {};",
    `export default registerComponent({ id: "${literal}" });`,
    "```",
  ].join("\n");
}

function manifestBlock(ids: string[], scenes: { component: string; eyebrow: string; headline: string; narration: string }[]): string {
  const manifest = {
    title: "Tiêu đề video kiểm thử",
    theme: { dominant: "#1E9CB0", mood: "tông thử" },
    scenes,
  };
  void ids;
  return "```json\n" + JSON.stringify(manifest, null, 2) + "\n```";
}

/** Generate a coherent (ids, scenes) pair: 3–14 scenes drawn from a unique id pool. */
const replyShapeArb = fc
  .uniqueArray(idArb, { minLength: 1, maxLength: 6 })
  .chain((ids) =>
    fc
      .array(
        fc.record({
          component: fc.constantFrom(...ids),
          eyebrow: nonEmpty(20),
          headline: nonEmpty(80),
          narration: nonEmpty(200),
        }),
        { minLength: 3, maxLength: 14 },
      )
      .map((scenes) => ({ ids, scenes })),
  );

describe("Property 1: author-reply parse roundtrip", () => {
  // Feature: desktop-author-mode, Property 1: author-reply parse roundtrip
  it("valid manifest + full code coverage ⇒ ok and modules cover every used id", () => {
    fc.assert(
      fc.property(replyShapeArb, ({ ids, scenes }) => {
        const usedIds = [...new Set(scenes.map((s) => s.component))];
        const reply =
          manifestBlock(ids, scenes) + "\n\n" + usedIds.map((id) => codeBlock(id)).join("\n\n");
        const parsed = parseAuthorReply(reply);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
          expect(new Set(parsed.modules.map((m) => m.id))).toEqual(new Set(usedIds));
        }
      }),
      { numRuns: 200 },
    );
  });

  it("dropping a used scene's code block ⇒ missing-code", () => {
    fc.assert(
      fc.property(replyShapeArb, ({ ids, scenes }) => {
        const usedIds = [...new Set(scenes.map((s) => s.component))];
        const dropped = usedIds[0]!;
        // A decoy block for an id NOT in the manifest keeps the code-fence set
        // non-empty, so the failure is specifically "missing-code" (the dropped
        // used id) rather than "no-code" (zero blocks).
        const blocks = [
          codeBlock("zz-decoy-block"),
          ...usedIds.filter((id) => id !== dropped).map((id) => codeBlock(id)),
        ];
        const reply = manifestBlock(ids, scenes) + "\n\n" + blocks.join("\n\n");
        const parsed = parseAuthorReply(reply);
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) expect(parsed.reason).toBe("missing-code");
      }),
      { numRuns: 200 },
    );
  });

  it("extracts the manifest when a prose string contains braces and a stray backtick (string-aware scan)", () => {
    // Not a ``` fence — just metadata prose with `{`, `}` and one backtick — which
    // the string-aware object scan must skip without derailing extraction.
    const scenes = [
      { component: "a-scene", eyebrow: "TIN", headline: "Giá `tăng` {2026}", narration: "Mức { tăng } khoảng 30% theo `báo cáo`." },
      { component: "a-scene", eyebrow: "TIN", headline: "Hai", narration: "Bình thường" },
      { component: "a-scene", eyebrow: "TIN", headline: "Ba", narration: "Bình thường" },
    ];
    const reply = manifestBlock(["a-scene"], scenes) + "\n\n" + codeBlock("a-scene");
    const parsed = parseAuthorReply(reply);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.modules.map((m) => m.id)).toEqual(["a-scene"]);
  });

  it("a marker that disagrees with the registerComponent literal ⇒ id-mismatch", () => {
    fc.assert(
      fc.property(replyShapeArb, ({ ids, scenes }) => {
        const usedIds = [...new Set(scenes.map((s) => s.component))];
        const target = usedIds[0]!;
        const blocks = usedIds.map((id) =>
          id === target ? codeBlock(id, { marker: `${id}-different` }) : codeBlock(id),
        );
        const reply = manifestBlock(ids, scenes) + "\n\n" + blocks.join("\n\n");
        const parsed = parseAuthorReply(reply);
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) expect(parsed.reason).toBe("id-mismatch");
      }),
      { numRuns: 200 },
    );
  });
});

describe("incident fixtures", () => {
  it("JSON-only author reply with a valid manifest is still no-code", () => {
    const inspected = inspectAuthorReply(JSON_ONLY_AUTHOR_REPLY);
    const parsed = parseAuthorReply(JSON_ONLY_AUTHOR_REPLY);

    expect(inspected.manifest.ok).toBe(true);
    if (inspected.manifest.ok) {
      expect(inspected.manifest.sceneCount).toBe(3);
      expect(inspected.manifest.componentIds).toEqual(["scene-01", "scene-02", "scene-03"]);
    }
    expect(inspected.codeBlockCount).toBe(0);
    expect(inspected.validModuleIds).toEqual([]);
    expect(inspected.missingComponentIds).toEqual(["scene-01", "scene-02", "scene-03"]);
    expect(inspected.complete).toBe(false);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("no-code");
      expect(parsed.detail).toMatch(/tsx/i);
    }
  });

  it("inspection exposes a valid manifest plus only the missing component ids", () => {
    const scenes = [
      { component: "alpha", eyebrow: "A", headline: "One", narration: "First narration." },
      { component: "beta", eyebrow: "B", headline: "Two", narration: "Second narration." },
      { component: "gamma", eyebrow: "C", headline: "Three", narration: "Third narration." },
    ];
    const reply = manifestBlock(["alpha", "beta", "gamma"], scenes) + "\n\n" + codeBlock("alpha") + "\n\n" + codeBlock("gamma");

    const inspected = inspectAuthorReply(reply);
    const parsed = parseAuthorReply(reply);

    expect(inspected.manifest.ok).toBe(true);
    expect(inspected.validModuleIds).toEqual(["alpha", "gamma"]);
    expect(inspected.missingComponentIds).toEqual(["beta"]);
    expect(inspected.idMismatchDetails).toEqual([]);
    expect(inspected.complete).toBe(false);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("missing-code");
  });

  it("inspection marks a complete reply without changing strict parse success", () => {
    const scenes = [
      { component: "alpha", eyebrow: "A", headline: "One", narration: "First narration." },
      { component: "beta", eyebrow: "B", headline: "Two", narration: "Second narration." },
      { component: "alpha", eyebrow: "C", headline: "Three", narration: "Third narration." },
    ];
    const reply = manifestBlock(["alpha", "beta"], scenes) + "\n\n" + codeBlock("alpha") + "\n\n" + codeBlock("beta");

    const inspected = inspectAuthorReply(reply);
    const parsed = parseAuthorReply(reply);

    expect(inspected.manifest.ok).toBe(true);
    expect(inspected.codeBlockCount).toBe(2);
    expect(inspected.validModuleIds).toEqual(["alpha", "beta"]);
    expect(inspected.missingComponentIds).toEqual([]);
    expect(inspected.complete).toBe(true);
    expect(parsed.ok).toBe(true);
  });

  it("inspection reports id mismatch details while strict parse still fails", () => {
    const scenes = [
      { component: "alpha", eyebrow: "A", headline: "One", narration: "First narration." },
      { component: "beta", eyebrow: "B", headline: "Two", narration: "Second narration." },
      { component: "alpha", eyebrow: "C", headline: "Three", narration: "Third narration." },
    ];
    const reply = manifestBlock(["alpha", "beta"], scenes) + "\n\n" + codeBlock("alpha", { marker: "beta" }) + "\n\n" + codeBlock("beta");

    const inspected = inspectAuthorReply(reply);
    const parsed = parseAuthorReply(reply);

    expect(inspected.idMismatchDetails.join(" ")).toContain("beta");
    expect(inspected.missingComponentIds).toEqual(["alpha"]);
    expect(inspected.complete).toBe(false);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("id-mismatch");
  });

  it("builds a compact parse summary from the same inspection facts", () => {
    const summary = authorReplyParseSummary(JSON_ONLY_AUTHOR_REPLY, { recoveryAttempted: true });

    expect(summary).toEqual({
      manifestFound: true,
      manifestValid: true,
      sceneCount: 3,
      tsxModuleCount: 0,
      missingComponentIdsCount: 3,
      idMismatchCount: 0,
      complete: false,
      recoveryAttempted: true,
    });
  });
});

describe("parseAuthorModuleBatchReply", () => {
  it("accepts only the expected TSX modules and returns them in expected order", () => {
    const parsed = parseAuthorModuleBatchReply(codeBlock("gamma") + "\n\n" + codeBlock("beta"), ["beta", "gamma"]);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.modules.map((module) => module.id)).toEqual(["beta", "gamma"]);
    }
  });

  it("fails when a batch omits an expected id", () => {
    const parsed = parseAuthorModuleBatchReply(codeBlock("beta"), ["beta", "gamma"]);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("missing-code");
      expect(parsed.detail).toContain("gamma");
    }
  });

  it("fails when a batch returns a component outside the requested ids", () => {
    const parsed = parseAuthorModuleBatchReply(codeBlock("beta") + "\n\n" + codeBlock("outside"), ["beta"]);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("id-mismatch");
      expect(parsed.detail).toContain("outside");
    }
  });

  it("fails on marker/registerComponent mismatch inside a batch", () => {
    const parsed = parseAuthorModuleBatchReply(codeBlock("beta", { marker: "gamma" }), ["beta"]);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("id-mismatch");
  });
});

describe("sceneId manifest recovery", () => {
  function sceneIdReply(codeIds: string[] = ["scene-01", "scene-02", "scene-03"]): string {
    const manifest = {
      title: "Random Forest dễ hiểu",
      theme: { dominant: "#10b981", mood: "giải thích trực quan" },
      scenes: [
        { sceneId: "scene-01", eyebrow: "KHÁI NIỆM", headline: "Một khu rừng biết bỏ phiếu", narration: "Random Forest là nhiều cây quyết định cùng dự đoán." },
        { sceneId: "scene-02", eyebrow: "CÁCH LÀM", headline: "Mỗi cây nhìn một lát cắt", narration: "Mỗi cây học trên một mẫu dữ liệu và nhóm đặc trưng khác nhau." },
        { sceneId: "scene-03", eyebrow: "KẾT QUẢ", headline: "Đa số thắng", narration: "Kết quả cuối cùng đến từ bỏ phiếu hoặc lấy trung bình." },
      ],
    };
    return "```json\n" + JSON.stringify(manifest) + "\n```\n\n" + codeIds.map((id) => codeBlock(id)).join("\n\n");
  }

  it("recovers scenes that used content-plan sceneId instead of manifest component when matching modules exist", () => {
    const parsed = parseAuthorReply(sceneIdReply());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.manifest.scenes.map((scene) => scene.component)).toEqual(["scene-01", "scene-02", "scene-03"]);
      expect(parsed.modules.map((module) => module.id)).toEqual(["scene-01", "scene-02", "scene-03"]);
    }
  });

  it("does not invent component ids from sceneId without matching authored code", () => {
    const parsed = parseAuthorReply(sceneIdReply(["other-scene"]));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("manifest-invalid");
  });
});

describe("robust manifest coercion (one bad field no longer nukes the whole reply)", () => {
  // The bug this guards: a single over-cap or out-of-enum field in ONE scene made
  // the strict schema fail safeParse, discarding the manifest + every authored
  // .tsx (up to 14 scenes) and forcing a full re-author. Clamp/coerce keeps them.
  function rawReply(scenes: unknown[]): string {
    const manifest = { title: "Tiêu đề kiểm thử", theme: { dominant: "#1E9CB0", mood: "tông" }, scenes };
    return (
      "```json\n" + JSON.stringify(manifest) + "\n```\n\n" + codeBlock("a-scene")
    );
  }

  it("an out-of-enum transitionToNext is coerced to undefined, not rejected", () => {
    const scenes = [
      { component: "a-scene", eyebrow: "TIN", headline: "Một", narration: "Câu một.", transitionToNext: "dissolve" },
      { component: "a-scene", eyebrow: "TIN", headline: "Hai", narration: "Câu hai." },
      { component: "a-scene", eyebrow: "TIN", headline: "Ba", narration: "Câu ba." },
    ];
    const parsed = parseAuthorReply(rawReply(scenes));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.manifest.scenes[0]!.transitionToNext).toBeUndefined();
  });

  it("an over-cap narration/eyebrow/headline is clamped to its limit, not rejected", () => {
    const scenes = [
      {
        component: "a-scene",
        eyebrow: "X".repeat(40), // cap 24
        headline: "H".repeat(200), // cap 120
        narration: "N".repeat(900), // cap 600
      },
      { component: "a-scene", eyebrow: "TIN", headline: "Hai", narration: "Câu hai." },
      { component: "a-scene", eyebrow: "TIN", headline: "Ba", narration: "Câu ba." },
    ];
    const parsed = parseAuthorReply(rawReply(scenes));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const s0 = parsed.manifest.scenes[0]!;
      expect(s0.eyebrow.length).toBe(24);
      expect(s0.headline.length).toBe(120);
      expect(s0.narration.length).toBe(600);
    }
  });

  it("still rejects a genuinely empty required field (missing content, not overshoot)", () => {
    const scenes = [
      { component: "a-scene", eyebrow: "", headline: "Một", narration: "Câu một." },
      { component: "a-scene", eyebrow: "TIN", headline: "Hai", narration: "Câu hai." },
      { component: "a-scene", eyebrow: "TIN", headline: "Ba", narration: "Câu ba." },
    ];
    const parsed = parseAuthorReply(rawReply(scenes));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("manifest-invalid");
  });

  it("coerces a bare-string image into { ref }, not rejected (the model's natural shape)", () => {
    // The bug this guards: the model writes "image": "assets/x.png" instead of
    // { "ref": "..." }; the strict object schema failed safeParse and discarded
    // the whole reply (24k chars, 14 scenes) — twice, on a real run.
    const scenes = [
      { component: "a-scene", eyebrow: "TIN", headline: "Một", narration: "Câu một.", image: "assets/aa.png" },
      { component: "a-scene", eyebrow: "TIN", headline: "Hai", narration: "Câu hai." },
      { component: "a-scene", eyebrow: "TIN", headline: "Ba", narration: "Câu ba." },
    ];
    const parsed = parseAuthorReply(rawReply(scenes));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.manifest.scenes[0]!.image).toEqual({ ref: "assets/aa.png" });
  });

  it("coerces an image object using a url/src alias key into { ref }", () => {
    const scenes = [
      { component: "a-scene", eyebrow: "TIN", headline: "Một", narration: "Câu một.", image: { url: "assets/bb.webp", alt: "mô tả" } },
      { component: "a-scene", eyebrow: "TIN", headline: "Hai", narration: "Câu hai." },
      { component: "a-scene", eyebrow: "TIN", headline: "Ba", narration: "Câu ba." },
    ];
    const parsed = parseAuthorReply(rawReply(scenes));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.manifest.scenes[0]!.image).toEqual({ ref: "assets/bb.webp", alt: "mô tả" });
  });

  it("a still-malformed image degrades to undefined (drops the field, keeps the reply)", () => {
    const scenes = [
      { component: "a-scene", eyebrow: "TIN", headline: "Một", narration: "Câu một.", image: { caption: "no path key here" } },
      { component: "a-scene", eyebrow: "TIN", headline: "Hai", narration: "Câu hai." },
      { component: "a-scene", eyebrow: "TIN", headline: "Ba", narration: "Câu ba." },
    ];
    const parsed = parseAuthorReply(rawReply(scenes));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.manifest.scenes[0]!.image).toBeUndefined();
  });
});

describe("Property 2: reauthor single-module", () => {
  it("exactly one block whose literal === expectId ⇒ ok; else ⇒ !ok", () => {
    fc.assert(
      fc.property(idArb, idArb, (a, b) => {
        const expectId = a;
        const other = a === b ? `${b}x` : b;

        // one matching block ⇒ ok
        const okReply = codeBlock(expectId);
        const okParsed = parseReauthorReply(okReply, expectId);
        expect(okParsed.ok).toBe(true);
        if (okParsed.ok) expect(okParsed.module.id).toBe(expectId);

        // wrong id ⇒ id-mismatch
        const wrong = parseReauthorReply(codeBlock(other), expectId);
        expect(wrong.ok).toBe(false);

        // zero blocks ⇒ no-code
        const none = parseReauthorReply("không có code ở đây", expectId);
        expect(none.ok).toBe(false);
        if (!none.ok) expect(none.reason).toBe("no-code");

        // two blocks ⇒ id-mismatch (need exactly one)
        const two = parseReauthorReply(codeBlock(expectId) + "\n\n" + codeBlock(other), expectId);
        expect(two.ok).toBe(false);
        if (!two.ok) expect(two.reason).toBe("id-mismatch");
      }),
      { numRuns: 200 },
    );
  });
});

describe("truncated reply recovery (unclosed final fence) — freeform-engine R3.3", () => {
  // Regression: a reauthor reply cut mid-code-block (provider token cap, gateway
  // stitching couldn't close it) had an opening ```tsx with NO closing ```. The
  // closed-fence regex saw zero blocks → "no-code" → the reauthor SILENTLY kept
  // the old scene (the `scene-03` symptom in the wild). The recovery treats the
  // remainder-to-EOF after the last complete fence as a final (truncated) block.

  /** A code block deliberately MISSING its closing ``` (truncated mid-output). */
  function unclosedBlock(id: string, opts: { afterRegister?: string } = {}): string {
    return [
      "```tsx",
      `// component: ${id}`,
      'import React from "react";',
      'import { registerComponent } from "@motionreal/compositions";',
      "export const schema = {};",
      "export const example = {};",
      `export default registerComponent({ id: "${id}" });`,
      // a long trailing SVG fn the model was mid-writing when cut — no closing fence
      opts.afterRegister ?? "function Glyph(){ return <svg><path d=\"M0 0 L10",
    ].join("\n");
  }

  it("recovers a reauthor module whose registerComponent survived the cut", () => {
    const parsed = parseReauthorReply(unclosedBlock("scene-03-vis"), "scene-03-vis");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.module.id).toBe("scene-03-vis");
  });

  it("recovers the trailing truncated scene in a full author reply", () => {
    const scenes = [
      { component: "a-scene", eyebrow: "TIN", headline: "Một", narration: "Câu một đủ dài." },
      { component: "b-scene", eyebrow: "TIN", headline: "Hai", narration: "Câu hai đủ dài." },
      { component: "b-scene", eyebrow: "TIN", headline: "Ba", narration: "Câu ba đủ dài." },
    ];
    // a-scene closed normally; b-scene is the final block, truncated mid-output.
    const reply =
      manifestBlock(["a-scene", "b-scene"], scenes) + "\n\n" + codeBlock("a-scene") + "\n\n" + unclosedBlock("b-scene");
    const parsed = parseAuthorReply(reply);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(new Set(parsed.modules.map((m) => m.id))).toEqual(new Set(["a-scene", "b-scene"]));
  });

  it("still fails (keeps the prior scene) when the cut lands BEFORE registerComponent", () => {
    // Truncated so early there is no registerComponent literal to recover — the
    // caller's filter drops it; reauthor correctly reports no-code (never accepts
    // half a module, never silently regresses past the prior good scene).
    const early = ["```tsx", "// component: scene-03-vis", 'import React from "react";', "export const sch"].join("\n");
    const parsed = parseReauthorReply(early, "scene-03-vis");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("no-code");
  });
});

describe("bare (un-fenced) module recovery — the scene-13 symptom", () => {
  // Regression: a reauthor reply emitted the raw authored code straight, starting
  // `// component: <id>` with NO ```tsx fence at all. extractFences saw zero blocks
  // (the unclosed-fence recovery only fires when an OPENING ``` exists), so the
  // reply parsed as "no-code" and the scene silently kept its old code. The bare-
  // module fallback recovers a module that carries its registerComponent literal,
  // while still rejecting a fragment cut before that literal.

  /** A full authored module WITHOUT any code fence (raw, marker-led). */
  function bareModule(id: string, opts: { afterRegister?: string } = {}): string {
    return [
      `// component: ${id}`,
      'import React from "react";',
      'import { registerComponent } from "@motionreal/compositions";',
      "export const schema = {};",
      "export const example = {};",
      `export default registerComponent({ id: "${id}" });`,
      opts.afterRegister ?? "",
    ].join("\n");
  }

  it("recovers a reauthor module returned with no fence at all", () => {
    const parsed = parseReauthorReply(bareModule("scene-13-loss"), "scene-13-loss");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.module.id).toBe("scene-13-loss");
  });

  it("recovers an un-fenced trailing scene in a full author reply", () => {
    const scenes = [
      { component: "a-scene", eyebrow: "TIN", headline: "Một", narration: "Câu một đủ dài." },
      { component: "b-scene", eyebrow: "TIN", headline: "Hai", narration: "Câu hai đủ dài." },
      { component: "b-scene", eyebrow: "TIN", headline: "Ba", narration: "Câu ba đủ dài." },
    ];
    // The model emitted both modules WITHOUT fences, straight after the manifest.
    const reply = manifestBlock(["a-scene", "b-scene"], scenes) + "\n\n" + bareModule("a-scene") + "\n" + bareModule("b-scene");
    const parsed = parseAuthorReply(reply);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(new Set(parsed.modules.map((m) => m.id))).toEqual(new Set(["a-scene", "b-scene"]));
  });

  it("still rejects a bare fragment cut BEFORE registerComponent (never accepts half a module)", () => {
    const early = ["// component: scene-13-loss", 'import React from "react";', "export const sch"].join("\n");
    const parsed = parseReauthorReply(early, "scene-13-loss");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("no-code");
  });

  it("does NOT use the bare path when a proper fence is present (fence wins)", () => {
    // A normal fenced reply must be unaffected: even with a stray `// component:`
    // line elsewhere, the fenced block is what's parsed.
    const parsed = parseReauthorReply(codeBlock("scene-13-loss"), "scene-13-loss");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.module.id).toBe("scene-13-loss");
  });
});
