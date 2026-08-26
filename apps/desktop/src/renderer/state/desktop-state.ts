import type {
  AiAccountState,
  GatewayState,
  ModelInfo,
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

export function runSingleFlight<T>(
  ref: { current: Promise<T> | null },
  run: () => Promise<T>,
): Promise<T> {
  if (ref.current) return ref.current;
  let request!: Promise<T>;
  request = Promise.resolve().then(run).finally(() => {
    if (ref.current === request) ref.current = null;
  });
  ref.current = request;
  return request;
}

export function sameProjectCards(a: readonly ProjectCardVM[], b: readonly ProjectCardVM[]): boolean {
  return a.length === b.length && a.every((card, index) => {
    const other = b[index];
    return other !== undefined
      && card.projectId === other.projectId
      && card.title === other.title
      && card.thumbnailPath === other.thumbnailPath
      && card.format === other.format
      && card.status === other.status
      && card.createdAtLabel === other.createdAtLabel;
  });
}

export function statusNeedsGalleryRefresh(cards: readonly ProjectCardVM[], event: StatusEvent): boolean {
  return event.status !== "building" || !cards.some((card) => card.projectId === event.projectId);
}

export function sameGatewayState(a: GatewayState, b: GatewayState): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "starting" && b.kind === "starting") return a.attempt === b.attempt;
  if (a.kind === "ready" && b.kind === "ready") return a.baseUrl === b.baseUrl;
  return true;
}

export function sameModels(a: readonly ModelInfo[], b: readonly ModelInfo[]): boolean {
  return a.length === b.length && a.every((model, index) => {
    const other = b[index];
    return other !== undefined && model.id === other.id && model.label === other.label;
  });
}

export function sameAiAccountState(a: AiAccountState, b: AiAccountState): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "connecting" && b.kind === "connecting") return a.provider === b.provider;
  if (a.kind !== "connected" || b.kind !== "connected") return true;
  return sameModels(
    a.selectedModel ? [a.selectedModel] : [],
    b.selectedModel ? [b.selectedModel] : [],
  ) && a.accounts.length === b.accounts.length && a.accounts.every((account, index) => {
    const other = b.accounts[index];
    return other !== undefined
      && account.provider === other.provider
      && account.label === other.label
      && account.active === other.active;
  });
}

/** Pure reducer: fold one action into the state. */
export function reduceDesktop(state: DesktopState, action: DesktopAction): DesktopState {
  switch (action.type) {
    case "status": {
      const index = state.gallery.cards.findIndex((card) => card.projectId === action.event.projectId);
      if (index < 0 || state.gallery.cards[index]?.status === action.event.status) return state;
      const cards = state.gallery.cards.slice();
      cards[index] = { ...cards[index]!, status: action.event.status };
      return { ...state, gallery: { ...state.gallery, cards } };
    }
    case "gallery":
      if (state.gallery.load === action.load && sameProjectCards(state.gallery.cards, action.cards)) return state;
      return { ...state, gallery: { load: action.load, cards: action.cards } };
    default:
      return state;
  }
}
