import { describe, expect, it } from "vitest";
import { parseDurationFromPrompt } from "./parse-duration.js";

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
    expect(parseDurationFromPrompt("100 giây")).toBe(90); // 100 → nearer 90 than 120
    expect(parseDurationFromPrompt("75 giây")).toBe(60); // 75 → nearer 60 than 90 (gap 15 vs 15 → first wins = 60)
    expect(parseDurationFromPrompt("2 phút 30 giây")).toBe(120); // 150 → nearer 120 than 180
  });

  it("returns undefined when no recognizable length is stated", () => {
    expect(parseDurationFromPrompt("Tóm tắt bài báo này")).toBeUndefined();
    expect(parseDurationFromPrompt("")).toBeUndefined();
    expect(parseDurationFromPrompt("https://example.com/a")).toBeUndefined();
  });
});
