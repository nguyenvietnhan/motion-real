import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { getComponent, registerComponent } from "@motionreal/compositions";
import type { VideoSpec } from "@motionreal/schema";
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
    format: "tiktok",
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
  // Freeform pivot: a non-sequential `scene-NN` id is a cosmetic convention (the
  // renderer keys by whatever id is given), so it surfaces as a WARNING and no
  // longer hard-blocks a video that renders fine. Only the crash/no-video class
  // (unknown component, empty spec, duplicate id) stays hard.
  it("warns (does not hard-block) when a scene id is out of sequence", () => {
    const spec = validSpec();
    spec.scenes[1]!.id = "scene-99";
    const report = runStaticGrid(spec);
    const n1 = report.issues.find((i) => i.check === "N1" && /scene-99|index 1/.test(i.message));
    expect(n1?.severity).toBe("warning");
    expect(report.ok).toBe(true);
  });

  it("warns (does not hard-block) when narration is multiline (not one paragraph)", () => {
    const spec = validSpec();
    spec.scenes[2]!.narration = "Dòng một của cảnh này.\nDòng hai của cảnh này.";
    const report = runStaticGrid(spec);
    const n1 = report.issues.find((i) => i.check === "N1" && /one paragraph|multiline/.test(i.message));
    expect(n1?.severity).toBe("warning");
    expect(report.ok).toBe(true);
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

  it("accepts a component id admitted from authored source without host-registering it", () => {
    const spec = validSpec();
    spec.scenes[1]!.component = "authored-only-scene";
    const report = runStaticGrid(spec, { authoredComponentIds: ["authored-only-scene"] });
    expect(report.issues.some((i) => i.check === "N2")).toBe(false);
    expect(report.ok).toBe(true);
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

  it("skips host-side N3 validation for admitted authored component ids", () => {
    const spec = validSpec();
    spec.scenes[2]!.component = "authored-props-live-in-untrusted-code";
    spec.scenes[2]!.props = {};
    const issues = runStaticGrid(spec, { authoredComponentIds: ["authored-props-live-in-untrusted-code"] }).issues;
    expect(issues.some((i) => i.check === "N2")).toBe(false);
    expect(issues.some((i) => i.check === "N3")).toBe(false);
  });

  // Regression (Working Agreement #1): models recurrently declare the FRAMEWORK
  // top-level fields (`headline`/`eyebrow`/`body`/`image`) INSIDE the authored
  // `schema` (`schema: z.object({ headline: z.string(), … })`). Those fields are
  // passed to the scene top-level (`SceneComponentProps`, beside `props`), NOT in
  // `props` — so validating `scene.props` alone reported a phantom "headline:
  // expected string, received undefined" and hard-blocked 12 scenes of a video
  // that renders fine. N3 now validates the MERGED view, so a schema that slips
  // these in is satisfied by the real top-level values. The fixture is the exact
  // shape `gemini-3-flash` produced (schema requires `headline`, `props` is {}).
  it("does NOT fire when a schema mistakenly declares the top-level `headline` (props is {})", () => {
    const HEADLINE_IN_SCHEMA = "headline-in-schema-scene";
    if (!getComponent(HEADLINE_IN_SCHEMA)) {
      registerComponent({
        id: HEADLINE_IN_SCHEMA,
        displayName: "Headline-in-schema Scene",
        promptGuide: "regression fixture only",
        // The AI mistake: headline/eyebrow belong to the framework, not props.
        schema: z.object({ headline: z.string(), eyebrow: z.string().optional() }),
        Component: () => null,
        example: { headline: "x" } as never,
      });
    }
    const spec = validSpec();
    spec.scenes[2]!.component = HEADLINE_IN_SCHEMA;
    spec.scenes[2]!.props = {}; // headline arrives top-level, not in props
    const issues = runStaticGrid(spec).issues.filter((i) => i.check === "N3");
    expect(issues).toEqual([]);
  });

  // A real prop error must STILL fire even when the schema also declares a
  // framework field — the tolerance only forgives the top-level slip, it does
  // not turn N3 into a no-op for genuinely bad props.
  it("still fires for a genuinely invalid bespoke prop alongside a slipped-in headline", () => {
    const MIXED = "headline-plus-bad-prop-scene";
    if (!getComponent(MIXED)) {
      registerComponent({
        id: MIXED,
        displayName: "Mixed Scene",
        promptGuide: "regression fixture only",
        schema: z.object({ headline: z.string(), count: z.number() }),
        Component: () => null,
        example: { headline: "x", count: 1 } as never,
      });
    }
    const spec = validSpec();
    spec.scenes[3]!.component = MIXED;
    spec.scenes[3]!.props = { count: "not-a-number" } as never; // real type error
    const issues = runStaticGrid(spec).issues.filter((i) => i.check === "N3");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.path === "count")).toBe(true);
  });
});

describe("static grid — N6 phonetic / N7 spaced abbreviations", () => {
  // Freeform pivot: these are Vietnamese-TTS heuristics that always misfire on
  // Korean/German/English content, so they are advisory WARNINGS now — they still
  // fire (so a Vietnamese author sees the nudge) but never hard-block a render.
  it("warns (does not hard-block) on phonetic spelling in a display field", () => {
    const spec = validSpec();
    spec.scenes[3]!.headline = "Sức mạnh của Ô pân A I";
    const report = runStaticGrid(spec);
    const hit = report.issues.find((i) => i.check === "N6" || i.check === "N7");
    expect(hit?.severity).toBe("warning");
    expect(report.ok).toBe(true);
  });

  it("fires on a spaced abbreviation in narration", () => {
    const spec = validSpec();
    spec.scenes[4]!.narration =
      "Công nghệ A I đang thay đổi cách chúng ta làm việc mỗi ngày và điều đó kéo theo rất nhiều hệ quả đáng suy ngẫm cho tương lai gần.";
    expect(checks(spec).has("N7")).toBe(true);
  });

  it("detects phonetic spelling encoded with decomposed Vietnamese accents (NFD)", () => {
    const spec = validSpec();
    spec.scenes[3]!.headline = "Sức mạnh của Ô pân".normalize("NFD");
    expect(runStaticGrid(spec).issues.some((i) => i.check === "N6")).toBe(true);
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

describe("static grid — N9 remote-media ban (hard)", () => {
  it("fires when a scene image.ref is a remote URL", () => {
    const spec = validSpec();
    spec.scenes[6]!.image = { ref: "https://x/y.png" };
    const set = checks(spec);
    expect(set.has("N9")).toBe(true);
    expect(runStaticGrid(spec).ok).toBe(false);
  });

  it("fires when a scene image.ref is protocol-relative", () => {
    const spec = validSpec();
    spec.scenes[6]!.image = { ref: "//cdn.example.com/banner.png" };
    expect(runStaticGrid(spec).issues.some((i) => i.check === "N9")).toBe(true);
  });

  it("passes a scene with a LOCAL image.ref", () => {
    const spec = validSpec();
    spec.scenes[6]!.image = { ref: "assets/photo.png" };
    expect(runStaticGrid(spec).issues.some((i) => i.check === "N9")).toBe(false);
  });

  it("fires when a remote image URL is hidden in free-form props", () => {
    const spec = validSpec();
    (spec.scenes[6]!.props as Record<string, unknown>).bg = "https://cdn.example.com/banner.jpg";
    expect(runStaticGrid(spec).issues.some((i) => i.check === "N9")).toBe(true);
  });

  it.each([
    "https://cdn.example.com/banner.svg",
    "https://cdn.example.com/image",
    "//cdn.example.com/banner.png",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "blob:https://example.com/id",
    "file:///C:/secret.png",
  ])("fires when URL-like media ref %s is hidden in free-form props", (ref) => {
    const spec = validSpec();
    (spec.scenes[6]!.props as Record<string, unknown>).bg = ref;
    expect(runStaticGrid(spec).issues.some((i) => i.check === "N9")).toBe(true);
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

describe("static grid — legacy stylePackId", () => {
  it("ignores unknown theme.stylePackId because style packs are retired", () => {
    const spec = validSpec();
    spec.theme = { dominant: "#2F5FF0", stylePackId: "totally-made-up-pack" };
    const issues = runStaticGrid(spec).issues.filter((i) => /stylePackId/i.test(i.message));
    expect(issues).toEqual([]);
    expect(runStaticGrid(spec).ok).toBe(true);
  });

  it("accepts the neutral back-compat id and the default (no id)", () => {
    const withPack = validSpec();
    withPack.theme = { dominant: "#2F5FF0", stylePackId: "neutral" };
    expect(runStaticGrid(withPack).issues.some((i) => /stylePackId/i.test(i.message))).toBe(false);

    const noPack = validSpec();
    expect(runStaticGrid(noPack).issues.some((i) => /stylePackId/i.test(i.message))).toBe(false);
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

  it("allows a follow CTA when it names a topic anchor from the video", () => {
    const spec = validSpec();
    spec.title = "Lộ trình dự án Alpha";
    spec.scenes[0]!.headline = "Alpha bước vào giai đoạn mới";
    spec.scenes.at(-1)!.narration = "Theo dõi cập nhật của dự án Alpha trong quý tới.";
    expect(runStaticGrid(spec).issues.filter((i) => i.check === "N27")).toEqual([]);
  });

  it("still warns on a follow CTA with no topic anchor", () => {
    const spec = validSpec();
    spec.scenes.at(-1)!.narration = "Hãy theo dõi để xem thêm nhiều nội dung mới trong thời gian tới nhé.";
    expect(runStaticGrid(spec).issues.some((i) => i.check === "N27")).toBe(true);
  });
});
