import { describe, expect, it } from "vitest";
import { parseAuthorManifest } from "./manifest-schema.js";

/**
 * Regression fixtures for the manifest-coercion fixes (Working Agreement rule 1:
 * every `fix(authoring)` class gets a fixture that locks the behavior). These
 * guard the "one bad field of one scene must NOT discard the whole reply"
 * invariant — without these coercions a single overshoot would fail `safeParse`
 * and throw away the manifest + every authored .tsx, forcing a full re-author.
 *
 * Covered historical fixes:
 *  - 75f21c6 clamp/coerce manifest fields (over-long title/eyebrow/narration/mood)
 *  - e73fb0d coerce bare-string / aliased image field ({url}/{src}/{path})
 *  - the per-field `.catch()` degradations (bad transition enum, malformed image)
 */

/** A minimal valid manifest (3 scenes = the schema floor) we mutate per case. */
const base = () => ({
  title: "Tiêu đề video hợp lệ",
  theme: { dominant: "#1E9CB0", mood: "editorial teal" },
  scenes: [
    { component: "scene-hook", eyebrow: "TIN", headline: "Câu mở đầu", narration: "Mở đầu trực diện.", props: {} },
    { component: "scene-stat", eyebrow: "SỐ", headline: "Một con số", narration: "Con số quan trọng.", props: {} },
    { component: "scene-cta", eyebrow: "KẾT", headline: "Chốt lại", narration: "Câu hỏi gắn chủ đề.", props: {} },
  ],
});

/** Parse a plain manifest object (no fence needed — parser handles bare JSON). */
const parse = (m: unknown) => parseAuthorManifest(JSON.stringify(m));

describe("manifest coercion — over-long fields clamp, never discard the reply (75f21c6)", () => {
  it("clamps a 601-char narration to 600 instead of failing the whole reply", () => {
    const m = base();
    m.scenes[0]!.narration = "x".repeat(601);
    const r = parse(m);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.scenes[0]!.narration.length).toBe(600);
  });

  it("clamps an over-long eyebrow (>24) rather than discarding", () => {
    const m = base();
    m.scenes[1]!.eyebrow = "E".repeat(40);
    const r = parse(m);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.scenes[1]!.eyebrow.length).toBe(24);
  });

  it("clamps an over-long title (>160) rather than discarding", () => {
    const m = base();
    m.title = "T".repeat(200);
    const r = parse(m);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.title.length).toBe(160);
  });

  it("clamps an over-long mood and never lets it nuke the reply", () => {
    const m = base();
    m.theme.mood = "m".repeat(500);
    const r = parse(m);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.theme.mood.length).toBeLessThanOrEqual(200);
  });
});

describe("manifest coercion — bare-string / aliased image → { ref } (e73fb0d)", () => {
  it("coerces a bare-string image into { ref }", () => {
    const m = base() as unknown as { scenes: { image?: unknown }[] };
    m.scenes[0]!.image = "assets/abc123.png";
    const r = parse(m);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.scenes[0]!.image?.ref).toBe("assets/abc123.png");
  });

  it("accepts the { url } alias for the ref key", () => {
    const m = base() as unknown as { scenes: { image?: unknown }[] };
    m.scenes[0]!.image = { url: "assets/from-url.jpg" };
    const r = parse(m);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.scenes[0]!.image?.ref).toBe("assets/from-url.jpg");
  });

  it("accepts the { src } alias and keeps alt text", () => {
    const m = base() as unknown as { scenes: { image?: unknown }[] };
    m.scenes[0]!.image = { src: "assets/from-src.png", alt: "mô tả ảnh" };
    const r = parse(m);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.scenes[0]!.image?.ref).toBe("assets/from-src.png");
      expect(r.manifest.scenes[0]!.image?.alt).toBe("mô tả ảnh");
    }
  });
});

describe("manifest coercion — one bad field degrades, never discards (per-field .catch)", () => {
  it("degrades an out-of-enum transitionToNext to undefined and keeps the reply", () => {
    const m = base() as unknown as { scenes: { transitionToNext?: unknown }[] };
    m.scenes[0]!.transitionToNext = "teleport"; // not a real transition
    const r = parse(m);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.scenes[0]!.transitionToNext).toBeUndefined();
  });

  it("degrades a malformed image (object with no resolvable path) to undefined", () => {
    const m = base() as unknown as { scenes: { image?: unknown }[] };
    m.scenes[0]!.image = { caption: "không có ref/url/src" };
    const r = parse(m);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.scenes[0]!.image).toBeUndefined();
  });

  it("keeps the other scenes alive when one scene carries a bad field", () => {
    const m = base() as unknown as { scenes: { transitionToNext?: unknown }[] };
    m.scenes[1]!.transitionToNext = "nonsense";
    const r = parse(m);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.scenes).toHaveLength(3);
  });
});

describe("manifest coercion — publish hashtags normalize to a clean #-prefixed array (H3/D9)", () => {
  // Hashtags are a SEPARATE publish field (the title stays clean — it doubles as
  // the project display name). The model emits them in many shapes; all must
  // normalize to ["#ai", "#tech", ...] so the Copy panel always has ready tags,
  // and a bad value must NEVER discard the manifest + every authored .tsx.
  const withHashtags = (h: unknown) => {
    const m = base() as unknown as { hashtags?: unknown };
    m.hashtags = h;
    return parse(m);
  };

  it("keeps a clean array as-is", () => {
    const r = withHashtags(["#ai", "#congnghe"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.hashtags).toEqual(["#ai", "#congnghe"]);
  });

  it("adds the leading # to bare tags", () => {
    const r = withHashtags(["ai", "tech"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.hashtags).toEqual(["#ai", "#tech"]);
  });

  it("splits a single space/comma-separated string into tags", () => {
    const r = withHashtags("#ai #tech, news");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.hashtags).toEqual(["#ai", "#tech", "#news"]);
  });

  it("collapses doubled #s and drops empties, capping at 6", () => {
    const r = withHashtags(["##ai", "", "  ", "#b", "#c", "#d", "#e", "#f", "#g"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.hashtags).toEqual(["#ai", "#b", "#c", "#d", "#e", "#f"]); // 6 max
    }
  });

  it("degrades an unusable value to undefined without discarding the reply", () => {
    const r = withHashtags(12345); // neither string nor array
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.hashtags).toBeUndefined();
  });

  it("omits hashtags entirely when the field is absent", () => {
    const r = parse(base());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.hashtags).toBeUndefined();
  });
});
