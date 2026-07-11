import { describe, expect, it } from "vitest";
import {
  nearestDurationTier,
  parseDurationFromPrompt,
  parseDurationSecondsFromPrompt,
  resolveEffectiveDuration,
} from "./parse-duration.js";

/**
 * The desktop create flow hands the orchestrator only the raw prompt, so the
 * user's stated length must be recovered from the text — otherwise every project
 * silently defaulted to a 60s target (the bug behind "1p30s rendered as 1p").
 */
describe("parseDurationFromPrompt", () => {
  it("reads 'm phút n giây' style and snaps to the nearest preset", () => {
    expect(parseDurationFromPrompt("Làm video 1p30s về chủ đề X")).toBe(90);
    expect(parseDurationFromPrompt("Làm 1 phút 30 giây")).toBe(90);
    expect(parseDurationFromPrompt("1p30")).toBe(90);
  });

  it("reads 'rưỡi' (a-half) as minutes + 30s", () => {
    expect(parseDurationFromPrompt("video 1 phút rưỡi")).toBe(90);
    expect(parseDurationFromPrompt("1p rưỡi")).toBe(90);
  });

  it("reads minutes-only and seconds-only forms", () => {
    expect(parseDurationFromPrompt("video 2 phút")).toBe(120);
    expect(parseDurationFromPrompt("làm 2p thôi")).toBe(120);
    expect(parseDurationFromPrompt("90 giây")).toBe(90);
    expect(parseDurationFromPrompt("60s")).toBe(60);
    expect(parseDurationFromPrompt("3 phút")).toBe(180);
  });

  it("snaps an off-preset length to the closest preset", () => {
    expect(parseDurationFromPrompt("100 giây")).toBe(90);
    expect(parseDurationFromPrompt("75 giây")).toBe(60);
    expect(parseDurationFromPrompt("2 phút 30 giây")).toBe(120);
  });

  it("returns undefined when no recognizable length is stated", () => {
    expect(parseDurationFromPrompt("Tóm tắt bài báo này")).toBeUndefined();
    expect(parseDurationFromPrompt("")).toBeUndefined();
    expect(parseDurationFromPrompt("https://example.com/a")).toBeUndefined();
  });
});

describe("parseDurationSecondsFromPrompt", () => {
  it("keeps exact short lengths (no snap to 60)", () => {
    expect(parseDurationSecondsFromPrompt("Tạo video 15 giây app thời tiết")).toBe(15);
    expect(parseDurationSecondsFromPrompt("20s mockup")).toBe(20);
  });
});

describe("resolveEffectiveDuration", () => {
  it("lets UI tier win over a conflicting prompt length", () => {
    const r = resolveEffectiveDuration({
      prompt: "Tạo video 15 giây app thời tiết",
      durationTier: 2,
      format: "tiktok",
    });
    expect(r.targetSeconds).toBe(90);
    expect(r.source).toBe("tier");
    expect(r.conflict).toEqual({ promptSeconds: 15, tierSeconds: 90 });
    expect(r.durationTier).toBe(2);
  });

  it("honors tier 4 (3:30) when selected", () => {
    const r = resolveEffectiveDuration({
      prompt: "video ngắn thôi",
      durationTier: 4,
      format: "tiktok",
    });
    expect(r.targetSeconds).toBe(210);
    expect(r.source).toBe("tier");
    expect(r.durationTier).toBe(4);
  });

  it("uses UI tier when prompt has no duration", () => {
    const r = resolveEffectiveDuration({
      prompt: "Giới thiệu app quản lý công việc",
      durationTier: 2,
      format: "tiktok",
    });
    expect(r.targetSeconds).toBe(90);
    expect(r.source).toBe("tier");
    expect(r.conflict).toBeUndefined();
  });

  it("falls back to prompt only when no tier is set", () => {
    const r = resolveEffectiveDuration({
      prompt: "video khoảng 90 giây về AI",
      format: "tiktok",
    });
    expect(r.targetSeconds).toBe(90);
    expect(r.source).toBe("prompt");
  });
});

describe("nearestDurationTier", () => {
  it("maps free seconds onto 1/2/3/4 labels", () => {
    expect(nearestDurationTier(15)).toBe(1);
    expect(nearestDurationTier(45)).toBe(1);
    expect(nearestDurationTier(90)).toBe(2);
    expect(nearestDurationTier(150)).toBe(3);
    expect(nearestDurationTier(210)).toBe(4);
  });
});
