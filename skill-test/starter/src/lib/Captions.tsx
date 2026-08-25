import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { CaptionWord } from "../video/types";
import { CAPTION_BAND_HEIGHT } from "./geometry";

type Line = { words: CaptionWord[]; start: number; end: number };

const MAX_WORDS_PER_LINE = 4;

const buildLines = (words: CaptionWord[]): Line[] => {
  const lines: Line[] = [];
  for (let i = 0; i < words.length; i += MAX_WORDS_PER_LINE) {
    const chunk = words.slice(i, i + MAX_WORDS_PER_LINE);
    lines.push({ words: chunk, start: chunk[0].start, end: chunk[chunk.length - 1].end });
  }
  return lines;
};

type CaptionsProps = {
  words: CaptionWord[];
  textColor?: string;
  activeColor?: string;
  shadow?: string;
};

export const Captions: React.FC<CaptionsProps> = ({
  words,
  textColor = "rgba(255,255,255,0.55)",
  activeColor = "#FFFFFF",
  shadow = "0 2px 12px rgba(0,0,0,0.85)",
}) => {
  const frame = useCurrentFrame();
  const lines = useMemo(() => buildLines(words), [words]);

  const lineIndex = lines.findIndex(
    (l, i) => frame >= l.start - 2 && (i === lines.length - 1 || frame < lines[i + 1].start),
  );
  if (lineIndex < 0) return null;

  const line = lines[lineIndex];
  const appear = interpolate(frame, [line.start - 2, line.start + 3], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ fontFamily: "sans-serif" }}>
      <div
        style={{
          position: "absolute",
          left: 60,
          right: 60,
          bottom: CAPTION_BAND_HEIGHT - 60,
          display: "flex",
          justifyContent: "center",
          alignItems: "baseline",
          gap: 16,
          flexWrap: "wrap",
          opacity: appear,
        }}
      >
        {line.words.map((w) => {
          const active = frame >= w.start && frame < w.end;
          return (
            <span
              key={`${w.start}-${w.word}`}
              style={{
                fontSize: 54,
                fontWeight: 700,
                color: active ? activeColor : textColor,
                textShadow: shadow,
              }}
            >
              {w.word}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
