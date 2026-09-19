import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AgentBriefVM, AgentDraftVM } from "../../shared/types.js";
import { AgentErrorBoundary, AgentLibrary, AgentNameDialog, AgentWorkspace, safeScaffoldErrorMessage } from "./agent.js";

const draft: AgentDraftVM = {
  id: "agent-1",
  title: "Gemini là gì",
  createdAt: "2026-08-29T10:00:00.000Z",
  updatedAt: "2026-08-29T11:00:00.000Z",
  workflowVersion: 2,
  workflowRevision: 0,
  productionState: "discovery",
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
    expect(html).not.toContain("ns-btn-icon-only ns-agent-row-menu-trigger\" style");
  });

  it("keeps the video-name dialog content and actions inside padded regions", () => {
    const html = renderToStaticMarkup(React.createElement(AgentNameDialog, {
      open: true, title: "Tạo video mới", confirmLabel: "Tạo workspace", initialValue: "", busy: false,
      onCancel: vi.fn(), onConfirm: vi.fn(),
    }));

    expect(html).toContain("ns-agent-name-dialog-body");
    expect(html).toContain("ns-agent-dialog-actions");
  });

  it("renders a compact workspace and the MotionReal embedded iframe only", () => {
    const html = renderToStaticMarkup(React.createElement(AgentWorkspace, {
      draft, reviewMode: "stills_edit", busy: false, notice: null,
      onBack: vi.fn(), onDraftChange: vi.fn(),
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
    expect(html).not.toContain("<progress");
  });

  it("gives a brief review the full workspace instead of a second progress panel", () => {
    const brief: AgentBriefVM = {
      revision: 1, title: "Video", prompt: "# Nội dung brief đủ dài để xem",
      format: "tiktok", videoLanguage: "vi", selectedAssetIds: [],
    };
    const html = renderToStaticMarkup(React.createElement(AgentWorkspace, {
      draft: { ...draft, productionState: "brief_review", briefReview: brief, activities: [{ id: "activity-1", label: "Đã gửi brief", status: "completed" }] },
      reviewMode: "stills_edit", busy: false, notice: null,
      onBack: vi.fn(), onDraftChange: vi.fn(),
      run: async (work: () => Promise<void>) => work(),
    }));

    expect(html).toContain("ns-agent-brief-review");
    expect(html).not.toContain("ns-agent-workflow-progress");
  });

  it("shows durable stop and resume controls for native Harness work", () => {
    const authoring = { ...draft, workflowRevision: 4, productionState: "authoring" as const, projectId: "project-1" };
    const paused = { ...authoring, workflowRevision: 5, productionState: "paused" as const, pausedFrom: "authoring" as const };
    const props = { reviewMode: "stills_edit" as const, busy: false, notice: null, onBack: vi.fn(), onDraftChange: vi.fn(), run: async (work: () => Promise<void>) => work() };

    expect(renderToStaticMarkup(React.createElement(AgentWorkspace, { ...props, draft: authoring }))).toContain(">Dừng<");
    expect(renderToStaticMarkup(React.createElement(AgentWorkspace, { ...props, draft: paused }))).toContain(">Tiếp tục<");
  });

  it("uses the MotionReal workflow surface instead of chat while the agent is working", () => {
    const authoring = {
      ...draft, workflowRevision: 4, productionState: "authoring" as const, projectId: "project-1",
      activities: [{ id: "12", label: "Đang xử lý tệp và asset", status: "running" as const }],
    };
    const html = renderToStaticMarkup(React.createElement(AgentWorkspace, {
      draft: authoring, reviewMode: "stills_edit", busy: false, notice: null,
      onBack: vi.fn(), onDraftChange: vi.fn(), run: async (work: () => Promise<void>) => work(),
    }));

    expect(html).toContain("Đang xử lý tệp và asset");
    expect(html).not.toContain("<iframe");
  });

  it("renders review mode indicator in workspace header for full, stills_edit, and skip_edit", () => {
    const baseProps = {
      draft,
      busy: false,
      notice: null,
      onBack: vi.fn(),
      onDraftChange: vi.fn(),
      run: async (work: () => Promise<void>) => work(),
    };

    const htmlFull = renderToStaticMarkup(React.createElement(AgentWorkspace, { ...baseProps, reviewMode: "full" }));
    expect(htmlFull).toContain("Bản nháp &amp; duyệt cảnh");
    expect(htmlFull).toContain('class="ns-agent-review-mode-chip"');

    const htmlStills = renderToStaticMarkup(React.createElement(AgentWorkspace, { ...baseProps, reviewMode: "stills_edit" }));
    expect(htmlStills).toContain("Duyệt ảnh tĩnh");
    expect(htmlStills).toContain('class="ns-agent-review-mode-chip"');

    const htmlSkip = renderToStaticMarkup(React.createElement(AgentWorkspace, { ...baseProps, reviewMode: "skip_edit" }));
    expect(htmlSkip).toContain("Tự động xuất video");
    expect(htmlSkip).toContain('class="ns-agent-review-mode-chip"');
  });

  it("shows 'Quay lại trao đổi' button for pre-project error card only without duplicating in header", () => {
    const baseProps = {
      reviewMode: "stills_edit" as const,
      busy: false,
      notice: null,
      onBack: vi.fn(),
      onDraftChange: vi.fn(),
      run: async (work: () => Promise<void>) => work(),
    };

    const preProjectError = {
      ...draft,
      workflowRevision: 3,
      productionState: "error" as const,
      lastError: "Visual plan lỗi cú pháp.",
    };
    const htmlPre = renderToStaticMarkup(React.createElement(AgentWorkspace, { ...baseProps, draft: preProjectError }));
    expect(htmlPre).toContain("Quay lại trao đổi");
    // Header actions must only contain retry action and settings, NOT a duplicate escape button
    const headerActionsHtml = htmlPre.match(/<div class="ns-agent-workspace-actions">[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(headerActionsHtml).not.toContain("Quay lại trao đổi");
    expect(headerActionsHtml).toContain("Thử lại bước này");

    const linkedProjectError = {
      ...draft,
      workflowRevision: 3,
      productionState: "error" as const,
      projectId: "project-1",
      lastError: "Lỗi render Remotion.",
    };
    const htmlLinked = renderToStaticMarkup(React.createElement(AgentWorkspace, { ...baseProps, draft: linkedProjectError }));
    expect(htmlLinked).not.toContain("Quay lại trao đổi");
    const linkedHeaderActions = htmlLinked.match(/<div class="ns-agent-workspace-actions">[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(linkedHeaderActions).toContain("Thử lại bước này");

    // When retryAction is rerender_stills on linked project, header button shows 'Thử render ảnh'
    const rerenderStillsError = {
      ...linkedProjectError,
      retryAction: "rerender_stills" as const,
    };
    const htmlRerender = renderToStaticMarkup(React.createElement(AgentWorkspace, { ...baseProps, draft: rerenderStillsError }));
    expect(htmlRerender).not.toContain("Quay lại trao đổi");
    const rerenderHeaderActions = htmlRerender.match(/<div class="ns-agent-workspace-actions">[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(rerenderHeaderActions).toContain("Thử render ảnh");
  });

  it("displays still preparation progress label in library during authoring", () => {
    const authoringDraft = {
      ...draft,
      projectId: "project-1",
      productionState: "authoring" as const,
    };
    const html = renderToStaticMarkup(React.createElement(AgentLibrary, {
      drafts: [authoringDraft],
      projectProgress: {
        "agent-1": {
          state: "authoring",
          label: "Đang chuẩn bị ảnh xem trước…",
          percent: 50,
          canCancel: true,
          reviewReady: false,
        },
      },
      loading: false,
      busy: false,
      notice: null,
      onCreate: vi.fn(),
      onOpen: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
    }));

    expect(html).toContain("Đang chuẩn bị ảnh xem trước…");
  });

  it("ensures Agent paused and error states win over stale project stages in library", () => {
    const pausedDraft = {
      ...draft,
      projectId: "project-1",
      productionState: "paused" as const,
    };
    const html = renderToStaticMarkup(React.createElement(AgentLibrary, {
      drafts: [pausedDraft],
      projectProgress: {
        "agent-1": {
          state: "paused",
          label: "Đã tạm dừng",
          canCancel: false,
          reviewReady: false,
        },
      },
      loading: false,
      busy: false,
      notice: null,
      onCreate: vi.fn(),
      onOpen: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
    }));

    expect(html).toContain("Đã tạm dừng");
    expect(html).toContain("is-paused");
    expect(html).not.toContain("Đã xuất video");
  });

  it("sanitizes scaffold errors to never leak raw filesystem paths or provider secrets", () => {
    expect(safeScaffoldErrorMessage("Không thể khởi tạo Remotion project template."))
      .toBe("Không thể khởi tạo Remotion project template.");

    // Windows paths
    expect(safeScaffoldErrorMessage(new Error("Failed at C:\\Users\\user\\AppData\\Roaming\\secret.key")))
      .toBe("Không thể khởi tạo dự án MotionReal. Vui lòng thử lại.");

    // POSIX paths
    expect(safeScaffoldErrorMessage(new Error("ENOENT /var/run/secret/token")))
      .toBe("Không thể khởi tạo dự án MotionReal. Vui lòng thử lại.");

    // Secrets, tokens, keys
    expect(safeScaffoldErrorMessage("Invalid provider token or api key provided"))
      .toBe("Không thể khởi tạo dự án MotionReal. Vui lòng thử lại.");

    // Null or undefined
    expect(safeScaffoldErrorMessage(null))
      .toBe("Không thể khởi tạo dự án MotionReal. Vui lòng thử lại.");
  });

  it("catches render errors in AgentErrorBoundary and renders fallback with recovery button", () => {
    const errorState = AgentErrorBoundary.getDerivedStateFromError(new Error("Lỗi render bất ngờ"));
    expect(errorState.error.message).toBe("Lỗi render bất ngờ");

    const boundary = new AgentErrorBoundary({ children: null });
    boundary.state = { error: new Error("Crash giao diện") };
    const html = renderToStaticMarkup(boundary.render() as React.ReactElement);

    expect(html).toContain("Đã xảy ra sự cố giao diện");
    expect(html).toContain("Crash giao diện");
    expect(html).toContain("Thử lại giao diện");

    let resetCalled = false;
    const boundaryWithReset = new AgentErrorBoundary({ onReset: () => { resetCalled = true; }, children: null });
    boundaryWithReset.state = { error: new Error("Crash giao diện") };
    boundaryWithReset.reset();
    expect(resetCalled).toBe(true);
    expect(boundaryWithReset.state.error).toBeNull();
  });
});
