import { describe, expect, it, vi } from "vitest";
import {
  reduceDesktop,
  runSingleFlight,
  sameAiAccountState,
  sameGatewayState,
  sameModels,
  statusNeedsGalleryRefresh,
  type DesktopState,
} from "./desktop-state.js";
import { defaultSettings } from "../../shared/settings-model.js";

/**
 * Renderer reducer tests. The workspace flow is polled in App.tsx; the reducer
 * only folds streaming `status` events + gallery loads into the gallery
 * view-model. Pure + total.
 */

function baseState(): DesktopState {
  return {
    gateway: { kind: "ready", baseUrl: "http://localhost:20128/v1" },
    aiAccount: { kind: "connected", accounts: [{ provider: "kiro", label: "me" }], selectedModel: { id: "kr/x", label: "x" } },
    settings: defaultSettings("/out"),
    gallery: {
      load: "populated",
      cards: [{ projectId: "p1", title: "T", thumbnailPath: null, format: "tiktok", status: "building", createdAtLabel: "ngày 1 tháng 1 năm 2026" }],
    },
  };
}

describe("reduceDesktop", () => {
  it("updates a status badge by project id", () => {
    const s = reduceDesktop(baseState(), { type: "status", event: { projectId: "p1", status: "draft-ready" } });
    expect(s.gallery.cards[0]?.status).toBe("draft-ready");
  });

  it("leaves other projects' badges unchanged", () => {
    const before = baseState();
    const s = reduceDesktop(before, { type: "status", event: { projectId: "other", status: "done" } });
    expect(s.gallery.cards[0]?.status).toBe("building");
    expect(s).toBe(before);
  });

  it("preserves the state reference for an unchanged status or gallery snapshot", () => {
    const before = baseState();
    expect(reduceDesktop(before, { type: "status", event: { projectId: "p1", status: "building" } })).toBe(before);
    expect(reduceDesktop(before, {
      type: "gallery",
      load: before.gallery.load,
      cards: before.gallery.cards.map((card) => ({ ...card })),
    })).toBe(before);
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

describe("renderer snapshot equality", () => {
  it("coalesces overlapping refreshes and allows the next refresh after completion", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const run = vi.fn(() => gate);
    const ref: { current: Promise<void> | null } = { current: null };
    const first = runSingleFlight(ref, run);
    const second = runSingleFlight(ref, run);
    expect(second).toBe(first);
    expect(run).toHaveBeenCalledTimes(0);
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await first;
    await runSingleFlight(ref, run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("refreshes gallery metadata for unknown or non-building status events", () => {
    const cards = baseState().gallery.cards;
    expect(statusNeedsGalleryRefresh(cards, { projectId: "new", status: "building" })).toBe(true);
    expect(statusNeedsGalleryRefresh(cards, { projectId: "p1", status: "building" })).toBe(false);
    expect(statusNeedsGalleryRefresh(cards, { projectId: "p1", status: "done" })).toBe(true);
  });

  it("recognizes unchanged AI snapshots and rejects field changes", () => {
    expect(sameGatewayState({ kind: "ready", baseUrl: "http://ai" }, { kind: "ready", baseUrl: "http://ai" })).toBe(true);
    expect(sameGatewayState({ kind: "starting", attempt: 1 }, { kind: "starting", attempt: 2 })).toBe(false);
    expect(sameModels([{ id: "m1", label: "M" }], [{ id: "m1", label: "M" }])).toBe(true);
    expect(sameModels([{ id: "m1", label: "M" }], [{ id: "m2", label: "M" }])).toBe(false);
    const connected = { kind: "connected" as const, accounts: [{ provider: "p", label: "A", active: true }], selectedModel: { id: "m1", label: "M" } };
    expect(sameAiAccountState(connected, { ...connected, accounts: connected.accounts.map((account) => ({ ...account })) })).toBe(true);
    expect(sameAiAccountState(connected, { ...connected, accounts: [{ ...connected.accounts[0]!, active: false }] })).toBe(false);
  });
});
