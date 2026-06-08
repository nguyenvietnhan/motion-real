import { describe, expect, it } from "vitest";
import {
  progressPercent,
  reduceDesktop,
  retryActionFor,
  type DesktopState,
  type OpenProject,
} from "./desktop-state.js";
import { stripL0Tokens } from "../../main/redact/friendly.js";
import { defaultSettings } from "../../shared/settings-model.js";

/**
 * Feature: web-dashboard, Task 11.3/11.4 — streaming-event reducer + view-model
 * safety. Events fold into DesktopState (progress %, growing Storyboard, status
 * badges, friendly errors with retry); only translated view-models appear.
 * (Req 5.2, 5.3, 5.5, 9.5, 9.7, 10.5, 11.5, 11.6)
 */

const openProject: OpenProject = {
  projectId: "p1",
  storyboard: { projectId: "p1", scenes: [], globalNotes: "" },
  draft: { hasReviewedDraft: false, revision: 0 },
};

function baseState(): DesktopState {
  return {
    license: { kind: "active", machineLocked: true, lastVerifiedAt: "2026-01-01T00:00:00Z" },
    gateway: { kind: "ready", baseUrl: "http://localhost:20128/v1" },
    aiAccount: { kind: "connected", accounts: [{ provider: "kiro", label: "me" }], selectedModel: { id: "kr/x", label: "x" } },
    settings: defaultSettings("/out"),
    gallery: { load: "populated", cards: [{ projectId: "p1", title: "T", thumbnailPath: null, status: "building", createdAtLabel: "ngày 1 tháng 1 năm 2026" }] },
    openProject,
  };
}

describe("reduceDesktop", () => {
  it("updates progress for the open project and maps to a percentage", () => {
    const s = reduceDesktop(baseState(), { type: "progress", event: { projectId: "p1", ratio: 0.42, phase: "draft" } });
    expect(s.openProject?.progress).toEqual({ ratio: 0.42, phase: "draft" });
    expect(progressPercent(s)).toBe(42);
  });

  it("ignores progress for a different project", () => {
    const s = reduceDesktop(baseState(), { type: "progress", event: { projectId: "other", ratio: 0.9, phase: "full" } });
    expect(s.openProject?.progress).toBeUndefined();
  });

  it("grows the Storyboard as scenes are produced, then updates in place", () => {
    let s = reduceDesktop(baseState(), { type: "scene", event: { projectId: "p1", sceneId: "scene-01", stillPath: "/a.png" } });
    s = reduceDesktop(s, { type: "scene", event: { projectId: "p1", sceneId: "scene-02", stillPath: "/b.png" } });
    expect(s.openProject?.storyboard.scenes.map((c) => c.sceneId)).toEqual(["scene-01", "scene-02"]);
    s = reduceDesktop(s, { type: "scene", event: { projectId: "p1", sceneId: "scene-01", stillPath: "/a2.png" } });
    expect(s.openProject?.storyboard.scenes).toHaveLength(2);
    expect(s.openProject?.storyboard.scenes[0]?.stillPath).toBe("/a2.png");
  });

  it("updates a status badge by project id", () => {
    const s = reduceDesktop(baseState(), { type: "status", event: { projectId: "p1", status: "draft-ready" } });
    expect(s.gallery.cards[0]?.status).toBe("draft-ready");
  });

  it("records a friendly error with its retry for the open project", () => {
    const s = reduceDesktop(baseState(), { type: "friendlyError", error: { projectId: "p1", message: "Gặp trục trặc khi dựng.", retry: "full" } });
    expect(s.openProject?.lastError?.retry).toBe("full");
    expect(retryActionFor(s.openProject!.lastError!)).toBe("full");
  });
});

describe("view-model safety (Task 11.4)", () => {
  it("a recorded friendly error never carries L0 tokens", () => {
    const s = reduceDesktop(baseState(), {
      type: "friendlyError",
      error: { projectId: "p1", message: "Một cảnh đã được chỉnh lại.", retry: "draft" },
    });
    const msg = s.openProject!.lastError!.message;
    expect(stripL0Tokens(msg)).toBe(msg); // already clean
    expect(msg).not.toMatch(/N\d|\.tsx|MCP/);
  });
});
