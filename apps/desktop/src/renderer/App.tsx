import React, { useEffect, useReducer, useRef, useState } from "react";
import { HomeView, SettingsView, StoryboardView, TopBar, theme } from "./views.js";
import { reduceDesktop, progressPercent, type DesktopState } from "./state/desktop-state.js";
import { aiReady } from "../main/gateway/model-gateway-manager.js";
import { defaultSettings } from "./settings/settings-model.js";
import type { ModelInfo } from "../shared/types.js";

/**
 * Renderer root (web-dashboard, redesigned). A persistent dark shell with a
 * Home-first flow: the app never blocks on onboarding — AI status lives in the
 * top bar, AI login is delegated to 9router via Settings, and a sensible default
 * model is auto-selected once connected. Streaming events fold into DesktopState.
 */

type Screen = "home" | "storyboard" | "settings";

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
  const [gateway, setGateway] = useState(initial.gateway);
  const [account, setAccount] = useState(initial.aiAccount);
  const [settings, setSettings] = useState(initial.settings);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const modelsRef = useRef<ModelInfo[]>([]);
  modelsRef.current = models;

  const dash = typeof window !== "undefined" ? window.dashboard : undefined;
  const ready = aiReady(gateway, account);

  useEffect(() => {
    if (!dash) return;
    void (async () => {
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

    // Poll the gateway only until AI is ready (gateway up + a connection + a
    // model). Auto-select a sensible default model so the user isn't forced to
    // choose. Once ready, stop polling (no flicker / churn).
    const poll = setInterval(() => {
      void (async () => {
        const gw = await dash.ai.gatewayState();
        setGateway(gw);
        if (gw.kind !== "ready") return;
        const ms = await dash.ai.listModels();
        if (ms.length) setModels(ms);
        let acc = await dash.ai.connectedAccounts();
        if (acc.kind === "connected" && acc.accounts.length > 0 && !acc.selectedModel && ms.length) {
          acc = await dash.ai.selectModel(ms[0]!.id); // smart default
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

  const manageAccounts = () => {
    // Delegate login to 9router's own UI; the poll picks up the new connection.
    void dash?.ai.beginConnect("");
  };

  return (
    <div style={{ background: theme.bg, minHeight: "100vh", fontFamily: "Inter, system-ui, sans-serif", color: theme.text }}>
      <TopBar gateway={gateway} account={account} onHome={() => setScreen("home")} onSettings={() => setScreen("settings")} />

      {screen === "home" && (
        <HomeView
          aiReady={ready}
          load={state.gallery.load}
          cards={state.gallery.cards}
          onConnectPrompt={() => setScreen("settings")}
          onCreate={(raw) =>
            void dash?.projects.create({ raw }).then(async () => {
              await refreshGallery();
            })
          }
          onOpen={(projectId) =>
            void dash?.projects.open(projectId).then((storyboard) => {
              dispatch({ type: "openProject", project: { projectId, storyboard, draft: { hasReviewedDraft: false, revision: 0 } } });
              setScreen("storyboard");
            })
          }
        />
      )}

      {screen === "settings" && (
        <SettingsView
          gateway={gateway}
          account={account}
          models={models}
          settings={settings}
          onManageAccounts={manageAccounts}
          onSelectModel={(modelId) => void dash?.ai.selectModel(modelId).then(setAccount)}
          onUpdate={(patch) => void dash?.settings.update(patch).then(setSettings)}
        />
      )}

      {screen === "storyboard" && state.openProject && (
        <StoryboardView
          model={state.openProject.storyboard}
          percent={progressPercent(state)}
          canApprove={state.openProject.draft.hasReviewedDraft}
          onSubmit={(perScene, globalNotes) => void dash?.review.submitEdits(state.openProject!.projectId, { perScene, globalNotes })}
          onApprove={() => void dash?.review.approveDraft(state.openProject!.projectId)}
        />
      )}
    </div>
  );
};
