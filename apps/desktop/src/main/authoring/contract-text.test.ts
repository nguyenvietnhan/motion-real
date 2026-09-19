import { describe, expect, it } from "vitest";
import {
  AUTHORING_CONTRACT,
  CREATIVE_AUTHORING_DIRECTION,
  TECHNICAL_AUTHORING_CONTRACT,
  authoringContract,
  getDesignTokens,
  technicalAuthoringContract,
} from "./contract-text.js";

/**
 * block removal — the inlined AUTHORING_CONTRACT is the text the model
 * actually reads (embedded into the author + reauthor prompts). Post-pivot the
 * layout blocks were DELETED and @motionreal/blocks/@motionreal/theme dropped from the
 * authored-import whitelist: a scene is 100% bespoke JSX/SVG. The ONE survivor is
 * SceneImage (the image feature), reached via @motionreal/compositions. These lock that
 * contract IN so a future edit can't silently re-introduce the block crutch.
 */
describe("AUTHORING_CONTRACT — no-block / raw-JSX invariants", () => {
  it("keeps technical invariants separate from broad creative direction", () => {
    expect(TECHNICAL_AUTHORING_CONTRACT).toMatch(/EXPORT BẮT BUỘC|IMPORT WHITELIST/);
    expect(TECHNICAL_AUTHORING_CONTRACT).toMatch(/LAYOUT ZONES|DETERMINISM \+ MOTION/);
    expect(TECHNICAL_AUTHORING_CONTRACT).not.toMatch(/ART DIRECTION CẢ VIDEO|VISUALIZE SÁNG TẠO/);
    expect(CREATIVE_AUTHORING_DIRECTION).toMatch(/ART DIRECTION CẢ VIDEO|VISUALIZE SÁNG TẠO/);
    expect(AUTHORING_CONTRACT).toContain(TECHNICAL_AUTHORING_CONTRACT);
    expect(AUTHORING_CONTRACT).toContain(CREATIVE_AUTHORING_DIRECTION);
  });

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
    expect(AUTHORING_CONTRACT).toMatch(/Chỉ dùng card khi nội dung thật sự là card/);
    expect(AUTHORING_CONTRACT).not.toContain("card/khung/số-lớn/danh-sách/nhãn");
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
    expect(AUTHORING_CONTRACT).toMatch(/role=\{image\.role\}/);
  });

  it("distinguishes sequential timeline scene ids from authored component ids", () => {
    expect(AUTHORING_CONTRACT).toMatch(/manifest\.scenes\[\]\.component/);
    expect(AUTHORING_CONTRACT).toMatch(/manifest\.scenes\[\]\.id PHẢI là scene-01, scene-02/);
  });

  /**
   * three defects seen by eye on a real desktop render
   * (content, not code), fixed by sharpening the contract the model reads:
   *
   * 1. On-screen text duplicated the full narration sentence. The burned karaoke
   * caption already carries the spoken line, so on-screen text should be the
   * condensed key phrase only. The contract never drew that distinction.
   * 2. Presentation was monotonous — the model mostly DROPPED TEXT into the same
   * few blocks (TitleBlock + Panel/KeyPoints) instead of VISUALIZING the idea
   * as bespoke self-drawn SVG/CSS. The form map only pointed at finite stock
   * blocks, so the model read "variety = pick among my blocks" → low ceiling.
   * The fix turns self-drawn visualization into a general expectation (with
   * portable metaphor examples + a countable anti-repeat floor), not a leash.
   * 3. The contract still asserted a system-drawn divider line and an N14 that
   * "chặn render" — both false post-pivot (theme `divider:false`; N14 is a
   * warning). A phantom hard-gate pushes the model to play safe → repetition.
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

  it("places the primary visual mass in active zone with bimodal layout zones without a hard layout gate", () => {
    expect(AUTHORING_CONTRACT).toMatch(/TOP RESERVE \(0%–12%/);
    expect(AUTHORING_CONTRACT).toMatch(/ACTIVE TYPOGRAPHY & EDITORIAL ZONE \(12%–62%/);
    expect(AUTHORING_CONTRACT).toMatch(/STRUCTURAL GROUNDING EXTENSION \(62%–70%/);
    expect(AUTHORING_CONTRACT).toMatch(/CAPTION BAND \(71%–86%/);
    expect(AUTHORING_CONTRACT).toMatch(/BOTTOM RESERVE \(86%–100%/);
    expect(AUTHORING_CONTRACT).toMatch(/~38%–46%/);
    expect(AUTHORING_CONTRACT).toMatch(/<= 62%–64%/);
    expect(AUTHORING_CONTRACT).toMatch(/68%–70%/);
    expect(AUTHORING_CONTRACT).toMatch(/top-aligned \(bên trong content-zone\)/);
    expect(CREATIVE_AUTHORING_DIRECTION).toMatch(/Mọi số, giá, ngày hoặc phần trăm literal/);
    expect(CREATIVE_AUTHORING_DIRECTION).toMatch(/CẤM bịa số trang trí/);
    expect(TECHNICAL_AUTHORING_CONTRACT).not.toMatch(/CẤM bịa số trang trí/);
    expect(AUTHORING_CONTRACT).toMatch(/không phải lệnh ép mọi cảnh vào đúng giữa/);
  });

  it("separates motion tempo classes without making motion mandatory", () => {
    expect(AUTHORING_CONTRACT).toMatch(/quick entrance\/reveal\/pop/);
    expect(AUTHORING_CONTRACT).toMatch(/0\.2–0\.8 giây/);
    expect(AUTHORING_CONTRACT).toMatch(/semantic progression/);
    expect(AUTHORING_CONTRACT).toMatch(/firstAt = motionCueFrames\?\.\["receive-request"\].*\?\?/);
    expect(AUTHORING_CONTRACT).toMatch(/secondAt = motionCueFrames\?\.\["show-result"\].*\?\?/);
    expect(AUTHORING_CONTRACT).toContain("mọi beat (cả đầu)");
    expect(AUTHORING_CONTRACT).toMatch(/Ẩn beat trước cue/);
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

  it("binds dominant color into authoritative Palette Token Contract and forbids arbitrary hex codes", () => {
    // Default tokens
    const defaultTokens = getDesignTokens();
    expect(defaultTokens.ACCENT_PRIMARY).toBe("#38BDF8");
    expect(defaultTokens.BG).toBe("#0B0F17");
    expect(defaultTokens.TEXT_PRIMARY).toBe("#FFFFFF");
    expect(defaultTokens.TEXT_MUTED).toBe("#94A3B8");
    expect(defaultTokens.STATUS_ERR).toBe("#EF4444");
    expect(defaultTokens.STATUS_OK).toBe("#10B981");

    // Custom dominant color
    const customTokens = getDesignTokens("#10B981");
    expect(customTokens.ACCENT_PRIMARY).toBe("#10B981");
    expect(customTokens.SPOTLIGHT).toContain("16, 185, 129");

    // 3-character hex code expansion
    const shortTokens = getDesignTokens("#38B");
    expect(shortTokens.ACCENT_PRIMARY).toBe("#3388BB");
    const whiteTokens = getDesignTokens("#fff");
    expect(whiteTokens.ACCENT_PRIMARY).toBe("#FFFFFF");

    // Whitespace trimming and case insensitivity
    const trimmedTokens = getDesignTokens("  #10b981  ");
    expect(trimmedTokens.ACCENT_PRIMARY).toBe("#10B981");

    // Contract text assertions
    const contract = technicalAuthoringContract("#10B981");
    expect(contract).toContain('ACCENT_PRIMARY: "#10B981"');
    expect(contract).toMatch(/PALETTE TOKEN CONTRACT/);
    expect(contract).toMatch(/NGHIÊM CẤM: Không dùng mã hex ngoài bảng này/);
    expect(contract).toMatch(/video đồng nhất 100%/);
    // Backdrop radial gradient must use interpolated SPOTLIGHT and BG
    expect(contract).toContain("rgba(16, 185, 129, 0.15)");
    expect(contract).not.toContain("rgba(56, 189, 248, 0.15)");
    // N18 contrast principle must be present in technical contract
    expect(contract).toMatch(/NGUYÊN TẮC TƯƠNG PHẢN \(TRÁNH N18\)/);
  });

  it("replaces frosted glass card traps with 4 positive geometric archetypes with dynamic accent color", () => {
    expect(CREATIVE_AUTHORING_DIRECTION).toMatch(/THAY THẾ TOÀN BỘ CARD BẰNG 4 GEOMETRIC ARCHETYPES/);
    expect(CREATIVE_AUTHORING_DIRECTION).toMatch(/Pipeline Dataflow/);
    expect(CREATIVE_AUTHORING_DIRECTION).toMatch(/Dual Split-Core/);
    expect(CREATIVE_AUTHORING_DIRECTION).toMatch(/Metric Gauge/);
    expect(CREATIVE_AUTHORING_DIRECTION).toMatch(/Architecture Stack/);
    expect(CREATIVE_AUTHORING_DIRECTION).toMatch(/frosted card trap/);
    expect(CREATIVE_AUTHORING_DIRECTION).toMatch(/Toàn video tối đa 1 cảnh dạng card/);

    // Dynamic dominant color in archetypes
    const greenCreative = authoringContract("#10B981");
    expect(greenCreative).toContain('stroke="#10B981"');
    expect(greenCreative).not.toContain('stroke="#38BDF8"');
  });
});

