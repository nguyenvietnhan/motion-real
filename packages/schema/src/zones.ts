/**
 * Layout zones for the 9:16 (1080×1920) canvas — the single source of truth for
 * WHERE content, captions, and platform UI live. Blocks (`@news/blocks`), the
 * master composition, and the N14 safe-area oracle all read these so the rules
 * never drift between authoring and validation (author-mode-v2 R15).
 *
 * Rationale (short-platform friendly):
 *  - Primary content lives in an UPPER band (the content zone) so TikTok/Reels/
 *    Shorts UI and our own captions at the bottom never cover the message.
 *  - Captions get their own band below the content zone.
 *  - The bottom + right "platform-UI reserve" is kept clear of both, because the
 *    host app overlays its caption/username (bottom) and action rail (right).
 *
 * Pure constants only (no IO / no design import): `@news/schema` is the lowest
 * layer, so it cannot depend on `@news/design`.
 */

/** Fixed render canvas (mirrors `@news/design` CANVAS; kept here to avoid a layer cycle). */
export const CANVAS = { width: 1080, height: 1920 } as const;

/** An axis-aligned rectangle in canvas pixel space. */
export type Rect = { top: number; bottom: number; left: number; right: number };

/**
 * Where a scene's PRIMARY content must live: a top-margin → ~62% height band,
 * biased upper/middle (never pinned to the very top, never into the caption
 * band). `Content` lays out inside this; N14 flags content outside it.
 */
export const CONTENT_ZONE: Rect = { top: 96, bottom: 1190, left: 80, right: 1000 };

/**
 * Where the burned-in single-line caption renders: ~64% → ~84% height, with
 * horizontal margins that clear the right-side action rail.
 */
export const CAPTION_BAND: Rect = { top: 1230, bottom: 1610, left: 96, right: 984 };

/**
 * Kept clear of content AND captions: the host platform paints its own UI here
 * (bottom caption/username band + right action rail).
 */
export const UI_RESERVE = { bottom: 300, right: 140 } as const;

/** Inclusive width/height helpers for layout + oracle math. */
export function rectWidth(r: Rect): number {
  return r.right - r.left;
}
export function rectHeight(r: Rect): number {
  return r.bottom - r.top;
}

/** True when `inner` is fully contained within `outer` (with optional slack px). */
export function rectContains(outer: Rect, inner: Rect, slack = 0): boolean {
  return (
    inner.left >= outer.left - slack &&
    inner.right <= outer.right + slack &&
    inner.top >= outer.top - slack &&
    inner.bottom <= outer.bottom + slack
  );
}

/** The y where the platform-UI reserve begins (content/captions must stay above it). */
export function uiReserveTop(): number {
  return CANVAS.height - UI_RESERVE.bottom;
}
