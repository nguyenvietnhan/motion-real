import type {
  AiAccountState,
  FriendlyError,
  GatewayState,
  LicenseState,
  ProgressEvent,
  ProjectCardVM,
  SceneEvent,
  SceneCard,
  SettingsModel,
  StatusEvent,
  StoryboardModel,
} from "../../shared/types.js";
import type { GalleryLoad } from "../gallery/gallery-controller.js";

/**
 * Renderer state + streaming-event reducer (web-dashboard Task 11.3, design
 * §Desktop app state). A PURE reducer the React UI uses to fold
 * `onProgress`/`onScene`/`onStatus`/`onFriendlyError` into `DesktopState`: the
 * progress %, the growing Storyboard, status badges, and friendly errors with
 * the correct retry action (Req 5.2/5.3/5.5/9.5/9.7/10.5). No engine internals
 * appear — only the already-translated view-models that cross IPC.
 */

export type OpenProject = {
  projectId: string;
  storyboard: StoryboardModel;
  draft: { hasReviewedDraft: boolean; draftMp4Path?: string; revision: number };
  progress?: { ratio: number; phase: "draft" | "full" };
  lastError?: FriendlyError;
};

export type DesktopState = {
  license: LicenseState;
  gateway: GatewayState;
  aiAccount: AiAccountState;
  settings: SettingsModel;
  gallery: { load: GalleryLoad; cards: ProjectCardVM[] };
  openProject?: OpenProject;
};

export type DesktopAction =
  | { type: "progress"; event: ProgressEvent }
  | { type: "scene"; event: SceneEvent }
  | { type: "status"; event: StatusEvent }
  | { type: "friendlyError"; error: FriendlyError }
  | { type: "openProject"; project: OpenProject }
  | { type: "gallery"; load: GalleryLoad; cards: ProjectCardVM[] };

function withScene(storyboard: StoryboardModel, event: SceneEvent): StoryboardModel {
  const existingIndex = storyboard.scenes.findIndex((s) => s.sceneId === event.sceneId);
  const card: SceneCard = {
    sceneId: event.sceneId,
    order: existingIndex >= 0 ? storyboard.scenes[existingIndex]!.order : storyboard.scenes.length,
    stillPath: event.stillPath,
    editText: existingIndex >= 0 ? storyboard.scenes[existingIndex]!.editText : "",
  };
  const scenes =
    existingIndex >= 0
      ? storyboard.scenes.map((s, i) => (i === existingIndex ? card : s))
      : [...storyboard.scenes, card];
  return { ...storyboard, scenes };
}

/** Pure reducer: fold one action into the state, only for the matching project. */
export function reduceDesktop(state: DesktopState, action: DesktopAction): DesktopState {
  switch (action.type) {
    case "progress": {
      if (state.openProject?.projectId !== action.event.projectId) return state;
      return {
        ...state,
        openProject: {
          ...state.openProject,
          progress: { ratio: action.event.ratio, phase: action.event.phase },
        },
      };
    }
    case "scene": {
      if (state.openProject?.projectId !== action.event.projectId) return state;
      return {
        ...state,
        openProject: { ...state.openProject, storyboard: withScene(state.openProject.storyboard, action.event) },
      };
    }
    case "status": {
      const cards = state.gallery.cards.map((c) =>
        c.projectId === action.event.projectId ? { ...c, status: action.event.status } : c,
      );
      return { ...state, gallery: { ...state.gallery, cards } };
    }
    case "friendlyError": {
      if (!state.openProject || state.openProject.projectId !== action.error.projectId) return state;
      return { ...state, openProject: { ...state.openProject, lastError: action.error } };
    }
    case "openProject":
      return { ...state, openProject: action.project };
    case "gallery":
      return { ...state, gallery: { load: action.load, cards: action.cards } };
    default:
      return state;
  }
}

/** The retry action to offer for a friendly error (drives the retry button). */
export function retryActionFor(error: FriendlyError): FriendlyError["retry"] {
  return error.retry;
}

export function progressPercent(state: DesktopState): number | null {
  const p = state.openProject?.progress;
  return p ? Math.max(0, Math.min(100, Math.round(p.ratio * 100))) : null;
}
