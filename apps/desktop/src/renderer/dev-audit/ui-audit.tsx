import React from "react";
import { createRoot } from "react-dom/client";
import type { DashboardApi } from "../../shared/ipc-contract.js";
import { defaultSettings } from "../../shared/settings-model.js";
import type { AiAccountState, ProjectCardVM } from "../../shared/types.js";
import { Sidebar } from "../views/sidebar.js";
import { HomeView } from "../views/home.js";
import { ProjectsView } from "../views/projects.js";
import { SettingsView } from "../views/settings.js";
import { QueueView } from "../views/queue.js";
import { StoryboardView } from "../views/storyboard.js";
import { ProjectWorkspaceView } from "../views/workspace.js";
import { AgentView, AgentWorkspace, AgentSettingsDialog } from "../views/agent.js";
import { NotificationProvider } from "../notifications.js";
import "../theme.css";

const account: AiAccountState = { kind: "connected", accounts: [{ provider: "kiro", label: "nhan@example.com", active: true }], selectedModel: { id: "kr/claude-sonnet", label: "Claude Sonnet" } };
const cards: ProjectCardVM[] = Array.from({ length: 8 }, (_, index) => ({
  projectId: `p${index + 1}`,
  title: ["AI tự điều khiển chó robot nhanh gấp 20 lần", "4 gã khổng lồ AI gom sạch 188 tỷ USD", "Tại sao mô hình nhỏ đang thắng", "Xu hướng công nghệ đáng chú ý tuần này"][index % 4]!,
  thumbnailPath: "/dev-audit/audit-fixture.svg",
  format: index % 2 === 0 ? "tiktok" : "tiktok",
  status: (["done", "draft-ready", "building", "error"] as const)[index % 4]!,
  createdAtLabel: `${19 - index}/06/2026`,
}));
const screen = new URLSearchParams(window.location.search).get("screen") ?? "home";
const settingsTab = new URLSearchParams(window.location.search).get("tab") === "build" ? "build" : "ai";
const auditQueue = {
  id: "queue-audit",
  title: "project-1",
  createdAt: "2026-08-09T00:00:00.000Z",
  jobs: [
    { id: "job-1", raw: "Video về robot hình người trong nhà máy", durationTier: 1 as const, videoLanguage: "vi" as const, voiceProvider: "vivibe" as const, bgm: null, status: "queued" as const, createdAt: "2026-08-09T00:00:00.000Z", displayTitle: "Robot hình người" },
  ],
};

const mockDraft: import("../../shared/types.js").AgentDraftVM = {
  id: "draft-audit-1",
  title: "Đột phá mới trong công nghệ pin lượng tử",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  workflowVersion: 2,
  productionState: "brief_review",
  workflowRevision: 1,
  sessionAccess: "full",
  webSearchConfigured: true,
  searchProvider: "deepseek",
  createReady: true,
  briefReview: {
    revision: 1,
    title: "Đột phá mới trong công nghệ pin lượng tử",
    prompt: "# Đột phá Pin Lượng Tử 2026\n\n## Cảnh 1: Giới thiệu bước ngoặt năng lượng\nPin lượng tử thế hệ mới đạt mật độ năng lượng gấp 5 lần pin lithium thông thường.\n\n## Cảnh 2: Ứng dụng thực tế\nXe điện có thể chạy hơn 2000km chỉ với 1 lần sạc 10 phút.\n\n## Cảnh 3: Tương lai và tác động\nCác hãng xe hàng đầu thế giới đang chuẩn bị thương mại hóa vào năm 2027.",
    selectedAssetIds: ["asset-1", "asset-2"],
    format: "tiktok",
    videoLanguage: "vi",
  },
  assetReview: [
    {
      id: "asset-1",
      previewUrl: "/dev-audit/audit-fixture.svg",
      width: 1080,
      height: 1920,
      bytes: 1024,
      sourceUrl: "https://example.com/battery.png",
      label: "Pin lượng tử phòng thí nghiệm",
      role: "hero",
    },
    {
      id: "asset-2",
      previewUrl: "/dev-audit/audit-fixture.svg",
      width: 1080,
      height: 1920,
      bytes: 1024,
      sourceUrl: "https://example.com/car.png",
      label: "Xe điện thử nghiệm",
      role: "support",
    },
  ],
};

const auditSettings = {
  searchProvider: "deepseek" as const,
  webSearchConfigured: true,
  currentModelId: "deepseek-chat",
  modelOptions: [
    { id: "deepseek-chat", label: "DeepSeek V3 (Khuyên dùng)" },
    { id: "deepseek-reasoner", label: "DeepSeek R1 (Lý luận sâu)" },
  ],
  currentAccessId: "danger-full-access",
  accessOptions: [
    { id: "danger-full-access", label: "Toàn quyền (Terminal & Tệp)", description: "Agent có thể chạy lệnh terminal và tạo sửa tệp tự do.", requiresConfirmation: true },
    { id: "workspace-write", label: "Chỉ ghi tệp trong workspace", description: "Agent chỉ được sửa tệp trong thư mục dự án.", requiresConfirmation: false },
  ],
};

const auditDashboard = {
  ai: {
    gatewayState: async () => ({ kind: "ready" as const, baseUrl: "http://127.0.0.1:20128" }),
    listProviders: async () => [],
    connectedAccounts: async () => account,
    beginConnect: async () => ({ loginSurface: "external-browser" as const }),
    listModels: async () => [],
    selectModel: async () => account,
    selectedModel: async () => account.selectedModel,
  },
  agent: {
    list: async () => [mockDraft],
    createDraft: async () => mockDraft,
    openDraft: async () => mockDraft,
    openProject: async () => mockDraft,
    status: async () => mockDraft,
    renameDraft: async () => mockDraft,
    settings: async () => auditSettings,
    selectModel: async () => auditSettings,
    setAccess: async () => auditSettings,
    setSearchApiKey: async () => mockDraft,
    setSearchProvider: async () => {},
    prepareAssets: async () => mockDraft,
    requestMoreAssets: async () => mockDraft,
    approveAssets: async () => mockDraft,
    prepareBrief: async () => mockDraft,
    requestBriefChanges: async () => mockDraft,
    pauseWorkflow: async () => mockDraft,
    resumeWorkflow: async () => mockDraft,
    retryWorkflow: async () => mockDraft,
    returnToAssets: async () => mockDraft,
    approveBrief: async () => mockDraft,
    createVideo: async () => ({ projectId: "project-audit" }),
    deleteDraft: async () => {},
  },
  projects: {
    pickImages: async () => ({ staged: [], rejected: [] }),
    importImageBytes: async () => ({ staged: [], rejected: [] }),
    removeStagedImage: async () => {},
    create: async () => ({ kind: "started" as const, projectId: "project-audit" }),
    list: async () => cards,
    open: async () => ({ projectId: "project-audit", globalNotes: "", scenes: [] }),
    stage: async () => ({ kind: "ready" as const, scenes: [] }),
    rename: async () => "Tên mới",
    delete: async () => {},
    reveal: async () => {},
    save: async () => ({ saved: false }),
    cancel: async () => {},
    retry: async () => {},
    fixWithAi: async () => {},
    submitImageReview: async () => {},
    diagnostics: async () => ({ projectId: "project-audit", truncated: false, entries: [] }),
  },
  bgm: {
    list: async () => [],
    add: async () => [],
    remove: async () => [],
    getForProject: async () => null,
    setForProject: async () => {},
  },
  thumbnail: {
    generate: async () => null,
    save: async () => ({ saved: false }),
  },
  script: {
    get: async () => ({ projectId: "project-audit", enabled: false, scenes: [] }),
    applyEdits: async () => ({ ok: true }),
    approve: async () => {},
    setEnabled: async () => {},
  },
  review: {
    submitEdits: async () => ({ ok: true, revision: 1 }),
    approveDraft: async () => ({ ok: true, outputPath: "" }),
  },
  settings: {
    get: async () => defaultSettings(""),
    update: async () => defaultSettings(""),
    readiness: async () => ({ ok: false, checks: [] }),
    renderSmoke: async () => ({ ok: false as const, error: "Không chạy audit render." }),
  },
  queue: {
    list: async () => [],
    get: async () => null,
    create: async () => auditQueue,
    delete: async () => true,
    rename: async () => auditQueue,
    addJob: async () => auditQueue,
    updateJob: async () => auditQueue,
    deleteJob: async () => auditQueue,
    cancelJob: async () => ({ ok: true as const }),
    start: async () => ({ ok: false as const, code: "FULL_AUTO_REQUIRED" as const, error: "Không chạy audit queue." }),
    pause: async () => ({ ok: true as const }),
    resume: async () => ({ ok: false as const, code: "FULL_AUTO_REQUIRED" as const, error: "Không chạy audit queue." }),
    status: async () => ({ busy: false, activeQueueId: null, pendingQueueIds: [] }),
    recover: async () => false,
  },
  tts: {
    setApiKey: async () => defaultSettings(""),
    clearApiKey: async () => defaultSettings(""),
    testVoice: async () => ({
      ok: false,
      error: "Không chạy audit giọng.",
      voiceFailure: { provider: "vivibe", code: "not_configured", retryable: false },
    }),
  },
  events: {
    onProgress: () => () => {},
    onStatus: () => () => {},
    onScene: () => () => {},
    onFriendlyError: () => () => {},
  },
} satisfies DashboardApi;

if (typeof window !== "undefined" && !window.dashboard) {
  window.dashboard = auditDashboard;
}

const content = screen === "projects" ? (
  <ProjectsView load="populated" cards={cards} onOpen={() => {}} onNew={() => {}} onDelete={() => {}} onReveal={() => {}} onRename={() => {}} />
) : screen === "settings" ? (
  <SettingsView gateway={{ kind: "ready", baseUrl: "http://127.0.0.1:20128" }} account={account} models={[{ id: "kr/claude-sonnet", label: "Claude Sonnet" }, { id: "kr/gemini-pro", label: "Gemini Pro" }]} settings={defaultSettings("")} tab={settingsTab} onTabChange={() => {}} onManageAccounts={() => {}} onSelectModel={() => {}} onUpdate={() => {}} onSetApiKey={async () => defaultSettings("")} onClearApiKey={async () => defaultSettings("")} onTestVoice={async () => ({ ok: false, error: "Chưa cấu hình", voiceFailure: { provider: "vivibe", code: "not_configured", retryable: false } })} />
) : screen === "queue" ? (
  <QueueView
    queues={[auditQueue]}
    active={auditQueue}
    load="ready"
    defaultVoiceProvider="vivibe"
    defaultDurationTier={2}
    bgm={[]}
    bgmSelected={null}
    onBgmAdd={() => {}}
    onBgmRemove={async () => {}}
    onBgmSelect={() => {}}
    onPickImages={async () => ({ staged: [], rejected: [] })}
    onImportImageBytes={async () => ({ staged: [], rejected: [] })}
    onRefresh={() => {}}
    onCreateQueue={async () => {}}
    onOpenQueue={() => {}}
    onDeleteQueue={() => {}}
    onRenameQueue={async () => {}}
    onBackToList={() => {}}
    onAddJob={async () => {}}
    onUpdateJob={async () => {}}
    onDeleteJob={async () => {}}
    onCancelJob={async () => {}}
    onStartQueue={async () => ({ ok: false, code: "FULL_AUTO_REQUIRED", error: "Hàng đợi yêu cầu Full auto." })}
    onEnableFullAutoAndStart={async () => ({ ok: true, mode: "started" })}
    onPauseQueue={async () => ({ ok: true })}
    onResumeQueue={async () => ({ ok: true, mode: "started" })}
    onOpenVoiceSettings={() => {}}
  />
) : screen === "agent-brief" ? (
  <AgentWorkspace
    draft={mockDraft}
    reviewMode="stills_edit"
    defaultDurationTier={2}
    defaultVoiceProvider="vivibe"
    busy={false}
    notice={null}
    onBack={() => {}}
    onDraftChange={() => {}}
    run={async (fn) => {
      await fn();
    }}
  />
) : screen === "agent-settings" ? (
  <div style={{ position: "relative", width: "100%", height: "100%" }}>
    <AgentWorkspace
      draft={mockDraft}
      reviewMode="stills_edit"
      defaultDurationTier={2}
      defaultVoiceProvider="vivibe"
      busy={false}
      notice={null}
      onBack={() => {}}
      onDraftChange={() => {}}
      run={async (fn) => {
        await fn();
      }}
    />
    <AgentSettingsDialog
      open={true}
      busy={false}
      error={null}
      searchApiKey="sk-deepseek-mock-key-12345"
      onSearchApiKeyChange={() => {}}
      onClose={() => {}}
      onSearchProvider={() => {}}
      onSaveSearchKey={() => {}}
      onModel={() => {}}
      onAccess={() => {}}
      settings={{
        searchProvider: "deepseek",
        webSearchConfigured: true,
        currentModelId: "deepseek-chat",
        modelOptions: [
          { id: "deepseek-chat", label: "DeepSeek V3 (Khuyên dùng)" },
          { id: "deepseek-reasoner", label: "DeepSeek R1 (Lý luận sâu)" },
        ],
        currentAccessId: "danger-full-access",
        accessOptions: [
          { id: "danger-full-access", label: "Toàn quyền (Terminal & Tệp)", description: "Agent có thể chạy lệnh terminal và tạo sửa tệp tự do.", requiresConfirmation: true },
          { id: "workspace-write", label: "Chỉ ghi tệp trong workspace", description: "Agent chỉ được sửa tệp trong thư mục dự án.", requiresConfirmation: false },
        ],
      }}
    />
  </div>
) : screen === "error" ? (
  <ProjectWorkspaceView
    stage={{ kind: "error", message: "Model tạm thời không phản hồi (đang khởi động). Vui lòng thử lại sau ít phút hoặc đổi model.", fixable: false }}
    projectId="project-audit"
    onBack={() => {}}
    onRetry={() => {}}
    onFixWithAi={() => {}}
    onApplyScript={() => {}}
    onApproveScript={() => {}}
    onSubmitEdits={async () => true}
    onApproveDraft={() => {}}
    onReveal={() => {}}
    onSave={() => {}}
    onCancel={() => {}}
    onSubmitImageReview={() => {}}
    onGenerateThumbnail={async () => null}
    onSaveThumbnail={async () => ({ saved: false })}
    loadDiagnostics={async () => ({ projectId: "project-audit", truncated: false, entries: [] })}
  />
) : screen === "published" ? (
  <ProjectWorkspaceView stage={{ kind: "published", outputPath: "/audit-output.mp4", title: cards[0]!.title, hashtags: ["#AI", "#Robotics", "#Technology"], thumbnailPath: "/dev-audit/audit-fixture.svg", format: "tiktok" }} onBack={() => {}} onRetry={() => {}} onFixWithAi={() => {}} onApplyScript={() => {}} onApproveScript={() => {}} onSubmitEdits={async () => true} onApproveDraft={() => {}} onReveal={() => {}} onSave={() => {}} onCancel={() => {}} onSubmitImageReview={() => {}} onGenerateThumbnail={async () => ({ thumbnailUrl: "/dev-audit/audit-fixture.svg" })} onSaveThumbnail={async () => ({ saved: true })} />
) : screen === "storyboard" ? (
  <StoryboardView model={{ projectId: "p1", globalNotes: "", scenes: Array.from({ length: 5 }, (_, index) => ({ sceneId: `scene-0${index + 1}`, order: index + 1, stillPath: "/dev-audit/audit-fixture.svg", editText: "" })) }} canApprove onBack={() => {}} onSubmit={async () => true} onApprove={() => {}} />
) : (
  <HomeView
    gateway={{ kind: "ready", baseUrl: "http://127.0.0.1:20128" }}
    account={account}
    voiceCredentials={{ vivibe: "saved", elevenlabs: "missing" }}
    vivibeVoiceId="audit-voice"
    load="populated"
    cards={cards}
    defaultVoiceProvider="vivibe"
    defaultDurationTier={2}
    onCreate={() => {}}
    onOpen={() => {}}
    onConnectPrompt={() => {}}
    onPickImages={async () => ({ staged: [], rejected: [] })}
    onImportImageBytes={async () => ({ staged: [], rejected: [] })}
    onDelete={() => {}}
    onReveal={() => {}}
    onRename={() => {}}
  />
);

createRoot(document.getElementById("root")!).render(
  <NotificationProvider>
    <div className="ns-shell">
      <Sidebar active={screen === "projects" ? "projects" : screen.startsWith("settings") ? "settings" : screen === "queue" ? "queue" : screen.startsWith("agent") ? "agent" : "home"} gateway={{ kind: "ready", baseUrl: "http://127.0.0.1:20128" }} account={account} onNavigate={() => {}} />
      <main className="ns-main">{content}</main>
    </div>
  </NotificationProvider>,
);
