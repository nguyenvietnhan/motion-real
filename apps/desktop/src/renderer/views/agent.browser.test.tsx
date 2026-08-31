import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentBriefVM, AgentDraftVM, AgentSettingsVM, BgmTrackVM } from "../../shared/types.js";
import "../theme.css";
import { AgentLibrary, AgentNameDialog, AgentSettingsDialog, AgentWorkspace } from "./agent.js";

const draft: AgentDraftVM = {
  id: "agent-1",
  title: "Gemini là gì",
  createdAt: "2026-08-29T10:00:00.000Z",
  updatedAt: "2026-08-29T11:00:00.000Z",
  workflowVersion: 2,
  workflowRevision: 0,
  productionState: "discovery",
  sessionAccess: "full",
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
      currentAccessId: "danger-full-access",
      accessOptions: [
        { id: "read-only", label: "Chỉ đọc", requiresConfirmation: false },
        { id: "danger-full-access", label: "Toàn quyền", requiresConfirmation: true },
      ],
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
        onAccess={() => undefined}
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
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    valueSetter?.call(feedback, "Thêm ví dụ thực tế");
    await act(async () => {
      feedback!.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "Thêm ví dụ thực tế" }));
    });
    expect(document.querySelector<HTMLButtonElement>(".ns-agent-brief-feedback + button")?.disabled).toBe(false);
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

  it("opens the native chat from a pending-interaction progress screen", async () => {
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

    expect(document.querySelector('[aria-label="Tiến trình Video Agent"]')?.textContent)
      .toContain("Agent cần bạn phản hồi");
    const openChat = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Mở chat"));
    await act(async () => openChat?.click());
    expect(document.querySelector('[aria-label="Tiến trình Video Agent"]')).toBeNull();
    expect(document.querySelector<HTMLIFrameElement>(".ns-agent-frame")?.title)
      .toBe("MotionReal Agent — Gemini là gì");
  });
});
