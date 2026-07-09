import { describe, expect, it, vi } from "vitest";
import {
  getSafetyReportWithTools,
  renderDraftWithTools,
  renderStillsWithTools,
} from "./authoring-render-tools.js";

function fakeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  };
}

function baseDeps(tools: Record<string, unknown>) {
  return {
    tools: tools as never,
    loadManifest: vi.fn(async () => ({ scenes: [{ component: "alpha" }] })),
    unregisterComponent: vi.fn(),
    logger: fakeLogger(),
  };
}

describe("authoring render tools", () => {
  it("renderDraft returns engine error on failure", async () => {
    const deps = baseDeps({
      render_draft: vi.fn(async () => ({
        ok: false,
        error: { stage: "render", cause: "boom" },
      })),
    });
    const out = await renderDraftWithTools(deps, "p1");
    expect(out).toEqual({ ok: false, error: { stage: "render", cause: "boom" } });
    expect(deps.logger.error).toHaveBeenCalled();
  });

  it("renderStills returns empty array on failure", async () => {
    const deps = baseDeps({
      render_stills: vi.fn(async () => ({
        ok: false,
        error: { stage: "stills", cause: "nope" },
      })),
    });
    await expect(renderStillsWithTools(deps, "p1", ["scene-01"])).resolves.toEqual({ stills: [] });
  });

  it("getSafetyReport strips N24/N25 from hardErrors", async () => {
    const deps = {
      tools: {
        get_safety_report: vi.fn(async () => ({
          ok: true,
          data: {
            hardErrors: [
              { check: "N5", message: "bad" },
              { check: "N24", message: "review" },
              { check: "N25", message: "sheet" },
            ],
            warnings: [{ check: "N1", message: "warn" }],
          },
        })),
      } as never,
      logger: fakeLogger(),
    };
    const report = await getSafetyReportWithTools(deps, "p1");
    expect(report.ok).toBe(false);
    expect(report.hardErrors).toEqual([{ check: "N5", message: "bad" }]);
    expect(report.warnings).toEqual([{ check: "N1", message: "warn" }]);
  });

  it("getSafetyReport returns empty hardErrors when only N24/N25 present", async () => {
    const deps = {
      tools: {
        get_safety_report: vi.fn(async () => ({
          ok: true,
          data: {
            hardErrors: [{ check: "N24", message: "review" }],
            warnings: [],
          },
        })),
      } as never,
      logger: fakeLogger(),
    };
    const report = await getSafetyReportWithTools(deps, "p1");
    expect(report).toEqual({ ok: true, hardErrors: [], warnings: [] });
  });
});
