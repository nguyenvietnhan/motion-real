import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { CreateController, type CreateDeps } from "./create-controller.js";
import type { AuthorInput } from "../agent/agent-worker.js";
import type { SerializedPipelineError } from "@motionreal/pipeline";

/**
 * Create→scaffold→beginScript wiring for `projects:create`: validate → scaffold
 * once through the single registry → hand off to the staged workspace.
 * Validation/scaffold failures throw and never start the workspace.
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
    expect(scaffold).toHaveBeenCalledWith("tin công nghệ", "vivibe", "vi", {
      format: "tiktok",
      durationTier: 1,
      targetSeconds: 45,
      creationMode: "classic",
    });
    expect(began).toEqual([
      {
        id: "proj-7",
        input: {
          text: "tin công nghệ",
          urls: [],
          format: "tiktok",
          durationTier: 1,
          targetSeconds: 45,
          videoLanguage: "vi",
        },
      },
    ]);
  });

  it("passes a brief carrying the link found in the input", async () => {
    const { deps: d, began } = deps();
    const ctrl = new CreateController(d);
    await ctrl.create("https://news.example.com/a");
    expect(began).toEqual([
      {
        id: "p1",
        input: {
          text: "https://news.example.com/a",
          urls: ["https://news.example.com/a"],
          format: "tiktok",
          durationTier: 1,
          targetSeconds: 45,
          videoLanguage: "vi",
        },
      },
    ]);
  });

  it("promotes staged images and threads the resulting refs into the author input (create-time image staging)", async () => {
    const promoteImages = vi.fn(async () => [{ ref: "assets/aa.png", width: 800, height: 600 }]);
    const { deps: d, began } = deps({ promoteImages });
    const ctrl = new CreateController(d);
    await ctrl.create("chủ đề", [{ ref: "staging/aa.png", width: 800, height: 600 }]);
    expect(promoteImages).toHaveBeenCalledWith("p1", [{ ref: "staging/aa.png", width: 800, height: 600 }]);
    expect(began[0]!.input.images).toEqual([{ ref: "assets/aa.png", width: 800, height: 600 }]);
  });

  it("persists Agent project ownership after promotion and before authoring starts", async () => {
    const order: string[] = [];
    const { deps: d } = deps({
      promoteImages: async () => { order.push("promote"); return []; },
      beginCreate: () => { order.push("begin"); },
    });
    const ctrl = new CreateController(d);
    await ctrl.create("chủ đề", [{ ref: "staging/aa.png", width: 10, height: 10 }], {
      beforeBeginCreate: async (projectId) => {
        expect(projectId).toBe("p1");
        order.push("link");
      },
    });
    expect(order).toEqual(["promote", "link", "begin"]);
  });

  it("scaffolds Harness projects without entering the classic authoring backend", async () => {
    const order: string[] = [];
    const { deps: d, scaffold } = deps({
      promoteImages: async () => { order.push("promote"); return []; },
      beginCreate: () => { order.push("classic-author"); },
    });
    const ctrl = new CreateController(d);
    await ctrl.create("chủ đề", [{ ref: "staging/aa.png", width: 10, height: 10 }], {
      creationMode: "harness",
      beforeBeginCreate: async () => { order.push("link"); },
    });
    expect(scaffold).toHaveBeenCalledWith("chủ đề", "vivibe", "vi", expect.objectContaining({
      creationMode: "harness",
    }));
    expect(order).toEqual(["promote", "link"]);
  });

  it("does not start authoring when Agent project ownership cannot be persisted", async () => {
    const { deps: d, began } = deps();
    const ctrl = new CreateController(d);
    await expect(ctrl.create("chủ đề", [], {
      beforeBeginCreate: async () => { throw new Error("link failed"); },
    })).rejects.toThrow("link failed");
    expect(began).toEqual([]);
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

  it("threads short-form delivery + videoLanguage into the author input", async () => {
    const { deps: d, scaffold, began } = deps();
    const ctrl = new CreateController(d);
    await ctrl.create("chủ đề", [], { videoLanguage: "en", voiceProvider: "elevenlabs", durationTier: 2 });
    expect(scaffold).toHaveBeenCalledWith("chủ đề", "elevenlabs", "en", {
      format: "tiktok",
      durationTier: 2,
      targetSeconds: 90,
      creationMode: "classic",
    });
    expect(began[0]!.input.format).toBe("tiktok");
    expect(began[0]!.input.durationTier).toBe(2);
    expect(began[0]!.input.targetSeconds).toBe(90);
    expect(began[0]!.input.videoLanguage).toBe("en");
  });

  it("defaults duration tier to 1 when omitted", async () => {
    const { deps: d, scaffold, began } = deps();
    const ctrl = new CreateController(d);
    await ctrl.create("chủ đề", [], { videoLanguage: "vi", voiceProvider: "vivibe" });
    expect(scaffold).toHaveBeenCalledWith("chủ đề", "vivibe", "vi", {
      format: "tiktok",
      durationTier: 1,
      targetSeconds: 45,
      creationMode: "classic",
    });
    expect(began[0]!.input.durationTier).toBe(1);
    expect(began[0]!.input.targetSeconds).toBe(45);
  });

  it("lets UI tier win over conflicting prompt seconds for pacing", async () => {
    const { deps: d, scaffold, began } = deps();
    const ctrl = new CreateController(d);
    await ctrl.create("Tạo video 15 giây app thời tiết", [], { durationTier: 2 });
    expect(scaffold).toHaveBeenCalledWith(
      "Tạo video 15 giây app thời tiết",
      "vivibe",
      "vi",
      expect.objectContaining({ targetSeconds: 90, durationTier: 2 }),
    );
    expect(began[0]!.input.targetSeconds).toBe(90);
    expect(began[0]!.input.durationTier).toBe(2);
  });

  it("supports tier 4 (3:30)", async () => {
    const { deps: d, scaffold, began } = deps();
    const ctrl = new CreateController(d);
    await ctrl.create("chủ đề dài", [], { durationTier: 4 });
    expect(scaffold).toHaveBeenCalledWith(
      "chủ đề dài",
      "vivibe",
      "vi",
      expect.objectContaining({ targetSeconds: 210, durationTier: 4 }),
    );
    expect(began[0]!.input.durationTier).toBe(4);
    expect(began[0]!.input.targetSeconds).toBe(210);
  });

  it("captures the selected voice provider during scaffold", async () => {
    const scaffold = vi.fn(async () => ({ ok: true as const, projectId: "p-eleven" }));
    const ctrl = new CreateController({ scaffold, beginCreate: vi.fn() });
    await ctrl.create("chủ đề", [], { voiceProvider: "elevenlabs" });
    expect(scaffold).toHaveBeenCalledWith("chủ đề", "elevenlabs", "vi", {
      format: "tiktok",
      durationTier: 1,
      targetSeconds: 45,
      creationMode: "classic",
    });
  });

  it("defaults the authored video language to Vietnamese with fixed short-form delivery", async () => {
    const { deps: d, began } = deps();
    const ctrl = new CreateController(d);
    await ctrl.create("chủ đề");
    expect(began[0]!.input.format).toBe("tiktok");
    expect(began[0]!.input.durationTier).toBe(1);
    expect(began[0]!.input.videoLanguage).toBe("vi");
  });

  it("blocks Vivibe + English before scaffold", async () => {
    const { deps: d, scaffold, began } = deps();
    const ctrl = new CreateController(d);
    await expect(ctrl.create("topic", [], { videoLanguage: "en", voiceProvider: "vivibe" }))
      .rejects.toThrow(/Vivibe.*tiếng Việt|ElevenLabs/i);
    expect(scaffold).not.toHaveBeenCalled();
    expect(began).toEqual([]);
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
    expect(preflight).toHaveBeenCalledWith("vivibe", "vi");
    expect(result).toEqual({ projectId: "p1" });
    expect(began).toHaveLength(1);
  });

  it("throws a REDACTED friendly message on scaffold failure and never starts the workspace", async () => {
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
    // No raw engine tokens leak (no N-code, no.tsx, no raw cause).
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
