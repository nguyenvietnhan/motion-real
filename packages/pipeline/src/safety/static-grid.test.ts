import { describe, expect, it } from "vitest";
import "@news/compositions"; // register starter components (side effect)
import type { VideoSpec } from "@news/schema";
import { runStaticGrid } from "./static-grid.js";

/**
 * Non-vacuous self-tests for the Tier-1 static grid. Each check has:
 *  - a clean baseline that must NOT trigger it, and
 *  - a known-bad mutation that MUST trigger it.
 * (The math_video_tool rule: every oracle proves it actually fires.)
 */

// A 12-scene 60s spec using only registered components, written to pass all
// Tier-1 hard checks. Narrations are >= 20 words, no banned content.
function validSpec(): VideoSpec {
  const mid = (n: number) =>
    `Đây là một câu tường thuật đủ dài cho cảnh số ${n}, giải thích bối cảnh và hệ quả một cách tự nhiên cho người xem theo dõi liền mạch nhé.`;
  const scenes: VideoSpec["scenes"] = [];
  // scene-01 hero
  scenes.push({
    id: "scene-01",
    component: "hero-announcement",
    durationInSeconds: 5,
    eyebrow: "Tin nóng",
    headline: "Một sự thật ít ai để ý",
    body: "Mở đầu bằng một cảnh báo thẳng thắn.",
    narration:
      "Đừng vội tin vào những lời quảng cáo hào nhoáng, vì đằng sau con số đẹp luôn có một cái giá mà rất ít người chịu nói thẳng ra.",
    props: { badgeText: "Chủ đề", highlight: "Sự thật" },
    sfx: "transition",
  });
  // middle scenes alternate insight-stack and price-spotlight
  for (let i = 2; i <= 11; i += 1) {
    const isStack = i % 2 === 0;
    scenes.push({
      id: `scene-${String(i).padStart(2, "0")}`,
      component: isStack ? "insight-stack" : "price-spotlight",
      durationInSeconds: 5,
      headline: `Lớp thông tin số ${i}`,
      body: `Dòng phụ ngắn cho cảnh ${i}.`,
      narration: mid(i),
      props: isStack
        ? { steps: ["Điểm thứ nhất", "Điểm thứ hai", "Điểm thứ ba"] }
        : { value: "Bốn mươi", unit: "thành phần", note: "ngày càng nhiều" },
      sfx: "none",
    });
  }
  // final cta
  scenes.push({
    id: "scene-12",
    component: "final-cta",
    durationInSeconds: 5,
    eyebrow: "Đúc kết",
    headline: "Lựa chọn nằm ở bạn",
    body: "Một câu hỏi đánh đổi để khép lại.",
    narration:
      "Vậy giữa tốc độ và sự an toàn, bạn sẽ ưu tiên điều gì khi phải đưa ra quyết định quan trọng cho công việc sắp tới của mình đây.",
    props: { ctaText: "Cân nhắc đánh đổi", subText: "Bạn chọn tốc độ hay sự chắc chắn cho bước đi tiếp theo?" },
    sfx: "success",
  });

  return {
    version: 1,
    title: "Spec hợp lệ để kiểm thử",
    styleId: "clean-luxury-tech",
    duration: 60,
    ratio: "9:16",
    language: "vi",
    scenes,
  };
}

function checks(spec: VideoSpec): Set<string> {
  return new Set(runStaticGrid(spec).issues.map((i) => i.check));
}

describe("static grid — clean baseline", () => {
  it("passes the valid spec with no hard errors", () => {
    const report = runStaticGrid(validSpec());
    const errors = report.issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

describe("static grid — N1 structural", () => {
  it("fires when durations do not sum to the preset", () => {
    const spec = validSpec();
    spec.scenes[0]!.durationInSeconds = 99;
    expect(checks(spec).has("N1")).toBe(true);
    expect(runStaticGrid(spec).ok).toBe(false);
  });

  it("fires when scene count is below bounds", () => {
    const spec = validSpec();
    spec.scenes = spec.scenes.slice(0, 4);
    expect(checks(spec).has("N1")).toBe(true);
  });
});

describe("static grid — N2 unknown component", () => {
  it("fires on an unregistered component id", () => {
    const spec = validSpec();
    (spec.scenes[1] as { component: string }).component = "totally-made-up";
    const set = checks(spec);
    expect(set.has("N2")).toBe(true);
    expect(runStaticGrid(spec).ok).toBe(false);
  });
});

describe("static grid — N3 prop validation", () => {
  it("fires when a component's required props are missing/invalid", () => {
    const spec = validSpec();
    // price-spotlight requires `value`; remove it.
    spec.scenes[2]!.props = { unit: "thành phần" };
    const issues = runStaticGrid(spec).issues.filter((i) => i.check === "N3");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.sceneId).toBe("scene-03");
  });
});

describe("static grid — N6 phonetic / N7 spaced abbreviations", () => {
  it("fires on phonetic spelling in a display field", () => {
    const spec = validSpec();
    spec.scenes[3]!.headline = "Sức mạnh của Ô pân A I";
    const set = checks(spec);
    expect(set.has("N6") || set.has("N7")).toBe(true);
    expect(runStaticGrid(spec).ok).toBe(false);
  });

  it("fires on a spaced abbreviation in narration", () => {
    const spec = validSpec();
    spec.scenes[4]!.narration =
      "Công nghệ A I đang thay đổi cách chúng ta làm việc mỗi ngày và điều đó kéo theo rất nhiều hệ quả đáng suy ngẫm cho tương lai gần.";
    expect(checks(spec).has("N7")).toBe(true);
  });
});

describe("static grid — N8 number rules (warning)", () => {
  it("warns when narration contains display-style numbers", () => {
    const spec = validSpec();
    spec.scenes[5]!.narration =
      "Chi phí đã tăng tới 92% chỉ trong một quý và đó là con số khiến nhiều doanh nghiệp phải giật mình nhìn lại toàn bộ chiến lược của mình.";
    const issues = runStaticGrid(spec).issues.filter((i) => i.check === "N8");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
  });
});

describe("static grid — N9 media ban (hard)", () => {
  it("fires when props contain a forbidden media key", () => {
    const spec = validSpec();
    (spec.scenes[6]!.props as Record<string, unknown>).assetRef = "https://x/y.png";
    const set = checks(spec);
    expect(set.has("N9")).toBe(true);
    expect(runStaticGrid(spec).ok).toBe(false);
  });
});

describe("static grid — N26 weak hook (warning)", () => {
  it("warns when scene-01 opens with a greeting", () => {
    const spec = validSpec();
    spec.scenes[0]!.narration =
      "Xin chào các bạn, hôm nay chúng ta sẽ cùng nhau tìm hiểu một chủ đề rất thú vị và bổ ích cho công việc hằng ngày của mọi người.";
    const issues = runStaticGrid(spec).issues.filter((i) => i.check === "N26");
    expect(issues.length).toBe(1);
    expect(issues[0]!.severity).toBe("warning");
  });
});

describe("static grid — N27 generic CTA (warning)", () => {
  it("warns when the final scene asks to subscribe", () => {
    const spec = validSpec();
    spec.scenes.at(-1)!.narration =
      "Nếu thấy hữu ích thì hãy đăng ký kênh và like video để ủng hộ mình ra thêm nhiều nội dung chất lượng hơn trong những lần tới nhé.";
    const issues = runStaticGrid(spec).issues.filter((i) => i.check === "N27");
    expect(issues.length).toBe(1);
    expect(issues[0]!.severity).toBe("warning");
  });
});
