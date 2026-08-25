import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { CAPTION_BAND_HEIGHT, CONTENT_AREA, UI_SAFE_RIGHT, WORD_TIMINGS_DEMO } from "../lib/geometry";

type SampleVideoProps = {
  titleText: string;
  showSafeAreaGuides: boolean;
};

const SampleVideo: React.FC<SampleVideoProps> = ({ titleText, showSafeAreaGuides }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleEnter = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: Math.round(fps * 0.5),
  });

  const activeWord = WORD_TIMINGS_DEMO.find(
    (w) => frame >= w.start && frame < w.end,
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#0B0E14", fontFamily: "sans-serif" }}>
      <div
        style={{
          position: "absolute",
          top: CONTENT_AREA.top,
          left: CONTENT_AREA.left,
          right: CONTENT_AREA.right,
        }}
      >
        <div
          style={{
            fontSize: 84,
            fontWeight: 800,
            color: "#F4F7FB",
            opacity: titleEnter,
            transform: `translateY(${interpolate(titleEnter, [0, 1], [40, 0])}px)`,
          }}
        >
          {titleText}
        </div>

        <div style={{ marginTop: 48, display: "flex", flexWrap: "wrap", gap: 16 }}>
          {WORD_TIMINGS_DEMO.map((w) => {
            const isActive = activeWord?.word === w.word;
            const appeared = frame >= w.start;
            return (
              <span
                key={w.word}
                style={{
                  fontSize: 52,
                  fontWeight: isActive ? 900 : 500,
                  color: isActive ? "#60A5FA" : appeared ? "#D7DEE8" : "#3A4354",
                  transform: `scale(${isActive ? 1.12 : 1})`,
                  transition: "none",
                }}
              >
                {w.word}
              </span>
            );
          })}
        </div>
      </div>

      {showSafeAreaGuides ? (
        <>
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: CONTENT_AREA.top,
              background: "rgba(255, 80, 80, 0.12)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: CAPTION_BAND_HEIGHT,
              background: "rgba(255, 80, 80, 0.12)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              right: 0,
              width: UI_SAFE_RIGHT,
              background: "rgba(255, 80, 80, 0.12)",
            }}
          />
        </>
      ) : null}

      <div
        style={{
          position: "absolute",
          bottom: 24,
          left: 0,
          right: 0,
          textAlign: "center",
          color: "#8B94A6",
          fontSize: 28,
        }}
      >
        caption band - de trong cho phu de nen tang
      </div>
    </AbsoluteFill>
  );
};

export default SampleVideo;
