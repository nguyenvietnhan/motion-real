import type {
  AiAccountState,
  GatewayState,
  ProjectCardVM,
  SettingsModel,
  StatusEvent,
} from "../../shared/types.js";
import type { GalleryLoad } from "../../shared/gallery-controller.js";

/**
 * Renderer client state + reducer. The staged WORKSPACE flow (writing → script →
 * rendering → ready/error) is driven by polling `projects:stage` in App.tsx; the
 * only cross-cutting reduced state is the project gallery, into which streaming
 * `status` events fold to keep card badges live. Pure + total; only translated
 * view-models cross IPC (no engine internals).
 */

export type DesktopState = {
  gateway: GatewayState;
  aiAccount: AiAccountState;
  settings: SettingsModel;
  gallery: { load: GalleryLoad; cards: ProjectCardVM[] };
};

export type DesktopAction =
  | { type: "status"; event: StatusEvent }
  | { type: "gallery"; load: GalleryLoad; cards: ProjectCardVM[] };

/** Pure reducer: fold one action into the state. */
export function reduceDesktop(state: DesktopState, action: DesktopAction): DesktopState {
  switch (action.type) {
    case "status": {
      const cards = state.gallery.cards.map((c) =>
        c.projectId === action.event.projectId ? { ...c, status: action.event.status } : c,
      );
      return { ...state, gallery: { ...state.gallery, cards } };
    }
    case "gallery":
      return { ...state, gallery: { load: action.load, cards: action.cards } };
    default:
      return state;
  }
}
