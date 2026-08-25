export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
export const VIDEO_FPS = 30;

export const CAPTION_BAND_HEIGHT = 340;
export const UI_SAFE_RIGHT = 160;

export const CONTENT_AREA = {
  top: 160,
  bottom: CAPTION_BAND_HEIGHT,
  left: 72,
  right: UI_SAFE_RIGHT,
} as const;

export const secondsToFrames = (seconds: number, fps = VIDEO_FPS): number =>
  Math.round(seconds * fps);

export type WordTiming = {
  word: string;
  start: number;
  end: number;
};

export const clampProgress = (frame: number, durationInFrames: number): number =>
  durationInFrames > 1 ? Math.min(1, Math.max(0, frame / (durationInFrames - 1))) : 1;

export const WORD_TIMINGS_DEMO: WordTiming[] = [
  { word: "Đây", start: 30, end: 42 },
  { word: "là", start: 42, end: 54 },
  { word: "con", start: 54, end: 66 },
  { word: "mèo", start: 66, end: 96 },
];
