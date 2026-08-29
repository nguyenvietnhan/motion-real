import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AgentDraftVM } from "../../shared/types.js";
import { AgentLibrary, AgentWorkspace } from "./agent.js";

const draft: AgentDraftVM = {
  id: "agent-1",
  title: "Gemini là gì",
  createdAt: "2026-08-29T10:00:00.000Z",
  updatedAt: "2026-08-29T11:00:00.000Z",
  workflowVersion: 1,
  workflowRevision: 0,
  productionState: "discovery",
  sessionAccess: "full",
  createReady: false,
  harnessUrl: "http://127.0.0.1:3080/?session=session-1&embedded=motionreal",
};

describe("Video Agent layout", () => {
  it("renders the library with the shared page header and row projects", () => {
    const html = renderToStaticMarkup(React.createElement(AgentLibrary, {
      drafts: [draft], loading: false, busy: false, notice: null,
      onCreate: vi.fn(), onOpen: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(),
    }));

    expect(html).toContain("Video Agent");
    expect(html).toContain("Tạo video mới");
    expect(html).toContain("Gemini là gì");
    expect(html).toContain("aria-label=\"Tùy chọn Gemini là gì\"");
    expect(html).not.toContain("Trao đổi, research");
    expect(html).not.toContain("Video đang làm");
  });

  it("renders a compact workspace and the MotionReal embedded iframe only", () => {
    const html = renderToStaticMarkup(React.createElement(AgentWorkspace, {
      draft, reviewMode: "stills_edit", busy: false, notice: null,
      onBack: vi.fn(), onDraftChange: vi.fn(), onOpenProject: vi.fn(),
      run: async (work: () => Promise<void>) => work(),
    }));

    expect(html).toContain("Gemini là gì");
    expect(html).toContain("Cài đặt Agent");
    expect(html).toContain("MotionReal Agent — Gemini là gì");
    expect(html).toContain("embedded=motionreal");
    expect(html).not.toContain("DeepSeek Harness");
    expect(html).not.toContain("Tạo video mới");
    expect(html).not.toContain("Xóa video");
    expect(html).not.toContain("Video đang làm");
    expect(html).not.toContain("Tải lại chat");
  });
});
