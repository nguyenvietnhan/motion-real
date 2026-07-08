import { describe, expect, it } from "vitest";
import {
  AUTHOR_BATCH_SIZE,
  AUTHOR_BATCH_THRESHOLD,
  MAX_BATCHED_COMPONENTS,
  planAuthorBatching,
} from "./author-batch-policy.js";

const sceneIds = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `scene-${String(index + 1).padStart(2, "0")}`);

describe("planAuthorBatching", () => {
  it("keeps short plans on the single-reply path", () => {
    expect(planAuthorBatching({ sceneIds: sceneIds(AUTHOR_BATCH_THRESHOLD), imageCount: 0 })).toEqual({
      mode: "single",
      componentIds: sceneIds(AUTHOR_BATCH_THRESHOLD),
      reason: "short-plan",
    });
  });

  it("keeps image-assisted plans on the single-reply path", () => {
    const ids = sceneIds(AUTHOR_BATCH_THRESHOLD + 1);
    expect(planAuthorBatching({ sceneIds: ids, imageCount: 1 })).toEqual({
      mode: "single",
      componentIds: ids,
      reason: "user-images",
    });
  });

  it("batches long no-image plans into fixed small groups", () => {
    const ids = sceneIds(AUTHOR_BATCH_THRESHOLD + 1);
    const result = planAuthorBatching({ sceneIds: ids, imageCount: 0 });
    expect(result.mode).toBe("batched");
    if (result.mode !== "batched") throw new Error("expected batched decision");
    expect(result.componentIds).toEqual(ids);
    expect(result.batches.every((batch) => batch.length <= AUTHOR_BATCH_SIZE)).toBe(true);
    expect(result.batches.flat()).toEqual(ids);
  });

  it("rejects plans beyond the batch safety budget", () => {
    const ids = sceneIds(MAX_BATCHED_COMPONENTS + 1);
    expect(planAuthorBatching({ sceneIds: ids, imageCount: 0 })).toEqual({
      mode: "too-large",
      componentIds: ids,
    });
  });

  it("deduplicates scene ids before choosing the path", () => {
    expect(planAuthorBatching({ sceneIds: ["scene-01", "scene-01", "scene-02"], imageCount: 0 })).toEqual({
      mode: "single",
      componentIds: ["scene-01", "scene-02"],
      reason: "short-plan",
    });
  });
});
