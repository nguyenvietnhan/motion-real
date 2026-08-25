export type WordCue = {
  word: string;
  start: number;
  end: number;
};

export type BeatData = {
  id: string;
  role: string;
  vo: string;
  startFrame: number;
  durFrames: number;
  words: WordCue[];
};

export type CaptionWord = {
  word: string;
  start: number;
  end: number;
};
