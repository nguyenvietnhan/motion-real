import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { getComponent, registerComponent } from "@news/compositions";
import { listStylePackIds } from "@news/design";
import type { VideoSpec } from "@news/schema";
import { runStaticGrid } from "./static-grid.js";

/**
 * Non-vacuous self-tests for the Tier-1 static grid. Each check has a clean
 * baseline that must NOT trigger it and a known-bad mutation that MUST trigger
 * it. Pure AUTHOR mode: the registry ships no built-ins, so we register a tiny
 * test component (`test-scene`, requiring a `value` prop) to exercise N2/N3.
 */

const TEST_SCENE = "test-scene";

beforeAll(() => {
  if (!getComponent(TEST_SCENE)) {
    registerComponent({
      id: TEST_SCENE,
      displayName: "Test Scene",
      promptGuide: "test only",
      schema: z.object({ value: z.string().min(1) }),
      Component: () => null,
      example: { value: "demo" },
    });
  }
});

// A 12-scene spec using the registered test component, written to pass all
// Tier-1 hard checks (free pacing: scene count + durations are unconstrained).
function validSpec(): VideoSpec {
  const mid = (n: number) =>
    `Đây là một câu tường thuật đủ dài cho cảnh số ${n}, giải thích bối cảnh và hệ quả một cách tự nhiên cho người xem theo dõi liền mạch nhé.`;
  const scenes: VideoSpec["scenes"] = [];
  scenes.push({
    id: "scene-01",
    component: TEST_SCENE,
    durationInSeconds: 5,
    eyebrow: "Tin nóng",
    headline: "Một sự thật ít ai để ý",
    body: "Mở đầu bằng một cảnh báo thẳng thắn.",
    narration:
      "Đừng vội tin vào những lời quảng cáo hào nhoáng, vì đằng sau con số đẹp luôn có một cái giá mà rất ít người chịu nói thẳng ra.",
    props: { value: "Sự thật" },
    sfx: "transition",
  });
  for (let i = 2; i <= 11; i += 1) {
    scenes.push({
      id: `scene-${String(i).padStart(2, "0")}`,
      component: TEST_SCENE,
      durationInSeconds: 5,
      headline: `Lớp thông tin số ${i}`,
      body: `Dòng phụ ngắn cho cảnh ${i}.`,
      narration: mid(i),
      props: { value: `Lớp ${i}` },
      sfx: "none",
    });
  }
  scenes.push({
    id: "scene-12",
    component: TEST_SCENE,
    durationInSeconds: 5,
    eyebrow: "Đúc kết",
    headline: "Lựa chọn nằm ở bạn",
    body: "Một câu hỏi đánh đổi để khép lại.",
    narration:
      "Vậy giữa tốc độ và sự an toàn, bạn sẽ ưu tiên điều gì khi phải đưa ra quyết định quan trọng cho công việc sắp tới của mình đây.",
    props: { value: "Đánh đổi" },
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
  it("fires when a scene id is out of sequence", () => {
    const spec = validSpec();
    spec.scenes[1]!.id = "scene-99";
    expect(checks(spec).has("N1")).toBe(true);
    expect(runStaticGrid(spec).ok).toBe(false);
  });

  it("fires when narration is multiline (not one paragraph)", () => {
    const spec = validSpec();
    spec.scenes[2]!.narration = "Dòng một của cảnh này.\nDòng hai của cảnh này.";
    expect(checks(spec).has("N1")).toBe(true);
    expect(runStaticGrid(spec).ok).toBe(false);
  });

  it("does NOT fire on free scene count / duration (free pacing)", () => {
    const spec = validSpec();
    spec.scenes = spec.scenes.slice(0, 4);
    spec.scenes[0]!.durationInSeconds = 99;
    const errors = runStaticGrid(spec).issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });

  it("treats an over-long headline as a warning, not a render-blocking error", () => {
    const spec = validSpec();
    spec.scenes[0]!.headline = "Một tiêu đề dài hơn mười từ để chắc chắn vượt ngưỡng quá rõ ràng";
    const report = runStaticGrid(spec);
    const headline = report.issues.find((i) => /words; keep/.test(i.message));
    expect(headline?.severity).toBe("warning");
    // A cosmetic headline-length warning must NOT hard-block the render.
    expect(report.issues.filter((i) => i.severity === "error")).toEqual([]);
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
    spec.scenes[2]!.props = {}; // test-scene requires `value`
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
  it("does NOT warn on digits/years/% in narration (the TTS layer reads them, hướng B)", () => {
    const spec = validSpec();
    spec.scenes[5]!.narration =
      "Chi phí đã tăng tới 92% trong năm 2026 và đó là con số khiến nhiều doanh nghiệp phải giật mình nhìn lại toàn bộ chiến lược của mình.";
    const issues = runStaticGrid(spec).issues.filter((i) => i.check === "N8");
    expect(issues.length).toBe(0);
  });

  it("warns when narration uses an un-voiceable form ($ or 1.5M)", () => {
    const spec = validSpec();
    spec.scenes[5]!.narration =
      "Khoản đầu tư lên tới 1.5B đô la đã được rót vào hạ tầng chỉ trong một quý khiến cả ngành công nghệ phải chú ý theo dõi sát sao.";
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

  it("does NOT ban a caption-related prop key (captions are now a feature)", () => {
    const spec = validSpec();
    (spec.scenes[6]!.props as Record<string, unknown>).captionStyle = "bold";
    expect(runStaticGrid(spec).issues.some((i) => i.check === "N9")).toBe(false);
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

describe("static grid — N1 unknown style pack (hard)", () => {
  it("fires a hard error when theme.stylePackId is not registered", () => {
    const spec = validSpec();
    spec.theme = { dominant: "#2F5FF0", stylePackId: "totally-made-up-pack" };
    const issues = runStaticGrid(spec).issues.filter((i) => /stylePackId/i.test(i.message));
    expect(issues.length).toBe(1);
    expect(issues[0]!.severity).toBe("error");
    expect(runStaticGrid(spec).ok).toBe(false);
  });

  it("accepts a registered style pack and the default (no id)", () => {
    const withPack = validSpec();
    withPack.theme = { dominant: "#2F5FF0", stylePackId: "clean-premium" };
    expect(runStaticGrid(withPack).issues.some((i) => /stylePackId/i.test(i.message))).toBe(false);

    const noPack = validSpec();
    expect(runStaticGrid(noPack).issues.some((i) => /stylePackId/i.test(i.message))).toBe(false);
  });

  it("every registered style pack passes the static grid with no hard error (2.14)", () => {
    for (const id of listStylePackIds()) {
      const spec = validSpec();
      spec.theme = { dominant: "#2F5FF0", stylePackId: id };
      const errors = runStaticGrid(spec).issues.filter((i) => i.severity === "error");
      expect(errors, `pack ${id} should pass the static grid`).toEqual([]);
    }
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

  it("warns on 'chia sẻ ý kiến của bạn bên dưới' engagement-bait", () => {
    const spec = validSpec();
    spec.scenes.at(-1)!.narration =
      "Liệu thương vụ này có giúp họ bứt phá không? Hãy chia sẻ ý kiến của bạn bên dưới nhé.";
    const issues = runStaticGrid(spec).issues.filter((i) => i.check === "N27");
    expect(issues.length).toBe(1);
    expect(issues[0]!.severity).toBe("warning");
  });
});
