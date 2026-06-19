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
    beginCreate: (id, input) => began.push({ id, input }),
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
    expect(began).toEqual([{ id: "proj-7", input: { text: "tin công nghệ", urls: [] } }]);
  });

  it("passes a brief carrying the link found in the input", async () => {
    const { deps: d, began } = deps();
    const ctrl = new CreateController(d);
    await ctrl.create("https://news.example.com/a");
    expect(began).toEqual([{ id: "p1", input: { text: "https://news.example.com/a", urls: ["https://news.example.com/a"] } }]);
  });

  it("promotes staged images and threads the resulting refs into the author input (Phase 2 Block A)", async () => {
    const promoteImages = vi.fn(async () => [{ ref: "assets/aa.png", width: 800, height: 600 }]);
    const { deps: d, began } = deps({ promoteImages });
    const ctrl = new CreateController(d);
    await ctrl.create("chủ đề", [{ ref: "staging/aa.png", width: 800, height: 600 }]);
    expect(promoteImages).toHaveBeenCalledWith("p1", [{ ref: "staging/aa.png", width: 800, height: 600 }]);
    expect(began[0]!.input.images).toEqual([{ ref: "assets/aa.png", width: 800, height: 600 }]);
  });

  it("with no images, the author input omits the images field entirely (no regression)", async () => {
    const { deps: d, began } = deps();
    const ctrl = new CreateController(d);
    await ctrl.create("chủ đề");
    expect(began[0]!.input.images).toBeUndefined();
  });

  it("a promote failure never blocks create — the brief still authors text-only", async () => {
    const promoteImages = vi.fn(async () => {
      throw new Error("disk full");
    });
    const { deps: d, began } = deps({ promoteImages });
    const ctrl = new CreateController(d);
    const result = await ctrl.create("chủ đề", [{ ref: "staging/aa.png", width: 10, height: 10 }]);
    expect(result).toEqual({ projectId: "p1" });
    expect(began[0]!.input.images).toBeUndefined();
  });

  it("threads the chosen delivery knobs (format/tier/titleLanguage) into the author input (create-screen picker)", async () => {
    const { deps: d, began } = deps();
    const ctrl = new CreateController(d);
    await ctrl.create("chủ đề", [], { format: "youtube", durationTier: 2, titleLanguage: "en" });
    expect(began[0]!.input.format).toBe("youtube");
    expect(began[0]!.input.durationTier).toBe(2);
    expect(began[0]!.input.titleLanguage).toBe("en");
  });

  it("with no delivery knobs chosen, the author input omits them (backend falls back to tiktok/tier 1/vi)", async () => {
    const { deps: d, began } = deps();
    const ctrl = new CreateController(d);
    await ctrl.create("chủ đề");
    expect(began[0]!.input.format).toBeUndefined();
    expect(began[0]!.input.durationTier).toBeUndefined();
    expect(began[0]!.input.titleLanguage).toBeUndefined();
  });

  it("a failing preflight blocks create BEFORE scaffold (its message is thrown, workspace never starts)", async () => {
    const { deps: d, scaffold, began } = deps({
      preflight: () => "Chưa cấu hình API key giọng đọc. Mở Cài đặt để thêm rồi thử lại.",
    });
    const ctrl = new CreateController(d);
    await expect(ctrl.create("chủ đề")).rejects.toThrow(/giọng đọc/);
    expect(scaffold).not.toHaveBeenCalled();
    expect(began).toEqual([]);
  });

  it("a clean (no-message) preflight proceeds exactly as before", async () => {
    const preflight = vi.fn(() => undefined);
    const { deps: d, began } = deps({ preflight });
    const ctrl = new CreateController(d);
    const result = await ctrl.create("chủ đề");
    expect(preflight).toHaveBeenCalledOnce();
    expect(result).toEqual({ projectId: "p1" });
    expect(began).toHaveLength(1);
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

// Create invalid input throws reason and never scaffolds
describe("create invalid input throws reason, no scaffold", () => {
  it("for any input invalid per validateCreateInput (empty / too-long), create throws and scaffold is not called", async () => {
    const invalidArb = fc.oneof(
      fc.constantFrom("", "   ", "\t\n"), // empty
      fc.constant(`k${"x".repeat(20001)}`), // too-long
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
