import { describe, expect, it } from "vitest";
import { reduceDesktop, type DesktopState } from "./desktop-state.js";
import { defaultSettings } from "../../shared/settings-model.js";

/**
 * Renderer reducer tests. The workspace flow is polled in App.tsx; the reducer
 * only folds streaming `status` events + gallery loads into the gallery
 * view-model. Pure + total.
 */

function baseState(): DesktopState {
  return {
    license: { kind: "active", machineLocked: true, lastVerifiedAt: "2026-01-01T00:00:00Z" },
    gateway: { kind: "ready", baseUrl: "http://localhost:20128/v1" },
    aiAccount: { kind: "connected", accounts: [{ provider: "kiro", label: "me" }], selectedModel: { id: "kr/x", label: "x" } },
    settings: defaultSettings("/out"),
    gallery: {
      load: "populated",
      cards: [{ projectId: "p1", title: "T", thumbnailPath: null, status: "building", createdAtLabel: "ngày 1 tháng 1 năm 2026" }],
    },
  };
}

describe("reduceDesktop", () => {
  it("updates a status badge by project id", () => {
    const s = reduceDesktop(baseState(), { type: "status", event: { projectId: "p1", status: "draft-ready" } });
    expect(s.gallery.cards[0]?.status).toBe("draft-ready");
  });

  it("leaves other projects' badges unchanged", () => {
    const s = reduceDesktop(baseState(), { type: "status", event: { projectId: "other", status: "done" } });
    expect(s.gallery.cards[0]?.status).toBe("building");
  });

  it("replaces the gallery on a load action", () => {
    const s = reduceDesktop(baseState(), { type: "gallery", load: "empty", cards: [] });
    expect(s.gallery).toEqual({ load: "empty", cards: [] });
  });

  it("folds an error load so a failed list() surfaces a recoverable state (audit P1-8)", () => {
    const s = reduceDesktop(baseState(), { type: "gallery", load: "error", cards: [] });
    expect(s.gallery).toEqual({ load: "error", cards: [] });
  });
});
