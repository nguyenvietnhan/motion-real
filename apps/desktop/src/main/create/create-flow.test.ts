import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { CreateController, type CreateDeps } from "./create-controller.js";
import type { AuthorInput } from "../agent/agent-worker.js";
import type { SerializedPipelineError } from "@news/pipeline";

/**
 * Feature: reconcile-main-controllers, S5 — create→scaffold→beginScript wiring.
 * Reproduces the inline Current_Behavior of index.ts `projects:create`: validate
 * → scaffold once through the single registry → hand off to the staged
 * workspace. Validation/scaffold failures throw and never start the workspace.
 * (R1.3, R2.1, R4.5, R4.6)
 */

function deps(over: Partial<CreateDeps> = {}): { deps: CreateDeps; scaffold: CreateDeps["scaffold"]; began: { id: string; input: AuthorInput }[] } {
  const began: { id: string; input: AuthorInput }[] = [];
  const scaffold: CreateDeps["scaffold"] =
    over.scaffold ?? vi.fn(async (_prompt: string) => ({ ok: true as const, projectId: "p1" }));
  const d: CreateDeps = {
    scaffold,
    beginScript: (id, input) => began.push({ id, input }),
    ...over,
  };
  return { deps: d, scaffold, began };
}

describe("CreateController.create", () => {
  it("scaffolds once with the prompt and hands a topic off to beginScript", async () => {
    const { deps: d, scaffold, began } = deps({
      scaffold: vi.fn(async () => ({ ok: true as const, projectId: "proj-7" })),
    });
    const ctrl = new CreateController(d);
    const result = await ctrl.create("tin công nghệ");
    expect(result).toEqual({ projectId: "proj-7" });
    expect(scaffold).toHaveBeenCalledOnce();
    expect(scaffold).toHaveBeenCalledWith("tin công nghệ");
    expect(began).toEqual([{ id: "proj-7", input: { kind: "topic", text: "tin công nghệ" } }]);
  });

  it("classifies a URL input and passes a url AuthorInput", async () => {
    const { deps: d, began } = deps();
    const ctrl = new CreateController(d);
    await ctrl.create("https://news.example.com/a");
    expect(began).toEqual([{ id: "p1", input: { kind: "url", url: "https://news.example.com/a" } }]);
  });

  it("throws a REDACTED friendly message on scaffold failure and never starts the workspace (R8.5)", async () => {
    const leaky: SerializedPipelineError = {
      message: "[render] N14 leaked from /proj/scene-01.tsx",
      stage: "render",
      cause: "N14 overflow in scene-01.tsx",
      severity: "error",
    };
    const { deps: d, began } = deps({ scaffold: vi.fn(async () => ({ ok: false as const, error: leaky })) });
    const ctrl = new CreateController(d);
    let message = "";
    try {
      await ctrl.create("abc");
    } catch (e) {
      message = (e as Error).message;
    }
    // No raw engine tokens leak (no N-code, no .tsx, no raw cause).
    expect(message).not.toMatch(/N14|\.tsx|overflow/);
    expect(message.length).toBeGreaterThan(0);
    expect(began).toEqual([]);
  });
});

// Property 10: Create invalid input throws reason and never scaffolds
describe("Property 10: create invalid input throws reason, no scaffold", () => {
  it("for any input invalid per validateCreateInput, create throws its reason and scaffold is not called", async () => {
    const invalidArb = fc.oneof(
      fc.constantFrom("", "   ", "\t\n"), // empty
      fc.constantFrom("http://nodot", "https://localhost"), // malformed-url
      fc.constant(`k${"x".repeat(20001)}`), // too-long topic
    );
    await fc.assert(
      fc.asyncProperty(invalidArb, async (raw) => {
        const { deps: d, scaffold } = deps();
        const ctrl = new CreateController(d);
        await expect(ctrl.create(raw)).rejects.toBeInstanceOf(Error);
        expect(scaffold).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});
