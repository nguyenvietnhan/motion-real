import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Screen } from "./primitives.js";
import { Sidebar } from "./views/sidebar.js";
import { HomeView } from "./views/home.js";
import { ProjectsView } from "./views/projects.js";
import { SettingsView, type SettingsTab } from "./views/settings.js";
import { ProjectWorkspaceView } from "./views/workspace.js";
import { QueueView } from "./views/queue.js";
import { reduceDesktop, type DesktopState } from "./state/desktop-state.js";
import { aiReady } from "../shared/ai-ready.js";
import type { CreatePathSettingsTab } from "../shared/create-path-readiness.js";
import { preferredModelDecision } from "../shared/model-selection.js";
import { defaultSettings, reviewModeAllowsSceneEdit } from "../shared/settings-model.js";
import type { BgmTrackVM, ModelInfo, ProjectStage } from "../shared/types.js";
import type { QueueProjectVM, QueueRunnerStatus } from "../shared/queue-types.js";
import { EMPTY_QUEUE_STATUS } from "./views/queue.js";
import { compactNotificationMessage, errorDetails, NotificationProvider, useNotifications } from "./notifications.js";
import { ConfirmDialog } from "./primitives.js";

/**
 * Renderer root — enterprise shell: a left Sidebar + a content
 * area, Home-first. AI status lives in the sidebar; login is delegated to
 * 9router via Settings. Preferred model is restored from settings (or first-use
 * first model is selected and persisted). Gateway is polled only until AI is ready.
 */

const initial: DesktopState = {
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
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("ai");
  const [gateway, setGateway] = useState(initial.gateway);
  const [account, setAccount] = useState(initial.aiAccount);
  const [settings, setSettings] = useState(initial.settings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [preferredModelUnavailable, setPreferredModelUnavailable] = useState<string | undefined>();
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const [stage, setStage] = useState<ProjectStage>({ kind: "writing" });
  /** Home create-time BGM library + selection (written at create; not on storyboard). */
  const [bgm, setBgm] = useState<BgmTrackVM[]>([]);
  const [createBgmSelected, setCreateBgmSelected] = useState<string | null>(null);
  const createBgmInitialized = useRef(false);
  const [queues, setQueues] = useState<QueueProjectVM[]>([]);
  const [queueLoad, setQueueLoad] = useState<"loading" | "ready" | "error">("loading");
  const [activeQueueId, setActiveQueueId] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState<QueueRunnerStatus>(EMPTY_QUEUE_STATUS);
  /** Pending project id for in-app delete confirm (replaces native window.confirm). */
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  /** Queue container id pending in-app delete confirm. */
  const [pendingQueueDeleteId, setPendingQueueDeleteId] = useState<string | null>(null);
  const selectingModelRef = useRef<string | null>(null);
  const preferredModelIdRef = useRef<string | undefined>(undefined);
  const notify = useNotifications();

  const dash = typeof window !== "undefined" ? window.dashboard : undefined;
  const ready = aiReady(gateway, account);

  const openSettings = useCallback((tab: SettingsTab = "ai") => {
    setSettingsTab(tab);
    setScreen("settings");
  }, []);

  const onNavigate = useCallback((s: Screen) => {
    // Sidebar "Cài đặt" lands on the AI tab (default entry); Home deep-links set tab first.
    if (s === "settings") setSettingsTab("ai");
    setScreen(s);
  }, []);

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

    // Gallery badge + light in-app toast on terminal status so unattended jobs
    // are visible even when the user is on Home (OS toast is main-process).
    // Progress/scene/friendly-error stay on the polled stage path.
    const unsubs = [
      dash.events.onStatus((e) => {
        dispatch({ type: "status", event: e });
        if (e.status === "done") {
          notify.success({
            title: "Video đã xong",
            message: "Mở dự án để xem, lưu video hoặc copy caption.",
          });
        } else if (e.status === "error") {
          notify.error({
            title: "Dựng video gặp lỗi",
            message: "Mở dự án để xem chi tiết và thử lại.",
          });
        }
      }),
    ];

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

  // Load the BGM library for Home create knobs only.
  // A failure leaves an empty library rather than crashing the UI.
  const refreshBgm = useCallback(async () => {
    if (!dash) return;
    try {
      const tracks = await dash.bgm.list();
      setBgm(tracks);
      // Default create selection to the bundled track once (user can clear to "Không nhạc").
      if (!createBgmInitialized.current) {
        createBgmInitialized.current = true;
        const builtIn = tracks.find((t) => t.builtIn);
        setCreateBgmSelected(builtIn?.name ?? null);
      }
    } catch {
      setBgm([]);
    }
  }, [dash]);

  useEffect(() => {
    if (!dash) return;
    void refreshBgm();
  }, [dash, refreshBgm]);

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

  const refreshQueues = useCallback(async () => {
    if (!dash?.queue) {
      setQueueLoad("error");
      return;
    }
    setQueueLoad("loading");
    try {
      const list = await dash.queue.list();
      setQueues(list);
      setQueueLoad("ready");
    } catch {
      setQueueLoad("error");
    }
  }, [dash]);

  useEffect(() => {
    if (screen !== "queue") return;
    void refreshQueues();
  }, [screen, refreshQueues]);

  // While on queue tab, poll list + runner status so job rows update during a run.
  useEffect(() => {
    if (!dash?.queue || screen !== "queue") return;
    let alive = true;
    const tick = async () => {
      try {
        const [list, st] = await Promise.all([dash.queue.list(), dash.queue.status()]);
        if (!alive) return;
        setQueues(list);
        setQueueLoad("ready");
        setQueueStatus({
          busy: Boolean(st.busy),
          activeQueueId: st.activeQueueId ?? null,
          pendingQueueIds: Array.isArray(st.pendingQueueIds) ? st.pendingQueueIds.map(String) : [],
        });
      } catch {
        /* keep last good snapshot */
      }
    };
    void tick();
    const iv = setInterval(() => void tick(), 2000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [dash, screen]);

  const leaveWorkspace = () => {
    setOpenProjectId(null);
    setScreen("home");
    void refreshGallery();
  };

  const onDelete = (projectId: string) => {
    if (!dash) return;
    setPendingDeleteId(projectId);
  };
  const confirmDelete = (): void => {
    if (!dash || !pendingDeleteId) return;
    const projectId = pendingDeleteId;
    setPendingDeleteId(null);
    void dash.projects.delete(projectId).then(refreshGallery);
  };
  const confirmQueueDelete = (): void => {
    if (!dash?.queue || !pendingQueueDeleteId) return;
    const queueId = pendingQueueDeleteId;
    setPendingQueueDeleteId(null);
    void dash.queue
      .delete(queueId)
      .then((ok) => {
        if (!ok) {
          notify.error({
            title: "Không xóa được",
            message: "Hàng đợi không còn hoặc đã bị xóa.",
          });
          return;
        }
        if (activeQueueId === queueId) setActiveQueueId(null);
        return refreshQueues();
      })
      .catch((error: unknown) => {
        const details = errorDetails(error);
        notify.error({
          title: "Không xóa được hàng đợi",
          message: compactNotificationMessage(details, "Thử lại sau."),
          details,
        });
      });
  };
  const onReveal = (projectId: string) => void dash?.projects.reveal(projectId);
  const onRename = (projectId: string, newTitle: string) => {
    if (!dash) return;
    void dash.projects.rename(projectId, newTitle).then(refreshGallery);
  };

  return (
    <div className="ns-shell">
      <Sidebar active={screen} gateway={gateway} account={account} onNavigate={onNavigate} />
      <main className="ns-main">
        {screen === "home" && (
          <HomeView
            gateway={gateway}
            account={account}
            voiceCredentials={settings.voiceCredentials}
            vivibeVoiceId={settings.vivibeVoiceId}
            elevenLabsVoiceId={settings.elevenLabsVoiceId}
            load={state.gallery.load}
            cards={state.gallery.cards}
            onConnectPrompt={(tab?: CreatePathSettingsTab) => openSettings(tab ?? "ai")}
            defaultVoiceProvider={settings.voiceProvider}
            smokeRenderEnabled={settings.smokeRenderEnabled}
            onRenderSmoke={(opts) => {
              if (!dash) return Promise.reject(new Error("Dashboard API is unavailable"));
              return dash.settings.renderSmoke(opts).then((res) => {
                if (res.ok) {
                  void refreshGallery();
                  openProject(res.projectId);
                }
                return res;
              });
            }}
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
                  source: "home",
                  ...(images.length > 0 ? { images: images.map((s) => ({ ref: s.ref, width: s.width, height: s.height })) } : {}),
                  durationTier: choices.durationTier,
                  videoLanguage: choices.videoLanguage,
                  voiceProvider: choices.voiceProvider,
                  bgm: choices.bgm,
                })
                .then((r) => {
                  // Queue runner busy: spill into ephemeral `home` (no parallel create).
                  if (r.kind === "queued") {
                    notify.info({
                      title: "Đã xếp vào hàng chờ",
                      message: "Đang có hàng đợi chạy — video vào lô home, sẽ chạy sau.",
                    });
                    if (r.imagesDropped || images.length > 0) {
                      notify.warning({
                        title: "Ảnh chưa vào hàng đợi",
                        message: "Chỉ prompt được xếp. Ảnh đính kèm chưa hỗ trợ trong lô home.",
                      });
                    }
                    void refreshQueues();
                    return;
                  }
                  // Idle path: project on disk → gallery + open workspace.
                  void refreshGallery();
                  openProject(r.projectId);
                })
                .catch((err: unknown) => {
                  const details = errorDetails(err);
                  notify.error({
                    title: "Không tạo được video",
                    message: compactNotificationMessage(details, "Kiểm tra cài đặt rồi thử lại."),
                    details,
                  });
                });
            }}
            bgm={bgm}
            bgmSelected={createBgmSelected}
            onBgmAdd={() => void dash?.bgm.add().then((tracks) => { setBgm(tracks); })}
            onBgmRemove={async (name) => {
              if (!dash) return;
              const tracks = await dash.bgm.remove(name);
              setBgm(tracks);
              if (createBgmSelected === name) {
                setCreateBgmSelected(tracks.find((t) => t.builtIn)?.name ?? null);
              }
            }}
            onBgmSelect={(name) => setCreateBgmSelected(name)}
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

        {screen === "queue" && (
          <QueueView
            queues={queues}
            active={activeQueueId ? queues.find((q) => q.id === activeQueueId) ?? null : null}
            load={queueLoad}
            defaultVoiceProvider={settings.voiceProvider}
            smokeRenderEnabled={settings.smokeRenderEnabled}
            bgm={bgm}
            bgmSelected={createBgmSelected}
            onBgmAdd={() => {
              if (!dash) return;
              void dash.bgm.add().then(setBgm).catch((error: unknown) => {
                const details = errorDetails(error);
                notify.error({
                  title: "Không thêm được nhạc",
                  message: compactNotificationMessage(details, "Thử lại."),
                  details,
                });
              });
            }}
            onBgmRemove={async (name) => {
              if (!dash) return;
              const next = await dash.bgm.remove(name);
              setBgm(next);
            }}
            onBgmSelect={(name) => setCreateBgmSelected(name)}
            onRefresh={() => void refreshQueues()}
            onCreateQueue={async () => {
              if (!dash?.queue) return;
              const created = await dash.queue.create();
              setQueues((prev) => [created, ...prev.filter((q) => q.id !== created.id)]);
              setActiveQueueId(created.id);
              setQueueLoad("ready");
            }}
            onOpenQueue={(id) => setActiveQueueId(id)}
            onDeleteQueue={(id) => setPendingQueueDeleteId(id)}
            onRenameQueue={async (id, title) => {
              if (!dash?.queue) return;
              const next = await dash.queue.rename(id, title);
              if (!next) throw new Error("Không đổi tên được hàng đợi.");
              setQueues((prev) => prev.map((q) => (q.id === next.id ? next : q)));
            }}
            onBackToList={() => {
              setActiveQueueId(null);
              void refreshQueues();
            }}
            onAddJob={async (input) => {
              if (!dash?.queue || !activeQueueId) return;
              const next = await dash.queue.addJob(activeQueueId, input);
              if (!next) throw new Error("Không thêm được prompt vào hàng đợi.");
              setQueues((prev) => prev.map((q) => (q.id === next.id ? next : q)));
            }}
            onUpdateJob={async (jobId, patch) => {
              if (!dash?.queue || !activeQueueId) return;
              const next = await dash.queue.updateJob(activeQueueId, jobId, patch);
              if (!next) throw new Error("Chỉ sửa được video đang chờ.");
              setQueues((prev) => prev.map((q) => (q.id === next.id ? next : q)));
            }}
            onDeleteJob={async (jobId) => {
              if (!dash?.queue || !activeQueueId) return;
              const next = await dash.queue.deleteJob(activeQueueId, jobId);
              if (!next) throw new Error("Không xóa được video (đang chạy?).");
              setQueues((prev) => prev.map((q) => (q.id === next.id ? next : q)));
            }}
            onCancelJob={async (jobId) => {
              if (!dash?.queue || !activeQueueId) return;
              const res = await dash.queue.cancelJob(activeQueueId, jobId);
              if (!res.ok) throw new Error(res.error);
              const list = await dash.queue.list();
              setQueues(list);
            }}
            queueStatus={queueStatus}
            onStartQueue={async () => {
              if (!dash?.queue || !activeQueueId) {
                return { ok: false as const, error: "Chưa mở hàng đợi." };
              }
              const res = await dash.queue.start(activeQueueId);
              if (res.ok) {
                const [list, st] = await Promise.all([dash.queue.list(), dash.queue.status()]);
                setQueues(list);
                setQueueStatus({
                  busy: Boolean(st.busy),
                  activeQueueId: st.activeQueueId ?? null,
                  pendingQueueIds: Array.isArray(st.pendingQueueIds) ? st.pendingQueueIds.map(String) : [],
                });
              }
              return res;
            }}
          />
        )}

        {screen === "settings" && (
          <SettingsView
            gateway={gateway}
            account={account}
            models={models}
            settings={settings}
            preferredModelUnavailable={preferredModelUnavailable}
            tab={settingsTab}
            onTabChange={setSettingsTab}
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
                      title: "Model chưa lưu được",
                      message: compactNotificationMessage(details, "Lựa chọn có thể mất sau khi mở lại app."),
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
            allowSceneEdit={reviewModeAllowsSceneEdit(settings.reviewMode)}
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
            onGenerateThumbnail={() =>
              dash?.thumbnail.generate(openProjectId) ?? Promise.resolve(null)
            }
            onSaveThumbnail={() =>
              dash?.thumbnail.save(openProjectId) ?? Promise.resolve({ saved: false })
            }
          />
        )}
      </main>
      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Xoá dự án?"
        message="Xoá vĩnh viễn dự án này. Hành động không thể hoàn tác."
        confirmLabel="Xoá"
        cancelLabel="Huỷ"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />
      <ConfirmDialog
        open={pendingQueueDeleteId !== null}
        title="Xóa hàng đợi?"
        message="Xóa hàng đợi và toàn bộ prompt đã xếp. Video đã tạo (nếu có) vẫn nằm ở tab Dự án."
        confirmLabel="Xóa"
        cancelLabel="Huỷ"
        danger
        onConfirm={confirmQueueDelete}
        onCancel={() => setPendingQueueDeleteId(null)}
      />
    </div>
  );
};
