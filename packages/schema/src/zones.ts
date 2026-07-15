/**
 * Layout zones for the 9:16 (1080×1920) canvas — the single source of truth for
 * WHERE content, captions, and platform UI live. Blocks (`@motionreal/blocks`), the
 * master composition, and the N14 oracles all read these so the rules never
 * drift between authoring and validation.
 *
 * ONE shared layout for every visual treatment. Chrome may differ (corners,
 * framing, fonts/colors) — NOT where content/captions sit. So these zones are
 * plain global constants; the oracles and every block read the same rectangles
 * regardless of visual treatment.
 *
 * Rationale (short-platform friendly):
 * - Primary content lives in an UPPER band (the content zone) so TikTok/Reels/
 * Shorts UI and our own captions at the bottom never cover the message.
 * - Captions get their own band below the content zone, sitting low (close to
 * where viewers expect subtitles) while staying mostly above the host
 * platform's own bottom UI.
 * - The bottom + right "platform-UI reserve" is kept clear, because the host app
 * overlays its caption/username (bottom) and action rail (right). It is a
 * VALIDATION threshold only — nothing renders from it.
 *
 * Pure constants only (no IO / no design import): `@motionreal/schema` is the lowest
 * layer, so it cannot depend on any design system.
 */

/** Fixed render canvas (mirrors the render design-system CANVAS; kept here to avoid a layer cycle). */
export const CANVAS = { width: 1080, height: 1920 } as const;

/** An axis-aligned rectangle in canvas pixel space. */
export type Rect = { top: number; bottom: number; left: number; right: number };

/**
 * Where a scene's PRIMARY content must live: a top-margin → mid band (~65%
 * height), biased upper/middle (not glued to the top edge, never into the
 * caption band). The caption divider is drawn at its bottom; N14 flags content
 * outside it.
 *
 * Bottom 1350 keeps the divider near the caption (~20px gap). Top 160 (was 96)
 * is a light nudge so primary content sits a bit lower under status-bar chrome
 * without dumping the composition into the lower third. ONE shared zone for all
 * visual treatments (chrome differs, not where content sits).
 */
export const CONTENT_ZONE: Rect = { top: 160, bottom: 1350, left: 80, right: 1000 };

/**
 * Where the burned-in single-line caption renders: a band beneath the content
 * zone, sitting low (near where viewers expect subtitles). Its bottom lands on
 * the platform-UI reserve floor (1650), so the caption sits as low as we allow
 * before it would collide with the host app's own bottom UI.
 */
export const CAPTION_BAND: Rect = { top: 1370, bottom: 1650, left: 96, right: 984 };

/**
 * Kept clear of content AND captions: the host platform paints its own UI here
 * (bottom caption/username band + right action rail). VALIDATION threshold only
 * — nothing renders from this. `right` uses the real-world safe-area value (150)
 * confirmed from current platform layouts; `bottom` (270) is a deliberate product
 * choice — a touch lower than the most conservative estimate — so the caption can
 * sit low (it may lightly overlap the very top of the platform UI band, which is
 * acceptable for a single-line burned caption), while still leaving the reserve
 * for the host app's controls.
 */
export const UI_RESERVE = { bottom: 270, right: 150 } as const;

/** Inclusive width/height helpers for layout + oracle math. */
export function rectWidth(r: Rect): number {
  return r.right - r.left;
}
export function rectHeight(r: Rect): number {
  return r.bottom - r.top;
}

// --- Short-form geometry (9:16 only) ----------------------------------------
//
// Product is TikTok/Reels/Shorts vertical only. `geometry()` is the single
// source of truth every consumer (blocks, composition, oracles) reads.

/** Delivery format. Short-form vertical only. */
export type VideoFormat = "tiktok";

/**
 * Everything WHERE-related: the canvas, the content zone, the caption band,
 * the platform-UI reserve, and a thin `safeMargin` ring for the off-frame oracle.
 */
export type FormatGeometry = {
  format: VideoFormat;
  canvas: { width: number; height: number };
  contentZone: Rect;
  captionBand: Rect;
  uiReserve: { bottom: number; right: number };
  /** Outer ring (px) beyond the canvas edge before content is "off-frame". */
  safeMargin: number;
};

/**
 * Resolve short-form 9:16 layout geometry. Accepts optional format for call-site
 * compatibility; only `"tiktok"` is valid.
 */
export function geometry(): FormatGeometry {
  return {
    format: "tiktok",
    canvas: { width: CANVAS.width, height: CANVAS.height },
    contentZone: CONTENT_ZONE,
    captionBand: CAPTION_BAND,
    uiReserve: { bottom: UI_RESERVE.bottom, right: UI_RESERVE.right },
    safeMargin: 24,
  };
}
