import { describe, expect, it } from "vitest";
import {
  jobNotifyKindFromStatusTransition,
  jobNotifyPayload,
  shortProjectHint,
} from "./job-notify.js";

describe("jobNotifyKindFromStatusTransition", () => {
  it("notifies only on edge into done after a live prior status", () => {
    expect(jobNotifyKindFromStatusTransition("building", "done")).toBe("done");
    expect(jobNotifyKindFromStatusTransition("error", "done")).toBe("done");
    expect(jobNotifyKindFromStatusTransition("done", "done")).toBeNull();
    // Disk recovery / first stage seed must not toast.
    expect(jobNotifyKindFromStatusTransition(undefined, "done")).toBeNull();
  });

  it("notifies only on edge into error after a live prior status", () => {
    expect(jobNotifyKindFromStatusTransition("building", "error")).toBe("error");
    expect(jobNotifyKindFromStatusTransition("error", "error")).toBeNull();
    expect(jobNotifyKindFromStatusTransition(undefined, "error")).toBeNull();
    expect(jobNotifyKindFromStatusTransition("done", "building")).toBeNull();
  });

  it("ignores non-terminal statuses", () => {
    expect(jobNotifyKindFromStatusTransition(undefined, "building")).toBeNull();
    expect(jobNotifyKindFromStatusTransition("building", "draft-ready")).toBeNull();
  });
});

describe("jobNotifyPayload", () => {
  it("uses video title when done", () => {
    const p = jobNotifyPayload({ kind: "done", projectId: "test-abc", title: "  AI shortcuts  " });
    expect(p.kind).toBe("done");
    expect(p.title).toBe("Video đã xong");
    expect(p.body).toBe("AI shortcuts");
  });

  it("falls back to project hint when done without title", () => {
    const p = jobNotifyPayload({ kind: "done", projectId: "test-a7ef7cb9-long" });
    expect(p.body).toContain("test-a7e");
  });

  it("prefers friendly message on error", () => {
    const p = jobNotifyPayload({
      kind: "error",
      projectId: "p1",
      message: "Chưa tạo được ảnh xem trước.",
    });
    expect(p.title).toBe("Dựng video gặp lỗi");
    expect(p.body).toBe("Chưa tạo được ảnh xem trước.");
  });
});

describe("shortProjectHint", () => {
  it("keeps short ids intact", () => {
    expect(shortProjectHint("p1")).toBe("p1");
  });

  it("truncates long ids", () => {
    expect(shortProjectHint("test-a7ef7cb9-extra")).toBe("test-a7e…");
  });
});
