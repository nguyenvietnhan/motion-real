import React, { useEffect, useReducer, useState } from "react";
import { HomeView, LicenseView, ProjectsView, SettingsView, Sidebar, StoryboardView, type Screen } from "./views.js";
import { reduceDesktop, progressPercent, type DesktopState } from "./state/desktop-state.js";
import { aiReady } from "../main/gateway/model-gateway-manager.js";
import { defaultSettings } from "./settings/settings-model.js";
import type { LicenseState, ModelInfo } from "../shared/types.js";

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

    const unsubs = [
      dash.events.onProgress((e) => dispatch({ type: "progress", event: e })),
      dash.events.onScene((e) => dispatch({ type: "scene", event: e })),
      dash.events.onStatus((e) => dispatch({ type: "status", event: e })),
      dash.events.onFriendlyError((e) => dispatch({ type: "friendlyError", error: e })),
    ];

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

  const openProject = (projectId: string) =>
    void dash?.projects.open(projectId).then((storyboard) => {
      dispatch({ type: "openProject", project: { projectId, storyboard, draft: { hasReviewedDraft: false, revision: 0 } } });
      setScreen("storyboard");
    });

  if (license.kind !== "active") {
    return <LicenseView state={license} onActivate={(key) => void dash?.license.activate(key).then(setLicense)} />;
  }

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
            onCreate={(raw) => void dash?.projects.create({ raw }).then(() => refreshGallery())}
            onOpen={openProject}
          />
        )}

        {screen === "projects" && (
          <ProjectsView
            load={state.gallery.load}
            cards={state.gallery.cards}
            onOpen={openProject}
            onNew={() => setScreen("home")}
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

        {screen === "storyboard" && state.openProject && (
          <StoryboardView
            model={state.openProject.storyboard}
            percent={progressPercent(state)}
            canApprove={state.openProject.draft.hasReviewedDraft}
            onBack={() => setScreen("home")}
            onSubmit={(perScene, globalNotes) => void dash?.review.submitEdits(state.openProject!.projectId, { perScene, globalNotes })}
            onApprove={() => void dash?.review.approveDraft(state.openProject!.projectId)}
          />
        )}
      </main>
    </div>
  );
};
