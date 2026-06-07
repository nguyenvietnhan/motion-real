import { describe, expect, it, vi } from "vitest";
import { CreateController, type CreateBackend } from "./create-controller.js";
import type { AgentHooks, AgentWorker, AuthorOutcome } from "../agent/agent-worker.js";
import type { FriendlyError } from "../../shared/types.js";

/**
 * Feature: web-dashboard, Task 7.2 — create→scaffold single-registry wiring.
 * Create routes through `scaffold_project` (one backend/registry); validation
 * and scaffold failures never start authoring; an ingest/search failure surfaces
 * a friendly message and leaves authoring unstarted. (Req 3.6, 3.9, 3.10, 12.10)
 */

const noopHooks: AgentHooks = { onProgress() {}, onSceneProduced() {}, onRepair() {} };
const tick = () => new Promise((r) => setTimeout(r, 5));

function worker(outcome: AuthorOutcome): AgentWorker {
  return {
    author: vi.fn(async () => outcome),
    reauthorScenes: vi.fn(async (): Promise<AuthorOutcome> => ({ kind: "authored", sceneIds: [] })),
    generateValidateRepair: vi.fn(async () => ({ kind: "passed" as const, attempts: 1 })),
  };
}

describe("CreateController.start", () => {
  it("rejects an empty input with a friendly error and never scaffolds", async () => {
    const scaffold = vi.fn(async () => ({ ok: true as const, projectId: "p1" }));
    const backend: CreateBackend = { scaffold };
    const ctrl = new CreateController(backend, worker({ kind: "authored", sceneIds: [] }));
    const result = await ctrl.start({ raw: "   " }, noopHooks, () => {});
    expect(result).toEqual({ ok: false, error: { message: expect.any(String), retry: "create" } });
    expect(scaffold).not.toHaveBeenCalled();
  });

  it("scaffolds exactly once through the one backend and hands off to author", async () => {
    const scaffold = vi.fn(async () => ({ ok: true as const, projectId: "proj-7" }));
    const w = worker({ kind: "authored", sceneIds: ["scene-01"] });
    const ctrl = new CreateController({ scaffold }, w);

    const result = await ctrl.start({ raw: "tin công nghệ" }, noopHooks, () => {});
    expect(result).toEqual({ ok: true, projectId: "proj-7" });
    expect(scaffold).toHaveBeenCalledOnce();
    expect(scaffold).toHaveBeenCalledWith("tin công nghệ");
    await tick();
    expect(w.author).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-7", input: { kind: "topic", text: "tin công nghệ" } }),
      noopHooks,
    );
  });

  it("surfaces a scaffold failure as a friendly error and never authors", async () => {
    const w = worker({ kind: "authored", sceneIds: [] });
    const backend: CreateBackend = {
      scaffold: async () => ({ ok: false, error: { message: "[config] boom", stage: "config", cause: "boom", severity: "error" } }),
    };
    const ctrl = new CreateController(backend, w);
    const result = await ctrl.start({ raw: "abc" }, noopHooks, () => {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message.length).toBeGreaterThan(0);
    await tick();
    expect(w.author).not.toHaveBeenCalled();
  });

  it("surfaces an ingest failure via onError, leaving authoring unstarted", async () => {
    const errors: FriendlyError[] = [];
    const w = worker({ kind: "ingest-failed", message: "Không tải được trang." });
    const ctrl = new CreateController({ scaffold: async () => ({ ok: true, projectId: "p9" }) }, w);

    const result = await ctrl.start(
      { raw: "https://news.example.com/a" },
      noopHooks,
      (e) => errors.push(e),
    );
    expect(result).toEqual({ ok: true, projectId: "p9" });
    await tick();
    expect(errors).toEqual([{ projectId: "p9", message: "Không tải được trang.", retry: "create" }]);
  });
});
