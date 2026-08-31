import { describe, expect, it } from "vitest";
import { buildHarnessAuthoringPacing, validateHarnessManifestPacing } from "./harness-authoring-pacing.js";

function scene(id: string, words: number) {
  const index = Number(id.slice(-2));
  return {
    id,
    component: id,
    headline: id,
    narration: Array.from({ length: words }, () => "từ").join(" "),
    transitionToNext: index % 2 === 0 ? "fade" : "slide",
  };
}

describe("Harness authoring pacing", () => {
  it("derives a 90-second VieNeu contract independently from the asset count", () => {
    const pacing = buildHarnessAuthoringPacing(2, "vi", 3.5);
    expect(pacing).toMatchObject({
      duration_tier: 2,
      target_seconds: 90,
      target_narration_words: 315,
      min_narration_words: 268,
      min_scenes: 10,
      target_scenes: 11,
      max_scenes: 12,
    });
  });

  it("rejects the observed five-scene, 165-word shape for a 90-second request", () => {
    const pacing = buildHarnessAuthoringPacing(2, "vi", 3.5);
    const scenes = Array.from({ length: 5 }, (_, index) => scene(`scene-0${index + 1}`, 33));
    const result = validateHarnessManifestPacing(
      { durationTier: 1, videoLanguage: "vi", scenes },
      scenes.map((value) => value.id),
      pacing,
      "vi",
    );
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/10-12 cảnh.*165 từ/s);
  });

  it("accepts an in-budget manifest and enforces the approved delivery metadata", () => {
    const pacing = buildHarnessAuthoringPacing(2, "vi", 3.5);
    const scenes = Array.from({ length: 10 }, (_, index) => scene(`scene-${String(index + 1).padStart(2, "0")}`, 28));
    const result = validateHarnessManifestPacing(
      { durationTier: 1, videoLanguage: "en", scenes },
      scenes.map((value) => value.id),
      pacing,
      "vi",
    );
    expect(result).toMatchObject({
      ok: true,
      narrationWords: 280,
      manifest: { durationTier: 2, videoLanguage: "vi", format: "tiktok" },
    });
  });

  it("rejects a partial or reordered submission", () => {
    const pacing = buildHarnessAuthoringPacing(1, "vi", 1);
    const scenes = [scene("scene-01", 15), scene("scene-02", 15), scene("scene-03", 15)];
    const result = validateHarnessManifestPacing(
      { scenes },
      ["scene-02", "scene-01", "scene-03"],
      pacing,
      "vi",
    );
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.errors).toContain("scene_ids đã submit phải khớp đúng thứ tự mọi scene trong manifest.");
  });

  it("rejects a descriptive timeline id before still rendering", () => {
    const pacing = buildHarnessAuthoringPacing(1, "vi", 1);
    const scenes = [scene("scene-01-hook", 15), scene("scene-02", 15), scene("scene-03", 15)];
    const result = validateHarnessManifestPacing({ scenes }, scenes.map((value) => value.id), pacing, "vi");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/scene id không hợp lệ; phải là scene-01/);
  });

  it("requires an explicit transition between scenes", () => {
    const pacing = buildHarnessAuthoringPacing(1, "vi", 1);
    const scenes = Array.from({ length: 4 }, (_, index) => ({
      ...scene(`scene-0${index + 1}`, 12),
      transitionToNext: index === 1 ? undefined : "slide",
    }));
    const result = validateHarnessManifestPacing({ scenes }, scenes.map((value) => value.id), pacing, "vi");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/scene-02 phải khai báo transitionToNext/);
  });

  it("restores omitted narration from the approved content plan and normalizes transition objects", () => {
    const pacing = buildHarnessAuthoringPacing(1, "vi", 1);
    const ids = ["scene-01", "scene-02", "scene-03"];
    const narration = Array.from({ length: 15 }, () => "từ").join(" ");
    const scenes = ids.map((id, index) => ({
      id,
      component: id,
      headline: id,
      ...(index < ids.length - 1 ? { transitionToNext: { type: "fade", durationInFrames: 12 } } : {}),
    }));
    const result = validateHarnessManifestPacing(
      { scenes },
      ids,
      pacing,
      "vi",
      { scenes: ids.map((sceneId) => ({ sceneId, narration })) },
    );

    expect(result).toMatchObject({ ok: true, narrationWords: 45 });
    if (result.ok) {
      const normalized = result.manifest.scenes as Array<Record<string, unknown>>;
      expect(normalized.map((value) => value.narration)).toEqual([narration, narration, narration]);
      expect(normalized[0]!.transitionToNext).toBe("fade");
      expect(normalized[1]!.transitionToNext).toBe("fade");
    }
  });

  it("drops model-authored beats and injects the canonical content-plan beats", () => {
    const pacing = buildHarnessAuthoringPacing(1, "vi", 1);
    const ids = ["scene-01", "scene-02", "scene-03"];
    const narration = "Đầu tiên nhận yêu cầu rồi cuối cùng trả kết quả hoàn chỉnh cho người dùng ngay hôm nay";
    const canonical = [
      { id: "receive", anchor: "nhận yêu cầu rồi", action: "Reveal input" },
      { id: "return", anchor: "trả kết quả hoàn chỉnh", action: "Reveal output" },
    ];
    const scenes = ids.map((id, index) => ({
      ...scene(id, 15),
      motionBeats: [{ id: "invented", anchor: "model tự ghi", action: "Ignore this" }],
      ...(index === ids.length - 1 ? { transitionToNext: undefined } : {}),
    }));
    const result = validateHarnessManifestPacing(
      { scenes },
      ids,
      pacing,
      "vi",
      { scenes: ids.map((sceneId) => ({ sceneId, narration, ...(sceneId === "scene-02" ? { motionBeats: canonical } : {}) })) },
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      const normalized = result.manifest.scenes as Array<Record<string, unknown>>;
      expect(normalized[0]!.motionBeats).toBeUndefined();
      expect(normalized[1]!.motionBeats).toEqual(canonical);
    }
  });

  it("rejects a content plan whose scene order differs from the manifest", () => {
    const pacing = buildHarnessAuthoringPacing(1, "vi", 1);
    const scenes = [scene("scene-01", 15), scene("scene-02", 15), scene("scene-03", 15)];
    const result = validateHarnessManifestPacing(
      { scenes },
      scenes.map((value) => value.id),
      pacing,
      "vi",
      { scenes: [scenes[1]!, scenes[0]!, scenes[2]!].map((value) => ({ sceneId: value.id, narration: value.narration })) },
    );
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.errors.join(" ")).toContain("khớp đúng thứ tự scene của content plan");
  });

  it("still rejects missing narration when no approved content plan exists", () => {
    const pacing = buildHarnessAuthoringPacing(1, "vi", 1);
    const scenes = ["scene-01", "scene-02", "scene-03"].map((id, index) => ({
      id,
      component: id,
      headline: id,
      ...(index === 0 ? { transitionToNext: "fade" } : {}),
    }));
    const result = validateHarnessManifestPacing({ scenes }, scenes.map((value) => value.id), pacing, "vi");
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.errors.join(" ")).toMatch(/scene-01 thiếu narration/);
      expect(result.errors.join(" ")).toMatch(/scene-02 phải khai báo transitionToNext/);
    }
  });
});
