import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardApi } from "../../shared/ipc-contract.js";
import type { AgentAssetVM, AgentBriefVM, AgentDraftVM, AgentSettingsVM, BgmTrackVM, ReviewMode } from "../../shared/types.js";
import "../theme.css";
import { AgentErrorBoundary, AgentLibrary, AgentNameDialog, AgentSettingsDialog, AgentWorkspace } from "./agent.js";

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

let root: Root | null = null;
let host: HTMLDivElement | null = null;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(node: React.ReactNode): Promise<void> {
  host = document.createElement("div");
  host.style.cssText = "display: flex; height: 640px;";
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(node);
  });
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("Video Agent browser smoke", () => {
  it("opens the project-row menu without turning the whole row into a button", async () => {
    await mount(
      <AgentLibrary
        drafts={[draft]}
        loading={false}
        busy={false}
        notice={null}
        onCreate={() => undefined}
        onOpen={() => undefined}
        onRename={() => undefined}
        onDelete={() => undefined}
      />,
    );

    const menuButton = document.querySelector<HTMLButtonElement>('[aria-label="Tùy chọn Gemini là gì"]');
    expect(menuButton).not.toBeNull();
    await act(async () => menuButton?.click());
    expect(document.body.textContent).toContain("Đổi tên");
    expect(document.body.textContent).toContain("Xóa");
    expect(menuButton?.closest("button")?.className).toContain("ns-agent-row-menu-trigger");
  });

  it("keeps the create dialog focused, dismissible, and inside the viewport", async () => {
    let closed = 0;
    await mount(
      <AgentNameDialog
        open
        title="Tạo video mới"
        confirmLabel="Tạo workspace"
        initialValue=""
        busy={false}
        onCancel={() => { closed += 1; }}
        onConfirm={() => undefined}
      />,
    );

    const dialog = document.querySelector<HTMLElement>(".ns-agent-name-dialog");
    const input = document.querySelector<HTMLInputElement>("#agent-name-input");
    expect(dialog).not.toBeNull();
    expect(document.activeElement).toBe(input);
    const bounds = dialog!.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(closed).toBe(1);
  });

  it("keeps Agent settings cards inside a scrollable dialog", async () => {
    const settings: AgentSettingsVM = {
      searchProvider: "exa",
      webSearchConfigured: true,
      currentModelId: "model-a",
      modelOptions: [{ id: "model-a", label: "Model A" }],
    };
    await mount(
      <AgentSettingsDialog
        open
        busy={false}
        settings={settings}
        error={null}
        searchApiKey=""
        onSearchApiKeyChange={() => undefined}
        onClose={() => undefined}
        onSearchProvider={() => undefined}
        onSaveSearchKey={() => undefined}
        onModel={() => undefined}
      />,
    );

    const dialog = document.querySelector<HTMLElement>(".ns-agent-settings-dialog");
    expect(dialog).not.toBeNull();
    expect(getComputedStyle(dialog!).overflowY).toBe("auto");
    const bounds = dialog!.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
  });

  it("shows markdown brief review in its own scroll surface and accepts feedback input", async () => {
    const brief: AgentBriefVM = {
      revision: 1,
      title: "Gemini là gì",
      format: "tiktok",
      videoLanguage: "vi",
      selectedAssetIds: [],
      prompt: ["# Tổng quan", ...Array.from({ length: 90 }, (_, index) => `- Ý chính ${index + 1}`)].join("\n"),
    };
    const bgm: BgmTrackVM[] = [{
      name: "motionreal-default.mp3",
      label: "MotionReal mặc định",
      sizeLabel: "2 MB",
      previewUrl: "media://bgm/default",
      builtIn: true,
    }];
    await mount(
      <AgentWorkspace
        draft={{ ...draft, productionState: "brief_review", briefReview: brief }}
        reviewMode="stills_edit"
        busy={false}
        notice={null}
        onBack={() => undefined}
        onDraftChange={() => undefined}
        run={async (work) => work()}
        bgm={bgm}
        defaultBgm="motionreal-default.mp3"
        onAddBgm={() => undefined}
        onRemoveBgm={async () => undefined}
      />,
    );

    const review = document.querySelector<HTMLElement>(".ns-agent-brief-review");
    const feedback = document.querySelector<HTMLTextAreaElement>("#agent-brief-feedback");
    expect(review?.textContent).toContain("Tổng quan");
    expect(getComputedStyle(review!).overflowY).toBe("auto");
    expect(review!.scrollHeight).toBeGreaterThan(review!.clientHeight);
    expect(document.querySelector<HTMLButtonElement>('[title="Nhạc nền"]')?.textContent)
      .toContain("MotionReal mặc định");
    expect(document.querySelector<HTMLButtonElement>('[title="Ưu tiên hình ảnh"]')?.textContent)
      .toContain("Cân bằng");
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    valueSetter?.call(feedback, "Thêm ví dụ thực tế");
    await act(async () => {
      feedback!.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "Thêm ví dụ thực tế" }));
    });
    expect(document.querySelector<HTMLButtonElement>(".ns-agent-brief-feedback + button")?.disabled).toBe(false);
  });

  it("shows an Agent-proposed asset role while the user keeps final selection authority", async () => {
    const asset: AgentAssetVM = {
      id: "asset-logo",
      previewUrl: "media://asset-logo",
      sourceUrl: "https://example.com/logo.png",
      label: "Logo sản phẩm",
      role: "logo",
      width: 512,
      height: 512,
      bytes: 1024,
    };
    await mount(
      <AgentWorkspace
        draft={{ ...draft, productionState: "asset_review", assetReview: [asset] }}
        reviewMode="stills_edit"
        busy={false}
        notice={null}
        onBack={() => undefined}
        onDraftChange={() => undefined}
        run={async (work) => work()}
      />,
    );

    expect(document.querySelector(".ns-image-review-help")?.textContent).toContain("bạn vẫn quyết định giữ hoặc bỏ");
    expect(document.querySelector(".ns-image-tile-badge")?.textContent).toBe("Logo · Agent đề xuất");
  });

  it("keeps the native chat as a sandboxed embedded surface", async () => {
    await mount(
      <AgentWorkspace
        draft={draft}
        reviewMode="stills_edit"
        busy={false}
        notice={null}
        onBack={() => undefined}
        onDraftChange={() => undefined}
        run={async (work) => work()}
      />,
    );

    const frame = document.querySelector<HTMLIFrameElement>(".ns-agent-frame");
    expect(frame?.title).toBe("MotionReal Agent — Gemini là gì");
    expect(frame?.sandbox.contains("allow-scripts")).toBe(true);
    expect(frame?.sandbox.contains("allow-forms")).toBe(true);
    expect(frame?.allow).toBe("clipboard-write");
  });

  it("automatically opens the native chat when Harness needs an interaction", async () => {
    await mount(
      <AgentWorkspace
        draft={{
          ...draft,
          productionState: "queued_create",
          needsAttention: true,
          activities: [{ id: "activity-1", label: "Agent đang chờ phản hồi", status: "running" }],
        }}
        reviewMode="stills_edit"
        busy={false}
        notice={null}
        onBack={() => undefined}
        onDraftChange={() => undefined}
        run={async (work) => work()}
      />,
    );

    expect(document.querySelector('[aria-label="Tiến trình Video Agent"]')).toBeNull();
    expect(document.body.textContent).toContain("Đang mở chat để bạn phản hồi Agent.");
    expect(document.querySelector<HTMLIFrameElement>(".ns-agent-frame")?.title)
      .toBe("MotionReal Agent — Gemini là gì");
  });

  it("refreshes the durable draft state when project creation fails", async () => {
    const failed = {
      ...draft,
      workflowRevision: 8,
      productionState: "error" as const,
      projectId: "project-1",
      lastError: "AI trả visual plan JSON không đọc được.",
      retryAction: "retry_workflow" as const,
    };
    const changed: AgentDraftVM[] = [];
    const previousDashboard = window.dashboard;
    window.dashboard = {
      agent: {
        createVideo: async () => { throw new Error(failed.lastError); },
        status: async () => failed,
      },
    } as unknown as DashboardApi;

    try {
      await mount(
        <AgentWorkspace
          draft={{ ...draft, productionState: "queued_create", createReady: true }}
          reviewMode="stills_edit"
          busy={false}
          notice={null}
          onBack={() => undefined}
          onDraftChange={(next) => changed.push(next)}
          run={async (work) => work()}
        />,
      );

      const start = [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.includes("Bắt đầu dựng"));
      await act(async () => start?.click());
      expect(changed.at(-1)).toEqual(failed);
    } finally {
      window.dashboard = previousDashboard;
    }
  });

  it("keeps pre-review Agent errors in the Agent surface and retries the Agent phase", async () => {
    const failed: AgentDraftVM = {
      ...draft,
      workflowRevision: 9,
      productionState: "error",
      projectId: "project-1",
      lastError: "Kế hoạch nội dung chưa đúng contract.",
    };
    const resumed: AgentDraftVM = { ...failed, workflowRevision: 10, productionState: "authoring", lastError: undefined };
    let agentRetries = 0;
    let projectRetries = 0;
    const previousDashboard = window.dashboard;
    window.dashboard = {
      agent: {
        retryWorkflow: async () => {
          agentRetries += 1;
          return resumed;
        },
      },
      projects: {
        stage: async () => ({ kind: "error", message: "Project stage cũ", fixable: false, retry: "draft" }),
        retry: async () => { projectRetries += 1; },
      },
      events: {
        onProgress: () => () => undefined,
        onStatus: () => () => undefined,
      },
    } as unknown as DashboardApi;

    try {
      const changed: AgentDraftVM[] = [];
      await mount(
        <AgentWorkspace
          draft={failed}
          reviewMode="stills_edit"
          busy={false}
          notice={null}
          onBack={() => undefined}
          onDraftChange={(next) => changed.push(next)}
          run={async (work) => work()}
        />,
      );
      await act(async () => Promise.resolve());

      expect(document.body.textContent).toContain(failed.lastError);
      expect(document.body.textContent).not.toContain("Project stage cũ");
      // Strict error boundary: linked project error NEVER exposes pre-project escape
      expect(document.body.textContent).not.toContain("Quay lại trao đổi");
      expect(document.querySelector(".ns-agent-workspace-bar.is-error")).not.toBeNull();
      expect(document.querySelector("iframe")).toBeNull();
      expect(document.querySelector(".ns-agent-placeholder")).toBeNull();

      const retry = [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.includes("Thử lại bước này"));
      await act(async () => retry?.click());
      expect(agentRetries).toBe(1);
      expect(projectRetries).toBe(0);
      expect(changed.at(-1)).toEqual(resumed);
    } finally {
      window.dashboard = previousDashboard;
    }
  });

  it("shows 'Thử render ảnh' recovery action for linked-project error with rerender_stills", async () => {
    const rerenderDraft: AgentDraftVM = {
      ...draft,
      workflowRevision: 9,
      productionState: "error",
      projectId: "project-1",
      lastError: "Ảnh render bị lỗi.",
      retryAction: "rerender_stills",
    };
    let agentRetries = 0;
    const previousDashboard = window.dashboard;
    window.dashboard = {
      agent: {
        retryWorkflow: async () => {
          agentRetries += 1;
          return { ...rerenderDraft, productionState: "visual_refine", lastError: undefined };
        },
      },
      projects: {
        stage: async () => ({ kind: "error", message: "Stage lỗi", fixable: false, retry: "draft" }),
      },
      events: {
        onProgress: () => () => undefined,
        onStatus: () => () => undefined,
      },
    } as unknown as DashboardApi;

    try {
      await mount(
        <AgentWorkspace
          draft={rerenderDraft}
          reviewMode="stills_edit"
          busy={false}
          notice={null}
          onBack={() => undefined}
          onDraftChange={() => undefined}
          run={async (work) => work()}
        />,
      );
      await act(async () => Promise.resolve());

      expect(document.body.textContent).toContain(rerenderDraft.lastError);
      expect(document.body.textContent).not.toContain("Quay lại trao đổi");
      const retryBtn = [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((b) => b.textContent?.includes("Thử render ảnh"));
      expect(retryBtn).toBeDefined();
      await act(async () => retryBtn?.click());
      expect(agentRetries).toBe(1);
    } finally {
      window.dashboard = previousDashboard;
    }
  });

  it("escapes pre-project error by invoking returnToDiscovery", async () => {
    const failedPreProject: AgentDraftVM = {
      ...draft,
      workflowRevision: 5,
      productionState: "error",
      lastError: "Visual plan lỗi cú pháp.",
    };
    const discoveryDraft: AgentDraftVM = {
      ...failedPreProject,
      workflowRevision: 6,
      productionState: "discovery",
      lastError: undefined,
    };
    let returnedDraftId = "";
    let returnedRevision = -1;
    const changed: AgentDraftVM[] = [];
    const previousDashboard = window.dashboard;
    window.dashboard = {
      agent: {
        returnToDiscovery: async (draftId: string, revision: number) => {
          returnedDraftId = draftId;
          returnedRevision = revision;
          return discoveryDraft;
        },
      },
      events: {
        onProgress: () => () => undefined,
        onStatus: () => () => undefined,
      },
    } as unknown as DashboardApi;

    try {
      await mount(
        <AgentWorkspace
          draft={failedPreProject}
          reviewMode="stills_edit"
          busy={false}
          notice={null}
          onBack={() => undefined}
          onDraftChange={(next) => changed.push(next)}
          run={async (work) => work()}
        />,
      );

      expect(document.body.textContent).toContain("Quay lại trao đổi");
      // Header actions must only contain retry action and settings, NOT a duplicate escape button
      const headerActions = document.querySelector(".ns-agent-workspace-actions");
      expect(headerActions?.textContent).toContain("Thử lại bước này");
      expect(headerActions?.textContent).not.toContain("Quay lại trao đổi");
      expect(document.querySelector(".ns-agent-workspace-bar.is-error")).not.toBeNull();
      expect(document.querySelector("iframe")).toBeNull();
      expect(document.querySelector(".ns-agent-placeholder")).toBeNull();

      const escapeBtn = [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.includes("Quay lại trao đổi"));
      expect(escapeBtn).toBeDefined();
      await act(async () => escapeBtn?.click());
      expect(returnedDraftId).toBe(failedPreProject.id);
      expect(returnedRevision).toBe(failedPreProject.workflowRevision);
      expect(changed.at(-1)).toEqual(discoveryDraft);
    } finally {
      window.dashboard = previousDashboard;
    }
  });

  it("shows visible scaffold error card and retry action when createVideo fails", async () => {
    const failedCreateDraft: AgentDraftVM = {
      ...draft,
      workflowRevision: 7,
      productionState: "queued_create",
      createReady: true,
    };
    let createAttempts = 0;
    const previousDashboard = window.dashboard;
    window.dashboard = {
      agent: {
        createVideo: async () => {
          createAttempts += 1;
          throw new Error("Không thể khởi tạo Remotion project template.");
        },
        status: async () => failedCreateDraft,
      },
      events: {
        onProgress: () => () => undefined,
        onStatus: () => () => undefined,
      },
    } as unknown as DashboardApi;

    try {
      await mount(
        <AgentWorkspace
          draft={failedCreateDraft}
          reviewMode="stills_edit"
          busy={false}
          notice={null}
          onBack={() => undefined}
          onDraftChange={() => undefined}
          run={async (work) => {
            try {
              await work();
            } catch {
              // let workspace state handle the visible error
            }
          }}
        />,
      );

      const start = [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.includes("Bắt đầu dựng"));
      await act(async () => start?.click());
      expect(createAttempts).toBe(1);

      expect(document.body.textContent).toContain("Chưa thể tạo dự án");
      expect(document.body.textContent).toContain("Không thể khởi tạo Remotion project template.");
      expect(document.querySelector('[aria-label="Tiến trình Video Agent"]')).toBeNull();
      expect(document.querySelector("iframe")).toBeNull();
      expect(document.querySelector(".ns-agent-placeholder")).toBeNull();

      // Header actions should not duplicate card's retry action
      const headerActions = document.querySelector(".ns-agent-workspace-actions");
      expect(headerActions?.textContent).not.toContain("Thử bắt đầu dựng");

      const retryBtn = [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.includes("Thử bắt đầu dựng"));
      expect(retryBtn).toBeDefined();
      await act(async () => retryBtn?.click());
      expect(createAttempts).toBe(2);
    } finally {
      window.dashboard = previousDashboard;
    }
  });

  it("displays still preparation subphase progress during authoring", async () => {
    const authoringDraft: AgentDraftVM = {
      ...draft,
      workflowRevision: 11,
      productionState: "authoring",
      projectId: "project-1",
    };
    const previousDashboard = window.dashboard;
    window.dashboard = {
      agent: {
        status: async () => authoringDraft,
      },
      projects: {
        stage: async () => ({ kind: "rendering", percent: 45, phase: "prepare" }),
      },
      events: {
        onProgress: () => () => undefined,
        onStatus: () => () => undefined,
      },
    } as unknown as DashboardApi;

    try {
      await mount(
        <AgentWorkspace
          draft={authoringDraft}
          reviewMode="stills_edit"
          busy={false}
          notice={null}
          onBack={() => undefined}
          onDraftChange={() => undefined}
          run={async (work) => work()}
        />,
      );
      await act(async () => Promise.resolve());

      expect(document.body.textContent).toContain("Đang chuẩn bị ảnh xem trước…");
      expect(document.body.textContent).toContain("Duyệt ảnh tĩnh");
    } finally {
      window.dashboard = previousDashboard;
    }
  });

  it("preserves draft identity across async create rejection when switching drafts", async () => {
    const draftA: AgentDraftVM = {
      ...draft,
      id: "agent-A",
      title: "Video A",
      workflowRevision: 1,
      productionState: "queued_create",
      createReady: true,
    };
    const draftB: AgentDraftVM = {
      ...draft,
      id: "agent-B",
      title: "Video B",
      workflowRevision: 1,
      productionState: "discovery",
      createReady: false,
    };

    let rejectCreateA!: (reason: Error) => void;
    const createAPromise = new Promise<{ projectId: string }>((_, reject) => {
      rejectCreateA = reject;
    });

    const previousDashboard = window.dashboard;
    window.dashboard = {
      agent: {
        createVideo: async (draftId: string) => {
          if (draftId === "agent-A") return createAPromise;
          return { projectId: "proj-B" };
        },
        status: async (draftId: string) => (draftId === "agent-A" ? draftA : draftB),
      },
      events: {
        onProgress: () => () => undefined,
        onStatus: () => () => undefined,
      },
    } as unknown as DashboardApi;

    try {
      let setDraftState!: React.Dispatch<React.SetStateAction<AgentDraftVM>>;
      const changed: AgentDraftVM[] = [];
      const onDraftChange = (next: AgentDraftVM) => changed.push(next);

      function Host() {
        const [current, setCurrent] = React.useState(draftA);
        setDraftState = setCurrent;
        return (
          <AgentWorkspace
            draft={current}
            reviewMode="stills_edit"
            busy={false}
            notice={null}
            onBack={() => undefined}
            onDraftChange={onDraftChange}
            run={async (work) => {
              try {
                await work();
              } catch {
                // caught safely in test runner
              }
            }}
          />
        );
      }

      await mount(<Host />);
      expect(document.body.textContent).toContain("Video A");

      const startBtn = [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((b) => b.textContent?.includes("Bắt đầu dựng"));
      expect(startBtn).toBeDefined();

      // Trigger createVideo on draft A
      await act(async () => {
        startBtn?.click();
      });

      // Switch to draft B while draft A's createVideo is in flight
      await act(async () => {
        setDraftState(draftB);
      });

      expect(document.body.textContent).toContain("Video B");
      expect(document.body.textContent).not.toContain("Video A");

      // Now reject draft A createVideo
      await act(async () => {
        rejectCreateA(new Error("Lỗi dựng video A"));
      });

      // Draft B must remain active, showing Video B and no scaffold failure card
      expect(document.body.textContent).toContain("Video B");
      expect(document.body.textContent).not.toContain("Chưa thể tạo dự án");
      expect(document.body.textContent).not.toContain("Lỗi dựng video A");
      expect(changed.filter((d) => d.id === "agent-B")).toHaveLength(0);
    } finally {
      window.dashboard = previousDashboard;
    }
  });

  it("ensures Agent paused authority wins over stale project stage in workspace header", async () => {
    const pausedDraft: AgentDraftVM = {
      ...draft,
      workflowRevision: 12,
      productionState: "paused",
      projectId: "project-1",
    };
    const previousDashboard = window.dashboard;
    window.dashboard = {
      agent: {
        status: async () => pausedDraft,
      },
      projects: {
        stage: async () => ({ kind: "published", outputPath: "media://old.mp4" }),
      },
      events: {
        onProgress: () => () => undefined,
        onStatus: () => () => undefined,
      },
    } as unknown as DashboardApi;

    try {
      await mount(
        <AgentWorkspace
          draft={pausedDraft}
          reviewMode="stills_edit"
          busy={false}
          notice={null}
          onBack={() => undefined}
          onDraftChange={() => undefined}
          run={async (work) => work()}
        />,
      );
      await act(async () => Promise.resolve());

      expect(document.body.textContent).toContain("Đã tạm dừng");
      expect(document.body.textContent).not.toContain("Đã xuất video");
      expect(document.querySelector(".ns-agent-workspace-bar.is-paused")).not.toBeNull();
    } finally {
      window.dashboard = previousDashboard;
    }
  });

  it("explicitly asserts all three review mode chips in AgentWorkspace header", async () => {
    const modes: Array<{ mode: ReviewMode; label: string }> = [
      { mode: "full", label: "Bản nháp & duyệt cảnh" },
      { mode: "stills_edit", label: "Duyệt ảnh tĩnh" },
      { mode: "skip_edit", label: "Tự động xuất video" },
    ];

    for (const { mode, label } of modes) {
      await mount(
        <AgentWorkspace
          draft={draft}
          reviewMode={mode}
          busy={false}
          notice={null}
          onBack={() => undefined}
          onDraftChange={() => undefined}
          run={async (work) => work()}
        />,
      );

      const chip = document.querySelector<HTMLElement>(".ns-agent-review-mode-chip");
      expect(chip).not.toBeNull();
      expect(chip?.textContent).toBe(label);
      expect(document.querySelector(".ns-agent-workspace-title")?.textContent).toContain(label);

      await act(async () => root?.unmount());
      host?.remove();
      root = null;
      host = null;
    }
  });

  it("catches rendering errors in AgentErrorBoundary and recovers cleanly on reset", async () => {
    let shouldCrash = true;
    function CrashingChild() {
      if (shouldCrash) {
        throw new Error("Mô phỏng lỗi render bất ngờ");
      }
      return <div className="ns-healthy-child">Giao diện đã phục hồi</div>;
    }

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let resetHandlerCalled = false;
      await mount(
        <AgentErrorBoundary onReset={() => { resetHandlerCalled = true; shouldCrash = false; }}>
          <CrashingChild />
        </AgentErrorBoundary>,
      );

      expect(document.body.textContent).toContain("Đã xảy ra sự cố giao diện");
      expect(document.body.textContent).toContain("Mô phỏng lỗi render bất ngờ");
      const recoveryBtn = [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((b) => b.textContent?.includes("Thử lại giao diện"));
      expect(recoveryBtn).toBeDefined();

      await act(async () => recoveryBtn?.click());
      expect(resetHandlerCalled).toBe(true);
      expect(document.body.textContent).toContain("Giao diện đã phục hồi");
      expect(document.body.textContent).not.toContain("Đã xảy ra sự cố giao diện");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
