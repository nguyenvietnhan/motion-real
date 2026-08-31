import { describe, expect, it } from "vitest";
import { countSafetyChecks, preserveUserBgm, sanitizeTheme, toEngineManifest } from "./author-manifest-convert.js";
import type { AuthorManifest } from "./manifest-schema.js";

function baseManifest(over: Partial<AuthorManifest> = {}): AuthorManifest {
  return {
    title: "Tiêu đề thử",
    theme: { dominant: "#1E9CB0" },
    scenes: [
      {
        component: "alpha",
        eyebrow: "A",
        headline: "Một",
        narration: "Câu một.",
      },
    ],
    ...over,
  } as AuthorManifest;
}

describe("sanitizeTheme", () => {
  it("keeps valid hex and trims whitespace", () => {
    expect(sanitizeTheme({ dominant: "  #AABBCC  " })).toEqual({ dominant: "#AABBCC" });
  });

  it("falls back invalid dominant", () => {
    expect(sanitizeTheme({ dominant: "blue" })).toEqual({ dominant: "#1E9CB0" });
  });
});

describe("toEngineManifest", () => {
  it("assigns sequential scene ids and injects delivery knobs", () => {
    const m = baseManifest({
      title: "T".repeat(200),
      hashtags: ["#ai"],
      scenes: [
        { component: "alpha", eyebrow: "A", headline: "Một", narration: "N1." },
        { component: "beta", eyebrow: "B", headline: "Hai", narration: "N2.", body: "extra" },
      ],
    } as AuthorManifest);

    const engine = toEngineManifest(m, new Set(), {
      format: "tiktok",
      durationTier: 1,
      videoLanguage: "vi",
    });

    expect(engine.title?.length).toBe(140);
    expect(engine.hashtags).toEqual(["#ai"]);
    expect(engine.format).toBe("tiktok");
    expect(engine.durationTier).toBe(1);
    expect(engine.videoLanguage).toBe("vi");
    expect(engine.scenes.map((s) => s.id)).toEqual(["scene-01", "scene-02"]);
    expect(engine.scenes[1]).toMatchObject({ component: "beta", body: "extra" });
  });

  it("keeps only allowed image refs and drops hallucinated ones", () => {
    const m = baseManifest({
      scenes: [
        {
          component: "alpha",
          eyebrow: "A",
          headline: "Một",
          narration: "N1.",
          image: { ref: "assets/keep.png", alt: "ok" },
        },
        {
          component: "beta",
          eyebrow: "B",
          headline: "Hai",
          narration: "N2.",
          image: { ref: "assets/invented.png" },
        },
      ],
    } as AuthorManifest);

    const engine = toEngineManifest(m, new Set(["assets/keep.png"]));
    expect(engine.scenes[0]!.image).toEqual({ ref: "assets/keep.png", alt: "ok" });
    expect(engine.scenes[1]!.image).toBeUndefined();
  });

  it("drops every image when allowedRefs is empty", () => {
    const m = baseManifest({
      scenes: [
        {
          component: "alpha",
          eyebrow: "A",
          headline: "Một",
          narration: "N1.",
          image: { ref: "assets/any.png" },
        },
      ],
    } as AuthorManifest);
    const engine = toEngineManifest(m);
    expect(engine.scenes[0]!.image).toBeUndefined();
  });

  it("injects delivery bgm (user selection, never from the model)", () => {
    const engine = toEngineManifest(baseManifest(), new Set(), { bgm: "  nhac-nen-mac-dinh.mp3  " });
    expect(engine.bgm).toBe("nhac-nen-mac-dinh.mp3");
  });

  it("injects canonical motion beats by sequential scene id", () => {
    const beats = [
      { id: "show-input", anchor: "nhận dữ liệu đầu vào", action: "Reveal the input" },
      { id: "show-output", anchor: "trả kết quả đầu ra", action: "Reveal the output" },
    ] as const;
    const engine = toEngineManifest(
      baseManifest(),
      new Set(),
      {},
      new Map([["scene-01", beats]]),
    );
    expect(engine.scenes[0]!.motionBeats).toEqual(beats);
  });
});

describe("preserveUserBgm", () => {
  it("keeps a non-empty prior track on the next manifest", () => {
    expect(preserveUserBgm({ title: "T", scenes: [] }, "track.mp3")).toEqual({
      title: "T",
      scenes: [],
      bgm: "track.mp3",
    });
  });

  it("does not invent bgm when prior was empty or silence", () => {
    expect(preserveUserBgm({ title: "T", scenes: [] }, undefined).bgm).toBeUndefined();
    expect(preserveUserBgm({ title: "T", scenes: [] }, null).bgm).toBeUndefined();
    expect(preserveUserBgm({ title: "T", scenes: [] }, "").bgm).toBeUndefined();
  });
});

describe("countSafetyChecks", () => {
  it("aggregates checks", () => {
    expect(
      countSafetyChecks([
        { check: "N5" },
        { check: "N5" },
        { check: "N10" },
      ]),
    ).toEqual({ N5: 2, N10: 1 });
  });
});
