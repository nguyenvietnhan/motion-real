import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { approveEnabled, evaluateApprove, fullRenderAllowed } from "./approve-gate.js";

/**
 * Feature: web-dashboard, Property 9: Approve and full render are gated by a
 * reviewed draft (draft-first). Approve is enabled iff a reviewed Draft exists;
 * a full render with no reviewed draft and no force-full is refused with
 * `draft-first`, leaving the project unchanged. (Req 5.6, 9.1, 9.2, 9.4, 12.5)
 */

describe("Property 9: draft-first approve/full gate", () => {
  it("approveEnabled ⇔ a reviewed draft exists", () => {
    fc.assert(
      fc.property(fc.boolean(), (hasDraft) => {
        expect(approveEnabled(hasDraft)).toBe(hasDraft);
      }),
      { numRuns: 50 },
    );
  });

  it("full render allowed exactly when draft exists OR force-full", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (hasDraft, forceFull) => {
        expect(fullRenderAllowed(hasDraft, forceFull)).toBe(hasDraft || forceFull);
      }),
      { numRuns: 100 },
    );
  });

  it("evaluateApprove refuses draft-first exactly when no draft AND no force-full", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (hasDraft, forceFull) => {
        const result = evaluateApprove(hasDraft, forceFull);
        if (!hasDraft && !forceFull) {
          expect(result).toEqual({ ok: false, reason: "draft-first" });
        } else {
          expect(result).toEqual({ proceed: true });
        }
      }),
      { numRuns: 200 },
    );
  });
});
