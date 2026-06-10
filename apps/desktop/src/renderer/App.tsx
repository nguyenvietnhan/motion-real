import React, { useCallback, useEffect, useReducer, useState } from "react";
import { HomeView, LicenseView, ProjectsView, ProjectWorkspaceView, SettingsView, Sidebar, type Screen } from "./views.js";
import { reduceDesktop, type DesktopState } from "./state/desktop-state.js";
import { aiReady } from "../shared/ai-ready.js";
import { defaultSettings } from "../shared/settings-model.js";
import type { LicenseState, ModelInfo, ProjectStage } from "../shared/types.js";

/**
 * Renderer root (web-dashboard) — enterprise shell: a left Sidebar + a content
 * area, Home-first. AI status lives in the sidebar; login is delegated to
 * 9router via Settings; a default model auto-selects once connected. Gateway is
 * polled only until AI is ready.
 */

const initial: DesktopState = {
  license: { kind: "active", machineLocked: true, lastVerifiedAt: "" },
  gateway: { kind: "starting", attempt: 0 },
  aiAccount: { kind: "disconnected" },
  settings: defaultSettings(""),
  gallery: { load: "loading", cards: [] },
};

export const App: React.FC = () => {
  const [state, dispatch] = useReducer(reduceDesktop, initial);
  const [screen, setScreen] = useState<Screen>("home");
  const [license, setLicense] = useState<LicenseState>({ kind: "unactivated" });
  const [gateway, setGateway] = useState(initial.gateway);
  const [account, setAccount] = useState(initial.aiAccount);
  const [settings, setSettings] = useState(initial.settings);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const [stage, setStage] = useState<ProjectStage>({ kind: "writing" });
  const [createError, setCreateError] = useState<string>("");

  const dash = typeof window !== "undefined" ? window.dashboard : undefined;
  const ready = aiReady(gateway, account);

  const refreshAiState = useCallback(async (): Promise<boolean> => {
    if (!dash) return false;
    const gw = await dash.ai.gatewayState();
    setGateway(gw);
    if (gw.kind !== "ready") return false;

    const ms = await dash.ai.listModels();
    if (ms.length) setModels(ms);

    let acc = await dash.ai.connectedAccounts();
    if (acc.kind === "connected" && acc.accounts.length > 0 && !acc.selectedModel && ms.length) {
      acc = await dash.ai.selectModel(ms[0]!.id);
    }
    setAccount(acc);
    return aiReady(gw, acc);
  }, [dash]);

  useEffect(() => {
    if (!dash) return;
    void (async () => {
      setLicense(await dash.license.get());
      setSettings(await dash.settings.get());
      dispatch({ type: "gallery", load: "loading", cards: [] });
      try {
        const cards = await dash.projects.list();
        dispatch({ type: "gallery", load: cards.length === 0 ? "empty" : "populated", cards });
      } catch {
        // A transient IPC/disk failure must not pin the gallery on "loading"
        // forever — surface a recoverable error state with a retry (audit P1-8).
        dispatch({ type: "gallery", load: "error", cards: [] });
      }
    })();

    // Only the gallery status badge is reduced here; the workspace flow is driven
    // by stage polling (below). Progress/scene/friendly-error are surfaced through
    // the polled stage, so we don't double-handle them via the event stream.
    const unsubs = [dash.events.onStatus((e) => dispatch({ type: "status", event: e }))];

    // Poll only until AI is ready (gateway up + a connection + a model); auto-pick
    // a default model so the user isn't forced to choose; then stop (no churn).
    const poll = setInterval(() => {
      void refreshAiState().then((isReady) => {
        if (isReady) clearInterval(poll);
      });
    }, 1500);

    return () => {
      clearInterval(poll);
      unsubs.forEach((u) => u());
    };
  }, [dash, refreshAiState]);

  useEffect(() => {
    if (screen !== "settings") return;
    void refreshAiState();
  }, [screen, refreshAiState]);

  const refreshGallery = async () => {
    if (!dash) return;
    try {
      const cards = await dash.projects.list();
      dispatch({ type: "gallery", load: cards.length === 0 ? "empty" : "populated", cards });
    } catch {
      dispatch({ type: "gallery", load: "error", cards: [] });
    }
  };

  const openProject = (projectId: string) => {
    setOpenProjectId(projectId);
    setStage({ kind: "writing" });
    setScreen("workspace");
  };

  // Poll the open project's stage while in the workspace (writing → script →
  // rendering → ready / error), so the staged UI updates live.
  useEffect(() => {
    if (!dash || screen !== "workspace" || !openProjectId) return;
    let alive = true;
    const tick = async () => {
      const st = await dash.projects.stage(openProjectId);
      if (alive) setStage(st);
    };
    void tick();
    const iv = setInterval(() => void tick(), 1500);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [dash, screen, openProjectId]);

  if (license.kind !== "active") {
    return <LicenseView state={license} onActivate={(key) => void dash?.license.activate(key).then(setLicense)} />;
  }

  const leaveWorkspace = () => {
    setOpenProjectId(null);
    setScreen("home");
    void refreshGallery();
  };

  const onDelete = (projectId: string) => {
    if (!dash) return;
    const ok = typeof window !== "undefined" && typeof window.confirm === "function"
      ? window.confirm("Xoá vĩnh viễn dự án này? Hành động không thể hoàn tác.")
      : true;
    if (!ok) return;
    void dash.projects.delete(projectId).then(refreshGallery);
  };
  const onReveal = (projectId: string) => void dash?.projects.reveal(projectId);

  return (
    <div className="ns-shell">
      <Sidebar active={screen} gateway={gateway} account={account} onNavigate={setScreen} />
      <main className="ns-main">
        {screen === "home" && (
          <HomeView
            aiReady={ready}
            load={state.gallery.load}
            cards={state.gallery.cards}
            onConnectPrompt={() => setScreen("settings")}
            onCreate={(raw) => {
              setCreateError("");
              void dash?.projects
                .create({ raw })
                .then((r) => openProject(r.projectId))
                .catch((err: unknown) => setCreateError(err instanceof Error ? err.message : "Không tạo được dự án. Hãy thử lại."));
            }}
            onOpen={openProject}
            onDelete={onDelete}
            onReveal={onReveal}
            onRetry={() => void refreshGallery()}
            createError={createError}
          />
        )}

        {screen === "projects" && (
          <ProjectsView
            load={state.gallery.load}
            cards={state.gallery.cards}
            onOpen={openProject}
            onNew={() => setScreen("home")}
            onDelete={onDelete}
            onReveal={onReveal}
            onRetry={() => void refreshGallery()}
          />
        )}

        {screen === "settings" && (
          <SettingsView
            gateway={gateway}
            account={account}
            models={models}
            settings={settings}
            onManageAccounts={() => {
              if (!dash) return;
              void dash.ai.beginConnect("").then(() => void refreshAiState());
            }}
            onSelectModel={(modelId) => void dash?.ai.selectModel(modelId).then(setAccount)}
            onUpdate={(patch) => void dash?.settings.update(patch).then(setSettings)}
          />
        )}

        {screen === "workspace" && openProjectId && (
          <ProjectWorkspaceView
            stage={stage}
            onBack={leaveWorkspace}
            onRetry={() => {
              // "Thử lại" re-runs the SAME loop that failed, routed by where the
              // error happened (the stage carries a `retry` hint), so a render
              // failure re-renders instead of re-authoring a whole new script
              // (which wasted tokens — the script was fine, the render wasn't).
              const retry = stage.kind === "error" ? stage.retry : undefined;
              if (retry === "full") {
                setStage({ kind: "rendering", percent: 0, phase: "full" });
                void dash?.review.approveDraft(openProjectId);
              } else if (retry === "draft") {
                setStage({ kind: "rendering", percent: 0, phase: "draft" });
                void dash?.projects.fixWithAi(openProjectId);
              } else {
                setStage({ kind: "writing" });
                void dash?.projects.retry(openProjectId);
              }
            }}
            onFixWithAi={() => {
              setStage({ kind: "rendering", percent: 0, phase: "draft" });
              void dash?.projects.fixWithAi(openProjectId);
            }}
            onApplyScript={(edits) => void dash?.script.applyEdits(openProjectId, edits)}
            onApproveScript={() => {
              setStage({ kind: "rendering", percent: 0, phase: "draft" });
              void dash?.script.approve(openProjectId);
            }}
            onSubmitEdits={async (perScene, globalNotes) => {
              if (!dash) return false;
              // Don't optimistically leave the storyboard until the backend
              // accepts the edits — on a rejected/failed submit the view stays
              // mounted and KEEPS the user's typed drafts (audit P1-7). The stage
              // poll drives the transition to rendering once the backend begins.
              try {
                const r = await dash.review.submitEdits(openProjectId, { perScene, globalNotes });
                if (r && r.ok === false) return false;
                setStage({ kind: "rendering", percent: 0, phase: "edit" });
                return true;
              } catch {
                return false;
              }
            }}
            onApproveDraft={() => {
              setStage({ kind: "rendering", percent: 0, phase: "full" });
              void dash?.review.approveDraft(openProjectId);
            }}
            onReveal={() => onReveal(openProjectId)}
          />
        )}
      </main>
    </div>
  );
};
