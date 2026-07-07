import { describe, expect, it } from "vitest";
import { AUTHORING_CONTRACT } from "./contract-text.js";

/**
 * Feature: block removal — the inlined AUTHORING_CONTRACT is the text the model
 * actually reads (embedded into the author + reauthor prompts). Post-pivot the
 * layout blocks were DELETED and @motionreal/blocks/@motionreal/theme dropped from the
 * authored-import whitelist: a scene is 100% bespoke JSX/SVG. The ONE survivor is
 * SceneImage (the image feature), reached via @motionreal/compositions. These lock that
 * contract IN so a future edit can't silently re-introduce the block crutch.
 */
describe("AUTHORING_CONTRACT — no-block / raw-JSX invariants", () => {
  it("keeps hard safety/module sections before visual ambition guidance", () => {
    const importIndex = AUTHORING_CONTRACT.indexOf("IMPORT WHITELIST");
    const syntaxIndex = AUTHORING_CONTRACT.indexOf("CÚ PHÁP TSX BẮT BUỘC");
    const determinismIndex = AUTHORING_CONTRACT.indexOf("DETERMINISM + MOTION");
    const visualIndex = AUTHORING_CONTRACT.indexOf("VISUALIZE SÁNG TẠO");

    expect(importIndex).toBeGreaterThanOrEqual(0);
    expect(syntaxIndex).toBeGreaterThanOrEqual(0);
    expect(determinismIndex).toBeGreaterThanOrEqual(0);
    expect(visualIndex).toBeGreaterThanOrEqual(0);
    expect(importIndex).toBeLessThan(visualIndex);
    expect(syntaxIndex).toBeLessThan(visualIndex);
    expect(determinismIndex).toBeLessThan(visualIndex);
  });

  it("whitelists ONLY react/remotion/@motionreal/compositions/zod — never @motionreal/blocks or @motionreal/theme", () => {
    // The structural lever against monotony: a scene literally cannot import a
    // layout block, so the model must author raw JSX. The contract must say so.
    expect(AUTHORING_CONTRACT).toContain("@motionreal/compositions");
    expect(AUTHORING_CONTRACT).toMatch(/KHÔNG import "@motionreal\/blocks"/);
    // No leftover instruction to compose blocks (Frame/Story/TitleBlock/…).
    expect(AUTHORING_CONTRACT).not.toMatch(/COMPOSE|compose these|đừng tự code khung/);
  });

  it("tells the model to build everything as raw JSX/SVG (no pre-made blocks)", () => {
    expect(AUTHORING_CONTRACT).toMatch(/TỰ DỰNG MỌI THỨ|TỰ VIẾT MỚI 100%/);
    expect(AUTHORING_CONTRACT).toMatch(/JSX/);
    // The design line: hardcode all visuals, there is no theme/token to read.
    expect(AUTHORING_CONTRACT).toMatch(/HARDCODE|hardcode/);
  });

  it("requires parseable TSX and valid object-literal style syntax", () => {
    expect(AUTHORING_CONTRACT).toMatch(/CÚ PHÁP TSX BẮT BUỘC/);
    expect(AUTHORING_CONTRACT).toMatch(/TypeScript\/TSX parse được/);
    expect(AUTHORING_CONTRACT).toMatch(/object literal/);
    expect(AUTHORING_CONTRACT).toMatch(/style=\{\{ .* \}\}/);
    expect(AUTHORING_CONTRACT).toMatch(/key: value/);
    expect(AUTHORING_CONTRACT).toMatch(/foo\("bar"\)/);
    expect(AUTHORING_CONTRACT).toMatch(/justifyContent: "flex-start"/);
  });

  it("keeps the SceneImage exception so the image feature still works", () => {
    // Images are the ONE sanctioned non-react/remotion import, via @motionreal/compositions.
    expect(AUTHORING_CONTRACT).toMatch(/SceneImage/);
    expect(AUTHORING_CONTRACT).toMatch(/NGOẠI LỆ DUY NHẤT cho ảnh/);
    expect(AUTHORING_CONTRACT).toMatch(/from "@motionreal\/compositions"/);
  });

  /**
   * Feature: freeform pivot — three defects seen by eye on a real desktop render
   * (content, not code), fixed by sharpening the contract the model reads:
   *
   *  1. On-screen text duplicated the full narration sentence. The burned karaoke
   *     caption already carries the spoken line, so on-screen text should be the
   *     condensed key phrase only. The contract never drew that distinction.
   *  2. Presentation was monotonous — the model mostly DROPPED TEXT into the same
   *     few blocks (TitleBlock + Panel/KeyPoints) instead of VISUALIZING the idea
   *     as bespoke self-drawn SVG/CSS. The form map only pointed at finite stock
   *     blocks, so the model read "variety = pick among my blocks" → low ceiling.
   *     The fix turns self-drawn visualization into a general expectation (with
   *     portable metaphor examples + a countable anti-repeat floor), not a leash.
   *  3. The contract still asserted a system-drawn divider line and an N14 that
   *     "chặn render" — both false post-pivot (theme `divider:false`; N14 is a
   *     warning). A phantom hard-gate pushes the model to play safe → repetition.
   */
  it("tells the model on-screen text is the condensed idea, NOT the full narration sentence", () => {
    // The caption already carries the spoken line, so the contract must say so and
    // forbid copying the whole narration onto the scene.
    expect(AUTHORING_CONTRACT).toMatch(/CHỮ TRÊN CẢNH ≠ LỜI ĐỌC/);
    expect(AUTHORING_CONTRACT).toMatch(/KHÔNG chép cả narration/);
  });

  it("pushes self-drawn visualization (turn the idea into a shape), not just dropping text into blocks", () => {
    // The lever against monotony: visualize the idea as bespoke SVG/CSS, framed as
    // a general expectation with portable metaphor examples — not "pick a block".
    expect(AUTHORING_CONTRACT).toMatch(/VISUALIZE SÁNG TẠO/);
    expect(AUTHORING_CONTRACT).toMatch(/BIẾN Ý của cảnh thành HÌNH/);
    expect(AUTHORING_CONTRACT).toMatch(/DÁM VẼ ẨN DỤ/);
    // The countable floor: every video must carry ≥1 self-drawn graphic beat.
    expect(AUTHORING_CONTRACT).toMatch(/ÍT NHẤT 1–2 cảnh mang đồ hoạ\/ẩn dụ TỰ VẼ/);
  });

  it("drops the false 'system-drawn divider' + 'N14 chặn render' claims (post-pivot)", () => {
    // The theme sets divider:false and N14 is severity:"warning" — the contract
    // must not tell the model a phantom hard layout gate exists.
    expect(AUTHORING_CONTRACT).not.toMatch(/đường kẻ ĐEN/);
    expect(AUTHORING_CONTRACT).not.toMatch(/N14 \(chặn render\)/);
    // It states the truth instead: N14 is advisory and no line is drawn.
    expect(AUTHORING_CONTRACT).toMatch(/advisory — KHÔNG chặn render/);
    expect(AUTHORING_CONTRACT).toMatch(/Không có đường kẻ nào do hệ thống vẽ/);
  });

  it("separates motion tempo classes without making motion mandatory", () => {
    expect(AUTHORING_CONTRACT).toMatch(/quick entrance\/reveal\/pop/);
    expect(AUTHORING_CONTRACT).toMatch(/0\.2–0\.8 giây/);
    expect(AUTHORING_CONTRACT).toMatch(/semantic progression/);
    expect(AUTHORING_CONTRACT).toMatch(/chỉ dùng progress dài khi NỘI DUNG thật sự tiến triển/);
    expect(AUTHORING_CONTRACT).toMatch(/continuous living motion/);
    expect(AUTHORING_CONTRACT).toMatch(/Chuyển động phải nhỏ, bounded, có chủ đích/);
    expect(AUTHORING_CONTRACT).toMatch(/phase = \(\(Math\.max\(0, frame - enterEnd\)\) % periodFrames\) \/ periodFrames/);
    expect(AUTHORING_CONTRACT).toMatch(/Quick entrance \+ readable final hold luôn hợp lệ/);
    expect(AUTHORING_CONTRACT).not.toMatch(/DIỄN TIẾN qua phần lớn thời lượng/);
    expect(AUTHORING_CONTRACT).not.toMatch(/đừng dùng Math\.sin\(frame\), frame%n/);
    expect(AUTHORING_CONTRACT).not.toMatch(/ANIMATION PHẢI|mọi cảnh phải chuyển động/);
  });

  it("warns that Remotion interpolate inputRange must be strictly increasing", () => {
    expect(AUTHORING_CONTRACT).toMatch(/inputRange PHẢI tăng dần nghiêm ngặt/);
    expect(AUTHORING_CONTRACT).toMatch(/KHÔNG dùng durationInFrames - N làm mốc cuối/);
    expect(AUTHORING_CONTRACT).toMatch(/Math\.max\(1, durationInFrames - N\)/);
    expect(AUTHORING_CONTRACT).toMatch(/\[340, 360, 60\]/);
  });
});
