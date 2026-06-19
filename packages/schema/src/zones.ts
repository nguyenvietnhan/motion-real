/**
 * Layout zones for the 9:16 (1080×1920) canvas — the single source of truth for
 * WHERE content, captions, and platform UI live. Blocks (`@news/blocks`), the
 * master composition, and the N14 oracles all read these so the rules never
 * drift between authoring and validation (author-mode-v2 R15).
 *
 * ONE shared layout for every style. Styles differ only in CHROME (the "outfit":
 * square vs rounded corners, framed vs frameless, fonts/colors) — NOT in where
 * content/captions sit. So these zones are plain global constants; the oracles
 * and every block read the same rectangles regardless of style pack.
 *
 * Rationale (short-platform friendly):
 *  - Primary content lives in an UPPER band (the content zone) so TikTok/Reels/
 *    Shorts UI and our own captions at the bottom never cover the message.
 *  - Captions get their own band below the content zone, sitting low (close to
 *    where viewers expect subtitles) while staying mostly above the host
 *    platform's own bottom UI.
 *  - The bottom + right "platform-UI reserve" is kept clear, because the host app
 *    overlays its caption/username (bottom) and action rail (right). It is a
 *    VALIDATION threshold only — nothing renders from it.
 *
 * Pure constants only (no IO / no design import): `@news/schema` is the lowest
 * layer, so it cannot depend on `@news/design`.
 */

/** Fixed render canvas (mirrors `@news/design` CANVAS; kept here to avoid a layer cycle). */
export const CANVAS = { width: 1080, height: 1920 } as const;

/** An axis-aligned rectangle in canvas pixel space. */
export type Rect = { top: number; bottom: number; left: number; right: number };

/**
 * Where a scene's PRIMARY content must live: a top-margin → ~68% height band,
 * biased upper/middle (never pinned to the very top, never into the caption
 * band). `Content`/`Story` lay out inside this; the caption divider is drawn at
 * its bottom; N14 flags content outside it.
 *
 * Lowered from the historical bottom of 1190 to 1350 so every scene gets more
 * vertical room for images/visualizations, and so the divider sits close to the
 * caption (only a ~20px gap) rather than floating well above it. ONE shared zone
 * for all styles (styles differ only in chrome, not in where content sits).
 */
export const CONTENT_ZONE: Rect = { top: 96, bottom: 1350, left: 80, right: 1000 };

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

// --- Format-parameterized geometry (freeform-engine R7/D3) ------------------
//
// The constants above are the TikTok (9:16) layout — historically the ONLY
// format, so they are plain globals. The engine now also targets YouTube
// (16:9), so WHERE content/captions live becomes a function of `format`.
// `geometry(format)` is the single source of truth every consumer (blocks,
// composition, the in-frame oracle) reads instead of the bare globals, so the
// two formats never drift. The TikTok branch returns the exact globals above —
// zero regression for vertical.

/** The two supported delivery formats. Canvas + zones are a function of this. */
export type VideoFormat = "tiktok" | "youtube";

/**
 * Everything WHERE-related, resolved for one format: the canvas, the content
 * zone, the (optional) caption band, the platform-UI reserve, and a thin
 * `safeMargin` ring used by the single "don't fly off the frame" oracle.
 */
export type FormatGeometry = {
  format: VideoFormat;
  canvas: { width: number; height: number };
  contentZone: Rect;
  /** null ⇒ this format has NO burned caption band (YouTube has native captions). */
  captionBand: Rect | null;
  uiReserve: { bottom: number; right: number };
  /** Outer ring (px) beyond the canvas edge before content is "off-frame". */
  safeMargin: number;
};

/** YouTube 16:9 canvas. */
const YOUTUBE_CANVAS = { width: 1920, height: 1080 } as const;

/**
 * YouTube content zone = nearly the whole 16:9 frame minus a thin safe margin.
 * 16:9 has no host platform overlay on the video itself, so there is no
 * caption band and no UI reserve — content uses essentially the full frame.
 */
const YOUTUBE_CONTENT_MARGIN = 64;
const YOUTUBE_CONTENT_ZONE: Rect = {
  top: YOUTUBE_CONTENT_MARGIN,
  bottom: YOUTUBE_CANVAS.height - YOUTUBE_CONTENT_MARGIN,
  left: YOUTUBE_CONTENT_MARGIN,
  right: YOUTUBE_CANVAS.width - YOUTUBE_CONTENT_MARGIN,
};

/**
 * Resolve the layout geometry for a format. TikTok returns the exact vertical
 * globals (no regression); YouTube returns the 16:9 full-frame layout with no
 * caption band and no UI reserve.
 */
export function geometry(format: VideoFormat): FormatGeometry {
  if (format === "youtube") {
    return {
      format,
      canvas: { width: YOUTUBE_CANVAS.width, height: YOUTUBE_CANVAS.height },
      contentZone: YOUTUBE_CONTENT_ZONE,
      captionBand: null,
      uiReserve: { bottom: 0, right: 0 },
      safeMargin: 24,
    };
  }
  return {
    format: "tiktok",
    canvas: { width: CANVAS.width, height: CANVAS.height },
    contentZone: CONTENT_ZONE,
    captionBand: CAPTION_BAND,
    uiReserve: { bottom: UI_RESERVE.bottom, right: UI_RESERVE.right },
    safeMargin: 24,
  };
}
