import React, { useEffect, useReducer, useState } from "react";
import { CreateView, GalleryView, OnboardingView, SettingsView, StoryboardView } from "./views.js";
import { reduceDesktop, progressPercent, type DesktopState } from "./state/desktop-state.js";
import { canCreate } from "../main/license/license-manager.js";
import { aiReady } from "../main/gateway/model-gateway-manager.js";
import { defaultSettings } from "./settings/settings-model.js";

/**
 * Renderer root (web-dashboard Task 11). Composes the views over the typed
 * `window.dashboard` IPC client and folds streaming events into `DesktopState`
 * via the pure reducer. Only translated view-models are rendered.
 */

type Screen = "onboarding" | "gallery" | "create" | "storyboard" | "settings";

const initial: DesktopState = {
  license: { kind: "unactivated" },
  gateway: { kind: "starting", attempt: 0 },
  aiAccount: { kind: "disconnected" },
  settings: defaultSettings(""),
  gallery: { load: "loading", cards: [] },
};

export const App: React.FC = () => {
  const [state, dispatch] = useReducer(reduceDesktop, initial);
  const [screen, setScreen] = useState<Screen>("onboarding");
  // Top-level singletons that are not part of the event-folded state.
  const [license, setLicense] = useState(initial.license);
  const [gateway, setGateway] = useState(initial.gateway);
  const [account, setAccount] = useState(initial.aiAccount);
  const [settings, setSettings] = useState(initial.settings);

  const dash = typeof window !== "undefined" ? window.dashboard : undefined;

  useEffect(() => {
    if (!dash) return;
    void (async () => {
      setLicense(await dash.license.get());
      setGateway(await dash.ai.gatewayState());
      setAccount(await dash.ai.accountState());
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
    return () => unsubs.forEach((u) => u());
  }, [dash]);

  useEffect(() => {
    if (canCreate(license) && aiReady(gateway, account) && screen === "onboarding") setScreen("gallery");
  }, [license, gateway, account, screen]);

  const ready = canCreate(license) && aiReady(gateway, account);

  return (
    <main style={{ fontFamily: "Inter, system-ui, sans-serif", padding: 32, background: "#FBF7EF", minHeight: "100vh" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>News Studio</h1>
        {ready && (
          <nav style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setScreen("gallery")}>Dự án</button>
            <button onClick={() => setScreen("create")}>Tạo mới</button>
            <button onClick={() => setScreen("settings")}>Cài đặt</button>
          </nav>
        )}
      </header>

      {screen === "onboarding" && (
        <OnboardingView
          license={license}
          gateway={gateway}
          account={account}
          onActivate={(key) => void dash?.license.activate(key).then(setLicense)}
          onConnect={(provider) => void dash?.ai.connect(provider).then(setAccount)}
        />
      )}

      {screen === "gallery" && (
        <GalleryView
          load={state.gallery.load}
          cards={state.gallery.cards}
          onOpen={(projectId) =>
            void dash?.projects.open(projectId).then((storyboard) => {
              dispatch({ type: "openProject", project: { projectId, storyboard, draft: { hasReviewedDraft: false, revision: 0 } } });
              setScreen("storyboard");
            })
          }
        />
      )}

      {screen === "create" && (
        <CreateView
          canCreate={ready}
          onCreate={(raw) => void dash?.projects.create({ raw }).then(() => setScreen("gallery"))}
        />
      )}

      {screen === "storyboard" && state.openProject && (
        <StoryboardView
          model={state.openProject.storyboard}
          percent={progressPercent(state)}
          canApprove={state.openProject.draft.hasReviewedDraft}
          onSubmit={(perScene, globalNotes) =>
            void dash?.review.submitEdits(state.openProject!.projectId, { perScene, globalNotes })
          }
          onApprove={() => void dash?.review.approveDraft(state.openProject!.projectId)}
        />
      )}

      {screen === "settings" && (
        <SettingsView settings={settings} onUpdate={(patch) => void dash?.settings.update(patch).then(setSettings)} />
      )}
    </main>
  );
};
