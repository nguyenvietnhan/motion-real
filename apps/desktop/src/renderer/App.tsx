import React, { useEffect, useReducer, useState } from "react";
import { HomeView, LicenseView, ProjectsView, ProjectWorkspaceView, SettingsView, Sidebar, type Screen } from "./views.js";
import { reduceDesktop, type DesktopState } from "./state/desktop-state.js";
import { aiReady } from "../main/gateway/model-gateway-manager.js";
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

  useEffect(() => {
    if (!dash) return;
    void (async () => {
      setLicense(await dash.license.get());
      setSettings(await dash.settings.get());
      dispatch({ type: "gallery", load: "loading", cards: [] });
      const cards = await dash.projects.list();
      dispatch({ type: "gallery", load: cards.length === 0 ? "empty" : "populated", cards });
    })();

    // Only the gallery status badge is reduced here; the workspace flow is driven
    // by stage polling (below). Progress/scene/friendly-error are surfaced through
    // the polled stage, so we don't double-handle them via the event stream.
    const unsubs = [dash.events.onStatus((e) => dispatch({ type: "status", event: e }))];

    // Poll only until AI is ready (gateway up + a connection + a model); auto-pick
    // a default model so the user isn't forced to choose; then stop (no churn).
    const poll = setInterval(() => {
      void (async () => {
        const gw = await dash.ai.gatewayState();
        setGateway(gw);
        if (gw.kind !== "ready") return;
        const ms = await dash.ai.listModels();
        if (ms.length) setModels(ms);
        let acc = await dash.ai.connectedAccounts();
        if (acc.kind === "connected" && acc.accounts.length > 0 && !acc.selectedModel && ms.length) {
          acc = await dash.ai.selectModel(ms[0]!.id);
        }
        setAccount(acc);
        if (aiReady(gw, acc)) clearInterval(poll);
      })();
    }, 1500);

    return () => {
      clearInterval(poll);
      unsubs.forEach((u) => u());
    };
  }, [dash]);

  const refreshGallery = async () => {
    if (!dash) return;
    const cards = await dash.projects.list();
    dispatch({ type: "gallery", load: cards.length === 0 ? "empty" : "populated", cards });
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
          />
        )}

        {screen === "settings" && (
          <SettingsView
            gateway={gateway}
            account={account}
            models={models}
            settings={settings}
            onManageAccounts={() => void dash?.ai.beginConnect("")}
            onSelectModel={(modelId) => void dash?.ai.selectModel(modelId).then(setAccount)}
            onUpdate={(patch) => void dash?.settings.update(patch).then(setSettings)}
          />
        )}

        {screen === "workspace" && openProjectId && (
          <ProjectWorkspaceView
            stage={stage}
            onBack={leaveWorkspace}
            onRetry={() => {
              setStage({ kind: "writing" });
              void dash?.projects.retry(openProjectId);
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
            onSubmitEdits={(perScene, globalNotes) => {
              setStage({ kind: "rendering", percent: 0, phase: "edit" });
              void dash?.review.submitEdits(openProjectId, { perScene, globalNotes });
            }}
            onApproveDraft={() => {
              setStage({ kind: "rendering", percent: 0, phase: "full" });
              void dash?.review.approveDraft(openProjectId);
            }}
          />
        )}
      </main>
    </div>
  );
};
