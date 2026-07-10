import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { HomeView, LicenseView, ProjectsView, ProjectWorkspaceView, SettingsView, Sidebar, type Screen } from "./views.js";
import { reduceDesktop, type DesktopState } from "./state/desktop-state.js";
import { aiReady } from "../shared/ai-ready.js";
import { preferredModelDecision } from "../shared/model-selection.js";
import { defaultSettings } from "../shared/settings-model.js";
import type { BgmTrackVM, LicenseState, ModelInfo, ProjectStage } from "../shared/types.js";
import { compactNotificationMessage, errorDetails, NotificationProvider, useNotifications } from "./notifications.js";

/**
 * Renderer root — enterprise shell: a left Sidebar + a content
 * area, Home-first. AI status lives in the sidebar; login is delegated to
 * 9router via Settings. Preferred model is restored from settings (or first-use
 * first model is selected and persisted). Gateway is polled only until AI is ready.
 */

const initial: DesktopState = {
  license: { kind: "active", machineLocked: true, lastVerifiedAt: "" },
  gateway: { kind: "starting", attempt: 0 },
  aiAccount: { kind: "disconnected" },
  settings: defaultSettings(""),
  gallery: { load: "loading", cards: [] },
};

export const App: React.FC = () => (
  <NotificationProvider>
    <AppShell />
  </NotificationProvider>
);

const AppShell: React.FC = () => {
  const [state, dispatch] = useReducer(reduceDesktop, initial);
  const [screen, setScreen] = useState<Screen>("home");
  const [license, setLicense] = useState<LicenseState>({ kind: "unactivated" });
  const [gateway, setGateway] = useState(initial.gateway);
  const [account, setAccount] = useState(initial.aiAccount);
  const [settings, setSettings] = useState(initial.settings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [preferredModelUnavailable, setPreferredModelUnavailable] = useState<string | undefined>();
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const [stage, setStage] = useState<ProjectStage>({ kind: "writing" });
  // BGM library (per-machine, shared) + the open project's current selection.
  // Loaded when a workspace opens; the picker mutates the library then refreshes.
  const [bgm, setBgm] = useState<BgmTrackVM[]>([]);
  const [bgmSelected, setBgmSelected] = useState<string | null>(null);
  const selectingModelRef = useRef<string | null>(null);
  const preferredModelIdRef = useRef<string | undefined>(undefined);
  const notify = useNotifications();

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
    // Do not auto-select before settings load — that would race past the saved preference.
    if (!settingsLoaded) {
      setAccount(acc);
      return false;
    }

    if (acc.kind === "connected" && acc.accounts.length > 0 && ms.length) {
      const decision = preferredModelDecision({
        preferredModelId: preferredModelIdRef.current,
        runtimeModelId: acc.selectedModel?.id,
        availableModelIds: ms.map((m) => m.id),
      });

      if (decision.kind === "unavailable") {
        setPreferredModelUnavailable(decision.modelId);
        setAccount(acc);
        return false;
      }

      setPreferredModelUnavailable(undefined);

      if (decision.kind === "select-runtime" || decision.kind === "select-and-persist") {
        if (selectingModelRef.current !== decision.modelId) {
          selectingModelRef.current = decision.modelId;
          try {
            acc = await dash.ai.selectModel(decision.modelId);
            if (decision.kind === "select-and-persist") {
              try {
                const next = await dash.settings.update({ preferredAiModelId: decision.modelId });
                preferredModelIdRef.current = next.preferredAiModelId;
                setSettings(next);
              } catch {
                // Runtime selection still applied; preference write failed — surface later via settings UI.
              }
            }
          } finally {
            selectingModelRef.current = null;
          }
        }
      }
    }

    setAccount(acc);
    return aiReady(gw, acc);
  }, [dash, settingsLoaded]);

  useEffect(() => {
    preferredModelIdRef.current = settings.preferredAiModelId;
  }, [settings.preferredAiModelId]);

  useEffect(() => {
    if (!dash) return;
    void (async () => {
      setLicense(await dash.license.get());
      const loaded = await dash.settings.get();
      preferredModelIdRef.current = loaded.preferredAiModelId;
      setSettings(loaded);
      setSettingsLoaded(true);
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

    // Poll only until AI is ready (gateway up + a connection + a model); restore
    // preferred model (or first-use first model) then stop (no churn).
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

  // A file dropped ANYWHERE outside an explicit drop zone makes Electron
  // navigate the window to that file:// URL — the whole app vanishes. Swallow
  // drag/drop at the document level so a near-miss on the composer can't blow
  // the renderer away; the composer's own handlers still call preventDefault
  // and run before this (capture phase off) for a real drop.
  useEffect(() => {
    const swallow = (e: DragEvent): void => {
      e.preventDefault();
    };
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  const refreshGallery = useCallback(async () => {
    if (!dash) return;
    try {
      const cards = await dash.projects.list();
      dispatch({ type: "gallery", load: cards.length === 0 ? "empty" : "populated", cards });
    } catch {
      dispatch({ type: "gallery", load: "error", cards: [] });
    }
  }, [dash]);

  const openProject = (projectId: string) => {
    setOpenProjectId(projectId);
    setStage({ kind: "writing" });
    setScreen("workspace");
  };

  // Load the BGM library + this project's current selection when a workspace
  // opens (and refresh the library on demand after add/remove). A failure leaves
  // an empty library rather than crashing the workspace.
  const refreshBgm = useCallback(async () => {
    if (!dash) return;
    try {
      setBgm(await dash.bgm.list());
    } catch {
      setBgm([]);
    }
  }, [dash]);

  useEffect(() => {
    if (!dash || screen !== "workspace" || !openProjectId) return;
    void refreshBgm();
    void dash.bgm.getForProject(openProjectId).then(setBgmSelected).catch(() => setBgmSelected(null));
  }, [dash, screen, openProjectId, refreshBgm]);

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

  // Poll the gallery while on the home/projects screens, so a
  // project's card appears + its status badge updates live without the user leaving
  // and re-entering. Without this, a just-created project (or one whose render
  // finished in the background) only showed up on the next mount/leaveWorkspace —
  // a "where did my project go?" gap. Reuses the single `refreshGallery` source.
  useEffect(() => {
    if (!dash || (screen !== "home" && screen !== "projects")) return;
    const iv = setInterval(() => void refreshGallery(), 1500);
    return () => clearInterval(iv);
  }, [dash, screen, refreshGallery]);

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
  const onRename = (projectId: string, newTitle: string) => {
    if (!dash) return;
    void dash.projects.rename(projectId, newTitle).then(refreshGallery);
  };

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
            defaultVoiceProvider={settings.voiceProvider}
            onPickImages={() => dash?.projects.pickImages() ?? Promise.resolve({ staged: [], rejected: [] })}
            onImportImageBytes={(files) =>
              // The method is absent on a stale preload bundle (added this session;
              // the launcher bundles main+preload once at startup, so a hot-reloaded
              // renderer can outrun it). Surface a clear "restart" instead of a raw
              // "is not a function" throw, and never crash the paste/drop handler.
              typeof dash?.projects.importImageBytes === "function"
                ? dash.projects.importImageBytes(files)
                : Promise.reject(new Error("Cần khởi động lại ứng dụng để bật dán/kéo-thả ảnh (bản nền chưa cập nhật)."))
            }
            onCreate={(raw, images, choices) => {
              if (!dash) return Promise.resolve();
              return dash.projects
                .create({
                  raw,
                  ...(images.length > 0 ? { images: images.map((s) => ({ ref: s.ref, width: s.width, height: s.height })) } : {}),
                  videoLanguage: choices.videoLanguage,
                  voiceProvider: choices.voiceProvider,
                })
                .then((r) => {
                  // Refresh the gallery the moment the project exists on disk
                  // (brief.json is written by scaffold) so the card is already
                  // there when the user returns home — not only after the next
                  // poll tick. Then open the workspace.
                  void refreshGallery();
                  openProject(r.projectId);
                })
                .catch((err: unknown) => {
                  const details = errorDetails(err);
                  notify.error({
                    title: "Không tạo được dự án",
                    message: compactNotificationMessage(details, "Kiểm tra cài đặt rồi thử lại."),
                    details,
                  });
                });
            }}
            onUnstageImage={(ref) => {
              // Best-effort: free the staged bytes when the user removes a pick
              // (the 24h sweep is the backstop). A stale preload lacks the method;
              // ignore — the file just waits for the sweep.
              if (typeof dash?.projects.removeStagedImage === "function") void dash.projects.removeStagedImage(ref).catch(() => {});
            }}
            onOpen={openProject}
            onDelete={onDelete}
            onReveal={onReveal}
            onRename={onRename}
            onRetry={() => void refreshGallery()}
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
            onRename={onRename}
            onRetry={() => void refreshGallery()}
          />
        )}

        {screen === "settings" && (
          <SettingsView
            gateway={gateway}
            account={account}
            models={models}
            settings={settings}
            preferredModelUnavailable={preferredModelUnavailable}
            onManageAccounts={() => {
              if (!dash) return;
              void dash.ai.beginConnect("").then(() => void refreshAiState());
            }}
            onSelectModel={(modelId) => {
              if (!dash) return;
              void (async () => {
                try {
                  const acc = await dash.ai.selectModel(modelId);
                  setAccount(acc);
                  try {
                    const next = await dash.settings.update({ preferredAiModelId: modelId });
                    preferredModelIdRef.current = next.preferredAiModelId;
                    setSettings(next);
                    setPreferredModelUnavailable(undefined);
                  } catch (error: unknown) {
                    const details = errorDetails(error);
                    notify.error({
                      title: "Model đã chọn nhưng chưa lưu được",
                      message: compactNotificationMessage(
                        details,
                        "Lựa chọn hiện tại có thể không còn sau khi khởi động lại.",
                      ),
                      details,
                    });
                  }
                } catch (error: unknown) {
                  const details = errorDetails(error);
                  notify.error({
                    title: "Không chọn được model",
                    message: compactNotificationMessage(details, "Thử chọn lại model."),
                    details,
                  });
                }
              })();
            }}
            onUpdate={(patch) => {
              if (!dash) return Promise.reject(new Error("Dashboard API is unavailable"));
              return dash.settings.update(patch).then((next) => {
                preferredModelIdRef.current = next.preferredAiModelId;
                setSettings(next);
              });
            }}
            onSetApiKey={(provider, apiKey) => {
              if (!dash) return Promise.reject(new Error("Dashboard API is unavailable"));
              return dash.tts.setApiKey(provider, apiKey).then((next) => { setSettings(next); return next; });
            }}
            onClearApiKey={(provider) => {
              if (!dash) return Promise.reject(new Error("Dashboard API is unavailable"));
              return dash.tts.clearApiKey(provider).then((next) => { setSettings(next); return next; });
            }}
            onCheckReadiness={() => {
              if (!dash) return Promise.reject(new Error("Dashboard API is unavailable"));
              return dash.settings.readiness();
            }}
          />
        )}

        {screen === "workspace" && openProjectId && (
          <ProjectWorkspaceView
            stage={stage}
            projectId={openProjectId}
            loadDiagnostics={(id) => {
              if (!dash) return Promise.reject(new Error("Dashboard API is unavailable"));
              return dash.projects.diagnostics(id);
            }}
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
                setStage({ kind: "writing", phase: "author" });
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
            onSave={() => void dash?.projects.save(openProjectId)}
            onCancel={() => void dash?.projects.cancel(openProjectId)}
            onSubmitImageReview={(refs) => {
              // Confirm the crawled-image selection; the stage poll drives the
              // transition to "writing" once the backend begins authoring.
              setStage({ kind: "writing", phase: "author" });
              void dash?.projects.submitImageReview(openProjectId, refs);
            }}
            bgm={bgm}
            bgmSelected={bgmSelected}
            onBgmAdd={() => void dash?.bgm.add().then(setBgm)}
            onBgmRemove={async (name) => {
              if (!dash) return;
              const tracks = await dash.bgm.remove(name);
              setBgm(tracks);
              if (bgmSelected === name) {
                setBgmSelected(null);
                await dash.bgm.setForProject(openProjectId, null);
              }
            }}
            onBgmSelect={async (name) => {
              setBgmSelected(name);
              await dash?.bgm.setForProject(openProjectId, name);
            }}
            onGenerateThumbnail={() =>
              dash?.thumbnail.generate(openProjectId) ?? Promise.resolve(null)
            }
            onSaveThumbnail={() =>
              dash?.thumbnail.save(openProjectId) ?? Promise.resolve({ saved: false })
            }
          />
        )}
      </main>
    </div>
  );
};
