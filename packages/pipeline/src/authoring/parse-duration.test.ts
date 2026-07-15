import { describe, expect, it } from "vitest";
import {
  nearestDurationTier,
  parseDurationSecondsFromPrompt,
  resolveEffectiveDuration,
} from "./parse-duration.js";

describe("parseDurationSecondsFromPrompt", () => {
  it("reads compound and half forms", () => {
    expect(parseDurationSecondsFromPrompt("Làm video 1p30s về chủ đề X")).toBe(90);
    expect(parseDurationSecondsFromPrompt("1 phút 30 giây")).toBe(90);
    expect(parseDurationSecondsFromPrompt("video 1 phút rưỡi")).toBe(90);
  });

  it("reads minutes-only and seconds-only forms", () => {
    expect(parseDurationSecondsFromPrompt("video 2 phút")).toBe(120);
    expect(parseDurationSecondsFromPrompt("90 giây")).toBe(90);
    expect(parseDurationSecondsFromPrompt("15 giây")).toBe(15);
  });

  it("returns undefined when no recognizable length is stated", () => {
    expect(parseDurationSecondsFromPrompt("Tóm tắt bài báo này")).toBeUndefined();
    expect(parseDurationSecondsFromPrompt("")).toBeUndefined();
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
