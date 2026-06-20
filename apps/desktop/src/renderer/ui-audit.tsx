import React from "react";
import { createRoot } from "react-dom/client";
import { defaultSettings } from "../shared/settings-model.js";
import type { AiAccountState, ProjectCardVM } from "../shared/types.js";
import { Sidebar } from "./views/sidebar.js";
import { HomeView } from "./views/home.js";
import { ProjectsView } from "./views/projects.js";
import { SettingsView } from "./views/settings.js";
import { StoryboardView } from "./views/storyboard.js";
import { ProjectWorkspaceView } from "./views/workspace.js";
import "./theme.css";

const account: AiAccountState = { kind: "connected", accounts: [{ provider: "kiro", label: "nhan@example.com", active: true }], selectedModel: { id: "kr/claude-sonnet", label: "Claude Sonnet" } };
const bgmTracks = [
  { name: "nhac-nen-mac-dinh.mp3", label: "Nhạc nền mặc định", sizeLabel: "2.9 MB", previewUrl: "", builtIn: true },
  { name: "calm-news.wav", label: "calm-news.wav", sizeLabel: "820 KB", previewUrl: "", builtIn: false },
];
const cards: ProjectCardVM[] = Array.from({ length: 8 }, (_, index) => ({
  projectId: `p${index + 1}`,
  title: ["AI tự điều khiển chó robot nhanh gấp 20 lần", "4 gã khổng lồ AI gom sạch 188 tỷ USD", "Tại sao mô hình nhỏ đang thắng", "Xu hướng công nghệ đáng chú ý tuần này"][index % 4]!,
  thumbnailPath: index % 2 === 0 ? "/audit-fixture.svg" : "/audit-fixture-youtube.svg",
  format: index % 2 === 0 ? "tiktok" : "youtube",
  status: (["done", "draft-ready", "building", "error"] as const)[index % 4]!,
  createdAtLabel: `${19 - index}/06/2026`,
}));
const screen = new URLSearchParams(window.location.search).get("screen") ?? "home";

const content = screen === "projects" ? (
  <ProjectsView load="populated" cards={cards} onOpen={() => {}} onNew={() => {}} onDelete={() => {}} onReveal={() => {}} onRename={() => {}} />
) : screen === "settings" ? (
  <SettingsView gateway={{ kind: "ready", baseUrl: "http://127.0.0.1:20128" }} account={account} models={[{ id: "kr/claude-sonnet", label: "Claude Sonnet" }, { id: "kr/gemini-pro", label: "Gemini Pro" }]} settings={defaultSettings("")} onManageAccounts={() => {}} onSelectModel={() => {}} onUpdate={() => {}} onSetApiKey={async () => defaultSettings("")} onClearApiKey={async () => defaultSettings("")} onListVoices={async () => []} />
) : screen === "published" ? (
  <ProjectWorkspaceView stage={{ kind: "published", outputPath: "/audit-output.mp4", title: cards[0]!.title, hashtags: ["#AI", "#Robotics", "#Technology"], thumbnailPath: "/audit-fixture.svg", format: "tiktok" }} onBack={() => {}} onRetry={() => {}} onFixWithAi={() => {}} onApplyScript={() => {}} onApproveScript={() => {}} onSubmitEdits={async () => true} onApproveDraft={() => {}} onReveal={() => {}} onSave={() => {}} onCancel={() => {}} onSubmitImageReview={() => {}} bgm={[]} bgmSelected={null} onBgmAdd={() => {}} onBgmRemove={async () => {}} onBgmSelect={async () => {}} onGenerateThumbnail={async () => ({ thumbnailUrl: "/audit-fixture.svg" })} onSaveThumbnail={async () => ({ saved: true })} />
) : screen === "storyboard" ? (
  <StoryboardView model={{ projectId: "p1", globalNotes: "", scenes: Array.from({ length: 5 }, (_, index) => ({ sceneId: `scene-0${index + 1}`, order: index + 1, stillPath: "/audit-fixture.svg", editText: "" })) }} canApprove onBack={() => {}} onSubmit={async () => true} onApprove={() => {}} bgm={bgmTracks} bgmSelected="nhac-nen-mac-dinh.mp3" onBgmAdd={() => {}} onBgmRemove={async () => {}} onBgmSelect={async () => {}} />
) : (
  <HomeView aiReady load="populated" cards={cards} defaultVoiceProvider="vivibe" onCreate={() => {}} onOpen={() => {}} onConnectPrompt={() => {}} onPickImages={async () => ({ staged: [], rejected: [] })} onImportImageBytes={async () => ({ staged: [], rejected: [] })} onDelete={() => {}} onReveal={() => {}} onRename={() => {}} />
);

createRoot(document.getElementById("root")!).render(
  <div className="ns-shell">
    <Sidebar active={screen === "projects" ? "projects" : screen === "settings" ? "settings" : "home"} gateway={{ kind: "ready", baseUrl: "http://127.0.0.1:20128" }} account={account} onNavigate={() => {}} />
    <main className="ns-main">{content}</main>
  </div>,
);
