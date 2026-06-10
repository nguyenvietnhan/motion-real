import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";

/**
 * Render-free block tests (R2.2, R15.2, R17.1). Blocks call Remotion's frame
 * hooks, so we mock ONLY `useCurrentFrame`/`useVideoConfig` (frame 0) and keep
 * the rest of Remotion real (AbsoluteFill, interpolate). We then SSR each block
 * with the default theme and assert: it renders its content, it is squared (no
 * rounded corners), `Content` stays inside the content zone, and the caption
 * track shows/hides on the active cue.
 */

vi.mock("remotion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("remotion")>();
  return {
    ...actual,
    useCurrentFrame: () => 0,
    useVideoConfig: () =>
      ({ fps: 30, durationInFrames: 300, width: 1080, height: 1920 } as unknown as ReturnType<
        typeof actual.useVideoConfig
      >),
  };
});

import { Frame, Content, TitleBlock, IdeaPanel, Callout, KeyPoints, StatChip, Captions, HeaderBar, Panel, StatBlock, Story } from "./index.js";
import { CONTENT_ZONE, rectWidth, type CaptionCue } from "@news/schema";

const html = (el: React.ReactElement): string => renderToStaticMarkup(el);
const hasRoundedCorners = (markup: string): boolean => /border-radius:\s*[1-9]/.test(markup);

describe("@news/blocks — render-free", () => {
  it("Frame renders a full-bleed neutral container", () => {
    const markup = html(React.createElement(Frame, { children: "x" }));
    expect(markup).toContain("position:absolute");
    expect(markup).toContain("x");
  });

  it("Content stays inside the content zone (R15.2)", () => {
    const markup = html(React.createElement(Content, { children: "body" }));
    expect(markup).toContain(`top:${CONTENT_ZONE.top}px`);
    expect(markup).toContain(`left:${CONTENT_ZONE.left}px`);
    expect(markup).toContain(`width:${rectWidth(CONTENT_ZONE)}px`);
    expect(markup).toContain("body");
  });

  it("TitleBlock renders a framed headline (+ optional body), no top-left eyebrow", () => {
    const plain = html(React.createElement(TitleBlock, { headline: "Một tiêu đề rõ ràng" }));
    expect(plain).toContain("Một tiêu đề rõ ràng");
    expect(hasRoundedCorners(plain)).toBe(false);
    const withBody = html(React.createElement(TitleBlock, { headline: "Tiêu đề", body: "Phụ đề trong khung" }));
    expect(withBody).toContain("Phụ đề trong khung");
  });

  it("IdeaPanel is squared and delineated (R17.1/17.2)", () => {
    const markup = html(React.createElement(IdeaPanel, { title: "Ý chính", children: "Nội dung" }));
    expect(markup).toContain("Ý chính");
    expect(markup).toContain("Nội dung");
    expect(markup).toContain("border");
    expect(hasRoundedCorners(markup)).toBe(false);
  });

  it("Callout renders each tone without rounded corners", () => {
    for (const tone of ["accent", "signal", "danger"] as const) {
      const markup = html(React.createElement(Callout, { tone, children: `tone-${tone}` }));
      expect(markup).toContain(`tone-${tone}`);
      expect(hasRoundedCorners(markup)).toBe(false);
    }
  });

  it("KeyPoints owns its numbering 1..n", () => {
    const markup = html(
      React.createElement(KeyPoints, { title: "Tóm tắt", items: ["Một", "Hai", "Ba"] }),
    );
    expect(markup).toContain("Tóm tắt");
    expect(markup).toContain("Một");
    expect(markup).toContain("Hai");
    expect(markup).toContain("Ba");
    expect(markup).toContain(">1<");
    expect(markup).toContain(">2<");
    expect(markup).toContain(">3<");
    expect(hasRoundedCorners(markup)).toBe(false);
  });

  it("StatChip renders value + label", () => {
    const markup = html(React.createElement(StatChip, { value: "92%", label: "độ chính xác" }));
    expect(markup).toContain("92%");
    expect(markup).toContain("độ chính xác");
    expect(hasRoundedCorners(markup)).toBe(false);
  });

  it("Captions shows the active cue and hides when none is active (R16.1)", () => {
    const cues: CaptionCue[] = [
      { startFrame: 0, endFrame: 60, text: "Dòng caption đang chạy", sceneId: "scene-01" },
      { startFrame: 90, endFrame: 150, text: "Dòng sau", sceneId: "scene-02" },
    ];
    const active = html(React.createElement(Captions, { cues }));
    expect(active).toContain("Dòng caption đang chạy");
    expect(active).not.toContain("Dòng sau");

    const none = html(React.createElement(Captions, { cues: [cues[1]!] }));
    expect(none).toBe("");
  });

  it("editorial blocks render squared/framed (HeaderBar, Panel, StatBlock, Story)", () => {
    const header = html(React.createElement(HeaderBar, { eyebrow: "DỮ LIỆU", label: "STAT", meta: "2026" }));
    expect(header).toContain("DỮ LIỆU");
    expect(hasRoundedCorners(header)).toBe(false);

    const panel = html(React.createElement(Panel, { title: "VÌ SAO", children: "Nội dung khung" }));
    expect(panel).toContain("Nội dung khung");
    expect(hasRoundedCorners(panel)).toBe(false);

    const stat = html(React.createElement(StatBlock, { value: "950", unit: "triệu USD", label: "Vòng gọi vốn" }));
    expect(stat).toContain("950");
    expect(stat).toContain("triệu USD");

    const story = html(
      React.createElement(Story, { eyebrow: "TIN", meta: "2026", children: "X", footer: { left: "nguồn" } }),
    );
    expect(story).toContain(`top:${CONTENT_ZONE.top}px`);
    expect(story).toContain("TIN");
    expect(story).toContain("nguồn");
  });

  it("Story reserves a divider clearance gap and clips an over-tall column instead of bleeding past it", () => {
    const story = html(React.createElement(Story, { eyebrow: "TIN", children: "X" }));
    // Border-box + paddingBottom keeps content a visible beat above the global
    // CaptionDivider (drawn at CONTENT_ZONE.bottom) — never flush on the line.
    expect(story).toContain("box-sizing:border-box");
    expect(story).toMatch(/padding-bottom:[1-9]/);
    // An over-tall content column is clipped (overflow hidden) and anchored so it
    // can't bleed symmetrically past the top header and the bottom divider.
    expect(story).toContain("overflow:hidden");
    expect(story).toContain("justify-content:safe center");
  });
});
