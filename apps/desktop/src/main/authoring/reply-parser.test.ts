import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseAuthorReply, parseReauthorReply } from "./reply-parser.js";

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

const nonEmpty = (max: number) => fc.string({ minLength: 1, maxLength: max }).map((s) => s.trim() || "x");

/** A code block for one component id, with optional marker + override literal id. */
function codeBlock(id: string, opts: { marker?: string; literal?: string } = {}): string {
  const literal = opts.literal ?? id;
  const markerLine = opts.marker === undefined ? `// component: ${id}\n` : opts.marker ? `// component: ${opts.marker}\n` : "";
  return [
    "```tsx",
    `${markerLine}import React from "react";`,
    'import { registerComponent } from "@news/compositions";',
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

describe("Property 2: reauthor single-module", () => {
  // Feature: desktop-author-mode, Property 2: reauthor single-module
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
