/**
 * Author + render the Google DeepMind "D4RT / 4D reconstruction" video — authored
 * FRESH for this topic (bespoke visuals per the playbook). Usage:
 *   npx tsx scripts/build-d4rt.ts stills
 *   npx tsx --env-file=.env scripts/build-d4rt.ts draft vivibe
 *   npx tsx --env-file=.env scripts/build-d4rt.ts full  vivibe
 *
 * Facts from the supplied brief (evidence gate, N9): D4RT = Dynamic 4D
 * Reconstruction and Tracking; one unified Transformer vs stitched depth/motion/
 * camera models; 1-min video in ~5s on a TPU vs ~10 min (≈120×; 18–300× across
 * benchmarks); SOTA on Sintel/Aria/RE10k (top AUC); Best Paper CVPR 2026
 * (DeepMind, UCL, Oxford); step toward a world model / AGI; still research.
 */
import {
  scaffoldVideoProject, renderProject, admitProjectScenes, loadManifestAsSpec,
  synthesizeNarration, lockSpec, renderSceneStills, generateAuthoredEntry, remotionAppRoot,
} from "../packages/pipeline/src/index.js";
import { projectPaths, writeJson } from "../packages/pipeline/src/store/store.js";
import { writeAuthoredScene } from "../packages/pipeline/src/authoring/manifest.js";

const ID = "deepmind-d4rt";
const TARGET_SECONDS = 90 as const;

// 1) EYE — three temporal states; the "object" square shifts across past→now→future.
const EYE = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, useTheme, frameRamp } from "@news/blocks";
import { PRINT, onColor } from "@news/design";
export const schema = z.object({ meta: z.string().optional(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const ink = PRINT.ink;
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const states = [{ tag: "QUÁ KHỨ", word: "Nhớ", k: "faded" }, { tag: "HIỆN TẠI", word: "Thấy", k: "now" }, { tag: "TƯƠNG LAI", word: "Đoán", k: "future" }];
  return (
    <Frame><Story eyebrow={eyebrow ?? "THỊ GIÁC"} label="MẮT NGƯỜI" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ display: "flex", gap: 18, alignItems: "stretch" }}>
        {states.map((s, i) => {
          const r = frameRamp(f, fps, 8 + i * 9, 20); const now = s.k === "now"; const future = s.k === "future";
          const pos = i === 0 ? "flex-start" : i === 1 ? "center" : "flex-end";
          const fg = now ? onColor(theme.colors.accent) : ink;
          return (
            <div key={i} style={{ flex: 1, border: (future ? "4px dashed " : "4px solid ") + ink, background: now ? theme.colors.accent : theme.colors.panel, color: fg, opacity: (s.k === "faded" ? 0.55 : 1) * r, transform: "translateY(" + ((1 - r) * 22).toFixed(1) + "px)", boxShadow: now ? "8px 8px 0 " + ink : "none", padding: "18px 16px", display: "grid", gap: 14 }}>
              <span style={{ fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 20, letterSpacing: "0.06em" }}>{s.tag}</span>
              <div style={{ height: 72, border: "3px solid " + fg, display: "flex", alignItems: "center", justifyContent: pos, padding: "0 10px" }}>
                <div style={{ width: 30, height: 30, background: fg, borderRadius: 0 }} />
              </div>
              <span style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 36, lineHeight: 1 }}>{s.word}</span>
            </div>
          );
        })}
      </div>
    </Story></Frame>
  );
};
export const example: P = { meta: "2026" };
export default registerComponent<P>({ id: "d4-eye", displayName: "Eye", promptGuide: "three temporal states past/present/future", schema, Component: Scene, example });
`;

// 2) FLAT3D — a stack of flat 2D frames transformed into a drawn 3D cube.
const FLAT3D = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, useTheme, frameRamp } from "@news/blocks";
import { PRINT, withAlpha } from "@news/design";
export const schema = z.object({ meta: z.string().optional(), leftLabel: z.string(), rightLabel: z.string(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const ink = PRINT.ink; const accent = theme.colors.accent;
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const a = frameRamp(f, fps, 8, 20); const arr = frameRamp(f, fps, 22, 12); const b = frameRamp(f, fps, 28, 22);
  return (
    <Frame><Story eyebrow={eyebrow ?? "BÀI TOÁN"} label="2D → 3D" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ display: "flex", gap: 14, alignItems: "center", justifyContent: "center" }}>
        <div style={{ flex: 1, display: "grid", gap: 12, justifyItems: "center", opacity: a }}>
          <div style={{ position: "relative", width: 190, height: 150 }}>
            {[0, 1, 2, 3].map((k) => (<div key={k} style={{ position: "absolute", left: (k * 18) + "px", top: (k * 13) + "px", width: 120, height: 84, border: "4px solid " + ink, background: theme.colors.panel }} />))}
          </div>
          <span style={{ fontFamily: theme.fonts.mono, fontSize: 22, color: theme.colors.muted }}>{props.leftLabel}</span>
        </div>
        <div style={{ width: 0, height: 0, borderTop: "16px solid transparent", borderBottom: "16px solid transparent", borderLeft: "26px solid " + accent, opacity: arr }} />
        <div style={{ flex: 1, display: "grid", gap: 12, justifyItems: "center", opacity: b, transform: "translateY(" + ((1 - b) * 20).toFixed(1) + "px)" }}>
          <svg viewBox="0 0 160 165" width="186" height="192" style={{ display: "block" }}>
            <polygon points="80,18 142,50 80,82 18,50" fill={accent} stroke={ink} strokeWidth="5" strokeLinejoin="round" />
            <polygon points="18,50 80,82 80,150 18,118" fill={withAlpha(accent, 0.5)} stroke={ink} strokeWidth="5" strokeLinejoin="round" />
            <polygon points="142,50 80,82 80,150 142,118" fill={withAlpha(ink, 0.82)} stroke={ink} strokeWidth="5" strokeLinejoin="round" />
          </svg>
          <span style={{ fontFamily: theme.fonts.mono, fontSize: 22, fontWeight: 800, color: ink }}>{props.rightLabel}</span>
        </div>
      </div>
    </Story></Frame>
  );
};
export const example: P = { leftLabel: "Video 2D phẳng", rightLabel: "Thế giới 3D động" };
export default registerComponent<P>({ id: "d4-flat3d", displayName: "Flat3D", promptGuide: "2D frame stack transformed into a 3D cube", schema, Component: Scene, example });
`;

// 3) DEFINE — 4D = three space axes + time (a squared equation).
const DEFINE = `import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, useTheme, useRamp } from "@news/blocks";
import { PRINT, onColor } from "@news/design";
export const schema = z.object({ meta: z.string().optional(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const ink = PRINT.ink; const accent = theme.colors.accent;
  const t = useRamp(8, 24);
  const chip = (label: string, sub: string, solid: boolean) => (
    <div style={{ border: "4px solid " + ink, background: solid ? accent : theme.colors.panel, color: solid ? onColor(accent) : ink, padding: "16px 18px", display: "grid", gap: 4, justifyItems: "center", minWidth: 104, boxShadow: solid ? "6px 6px 0 " + ink : "none" }}>
      <span style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 52, lineHeight: 1 }}>{label}</span>
      <span style={{ fontFamily: theme.fonts.mono, fontSize: 17, letterSpacing: "0.04em", color: solid ? onColor(accent) : theme.colors.muted }}>{sub}</span>
    </div>
  );
  const op = (s: string) => (<span style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 46, color: ink }}>{s}</span>);
  return (
    <Frame><Story eyebrow={eyebrow ?? "KHÁI NIỆM"} label="TÁI DỰNG 4D" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", justifyContent: "center", opacity: t }}>
        {chip("X", "rộng", false)}{chip("Y", "cao", false)}{chip("Z", "sâu", false)}{op("+")}{chip("T", "thời gian", false)}{op("=")}{chip("4D", "không-thời gian", true)}
      </div>
    </Story></Frame>
  );
};
export const example: P = { meta: "2026" };
export default registerComponent<P>({ id: "d4-define", displayName: "Define", promptGuide: "4D = three space axes + time equation", schema, Component: Scene, example });
`;

// 4) UNIFY — three stitched specialist boxes vs one unified D4RT Transformer.
const UNIFY = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, useTheme, frameRamp } from "@news/blocks";
import { PRINT, onColor } from "@news/design";
export const schema = z.object({ meta: z.string().optional(), parts: z.array(z.string()).length(3), oldLabel: z.string(), newLabel: z.string(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const ink = PRINT.ink;
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const a = frameRamp(f, fps, 8, 20); const arr = frameRamp(f, fps, 20, 12); const b = frameRamp(f, fps, 26, 22);
  return (
    <Frame><Story eyebrow={eyebrow ?? "MÔ HÌNH"} label="HỢP NHẤT" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <div style={{ flex: 1, display: "grid", gap: 10, opacity: a, filter: "grayscale(1)" }}>
          {props.parts.map((p, i) => (<div key={i} style={{ border: "4px dashed " + ink, background: theme.colors.panel, color: ink, padding: "14px 16px", fontWeight: 700, fontSize: 24, textAlign: "center" }}>{p}</div>))}
          <div style={{ fontFamily: theme.fonts.mono, fontSize: 20, letterSpacing: "0.06em", color: theme.colors.muted, textAlign: "center" }}>{props.oldLabel}</div>
        </div>
        <div style={{ width: 0, height: 0, borderTop: "16px solid transparent", borderBottom: "16px solid transparent", borderLeft: "26px solid " + theme.colors.accent, opacity: arr }} />
        <div style={{ flex: 1, border: "4px solid " + ink, background: theme.colors.accent, color: onColor(theme.colors.accent), boxShadow: "10px 10px 0 " + ink, padding: "22px 20px", display: "grid", gap: 14, opacity: b, transform: "translateY(" + ((1 - b) * 22).toFixed(1) + "px)" }}>
          <div style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 56, lineHeight: 1 }}>D4RT</div>
          <div style={{ fontFamily: theme.fonts.mono, fontSize: 22, letterSpacing: "0.06em" }}>{props.newLabel}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{props.parts.map((p, i) => (<span key={i} style={{ border: "3px solid " + onColor(theme.colors.accent), padding: "6px 12px", fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 19 }}>{p}</span>))}</div>
        </div>
      </div>
    </Story></Frame>
  );
};
export const example: P = { parts: ["Độ sâu", "Chuyển động", "Góc máy"], oldLabel: "Chắp vá · chậm", newLabel: "1 Transformer · 1 video" };
export default registerComponent<P>({ id: "d4-unify", displayName: "Unify", promptGuide: "stitched specialist models vs one unified model", schema, Component: Scene, example });
`;

// 5) FLOW — encoder→decoder pipeline + a fan of parallel per-pixel questions.
const FLOW = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, useTheme, frameRamp } from "@news/blocks";
import { PRINT, onColor } from "@news/design";
export const schema = z.object({ meta: z.string().optional(), stages: z.array(z.string()).length(3), parallelLabel: z.string(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const ink = PRINT.ink;
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const box = (label: string, i: number, mid: boolean) => {
    const r = frameRamp(f, fps, 8 + i * 11, 18);
    return (<div style={{ flex: 1, border: "4px solid " + ink, background: mid ? theme.colors.accent : theme.colors.panel, color: mid ? onColor(theme.colors.accent) : ink, boxShadow: mid ? "8px 8px 0 " + ink : "none", minHeight: 120, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "16px 12px", fontWeight: 800, fontSize: 23, lineHeight: 1.15, opacity: r, transform: "translateY(" + ((1 - r) * 18).toFixed(1) + "px)" }}>{label}</div>);
  };
  const arrow = (i: number) => (<div style={{ width: 38, display: "flex", justifyContent: "center", alignItems: "center" }}><div style={{ width: 0, height: 0, borderTop: "12px solid transparent", borderBottom: "12px solid transparent", borderLeft: "18px solid " + ink, opacity: frameRamp(f, fps, 14 + i * 11, 12) }} /></div>);
  const fan = frameRamp(f, fps, 40, 20);
  return (
    <Frame><Story eyebrow={eyebrow ?? "CƠ CHẾ"} label="MÃ HÓA → GIẢI MÃ" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ display: "flex", alignItems: "center" }}>{box(props.stages[0]!, 0, false)}{arrow(0)}{box(props.stages[1]!, 1, true)}{arrow(1)}{box(props.stages[2]!, 2, false)}</div>
      <div style={{ border: "4px solid " + ink, background: theme.colors.bg, padding: "16px 18px", display: "grid", gap: 12, opacity: fan }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 56, justifyContent: "center" }}>{Array.from({ length: 11 }).map((_, k) => { const g = frameRamp(f, fps, 42 + k * 2, 12); return (<div key={k} style={{ width: 16, height: (20 + (k % 3) * 16) + "px", background: theme.colors.accent, border: "2px solid " + ink, opacity: g }} />); })}</div>
        <div style={{ fontFamily: theme.fonts.mono, fontSize: 22, letterSpacing: "0.04em", color: ink, textAlign: "center", fontWeight: 800 }}>{props.parallelLabel}</div>
      </div>
    </Story></Frame>
  );
};
export const example: P = { stages: ["Video", "Bộ mã hóa: nén biểu diễn", "Bộ giải mã nhẹ"], parallelLabel: "Hàng nghìn câu hỏi · trả lời song song" };
export default registerComponent<P>({ id: "d4-flow", displayName: "Flow", promptGuide: "encoder-decoder pipeline with parallel per-pixel questions", schema, Component: Scene, example });
`;

// 6) SPEED — two time bars (old vs D4RT) + the headline multiplier.
const SPEED = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, useTheme, frameRamp } from "@news/blocks";
import { PRINT, onColor } from "@news/design";
export const schema = z.object({ meta: z.string().optional(), oldLabel: z.string(), oldValue: z.string(), newLabel: z.string(), newValue: z.string(), factor: z.string(), note: z.string(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const ink = PRINT.ink;
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const gOld = frameRamp(f, fps, 8, 24); const gNew = frameRamp(f, fps, 22, 20); const gF = frameRamp(f, fps, 40, 16);
  const row = (label: string, value: string, widthPct: number, grow: number, accent: boolean) => (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: theme.fonts.mono, fontSize: 24, color: ink }}><span style={{ fontWeight: 800 }}>{label}</span><span style={{ color: accent ? theme.colors.accent : theme.colors.muted, fontWeight: 800 }}>{value}</span></div>
      <div style={{ height: 46, border: "4px solid " + ink, background: theme.colors.bg }}><div style={{ height: "100%", width: (widthPct * grow).toFixed(1) + "%", background: accent ? theme.colors.accent : theme.colors.muted }} /></div>
    </div>
  );
  return (
    <Frame><Story eyebrow={eyebrow ?? "TỐC ĐỘ"} label="MỘT VIDEO 1 PHÚT" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ display: "grid", gap: 20 }}>
        {row(props.oldLabel, props.oldValue, 100, gOld, false)}
        {row(props.newLabel, props.newValue, 9, gNew, true)}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, opacity: gF }}>
        <span style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 120, lineHeight: 0.9, color: theme.colors.accent, letterSpacing: "-0.02em" }}>{props.factor}</span>
        <span style={{ fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 30, color: ink }}>{props.note}</span>
      </div>
    </Story></Frame>
  );
};
export const example: P = { oldLabel: "Cách cũ", oldValue: "≈ 10 phút", newLabel: "D4RT", newValue: "≈ 5 giây", factor: "120×", note: "nhanh hơn · 18–300× qua các phép thử" };
export default registerComponent<P>({ id: "d4-speed", displayName: "Speed", promptGuide: "old vs new time bars + speed multiplier", schema, Component: Scene, example });
`;

// 7) BENCH — three SOTA benchmark tiles + a Best-Paper award ribbon.
const BENCH = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, useTheme, frameRamp } from "@news/blocks";
import { PRINT, onColor } from "@news/design";
export const schema = z.object({ meta: z.string().optional(), items: z.array(z.object({ name: z.string(), desc: z.string() })).min(2).max(3), award: z.string(), orgs: z.string(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const ink = PRINT.ink;
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const aw = frameRamp(f, fps, 30, 18);
  return (
    <Frame><Story eyebrow={eyebrow ?? "CHẤT LƯỢNG"} label="SOTA · 4D" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
        {props.items.map((it, i) => { const r = frameRamp(f, fps, 8 + i * 8, 20); return (
          <div key={i} style={{ flex: 1, border: "4px solid " + ink, background: theme.colors.panel, opacity: r, transform: "translateY(" + ((1 - r) * 22).toFixed(1) + "px)", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: theme.colors.bg, borderBottom: "4px solid " + ink, padding: "10px 14px" }}>
              <span style={{ fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 22, color: ink }}>{it.name}</span>
              <span style={{ fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 16, color: onColor(theme.colors.accent), background: theme.colors.accent, border: "2px solid " + ink, padding: "3px 8px" }}>SOTA</span>
            </div>
            <div style={{ padding: "18px 16px", fontSize: 23, lineHeight: 1.3, color: ink }}>{it.desc}</div>
          </div>
        ); })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, border: "4px solid " + ink, background: theme.colors.accent, color: onColor(theme.colors.accent), boxShadow: "8px 8px 0 " + ink, padding: "16px 20px", opacity: aw }}>
        <span style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 30, lineHeight: 1 }}>{props.award}</span>
        <span style={{ fontFamily: theme.fonts.mono, fontSize: 20, letterSpacing: "0.04em" }}>{props.orgs}</span>
      </div>
    </Story></Frame>
  );
};
export const example: P = { items: [{ name: "Sintel", desc: "Chuyển động nhanh, đầy nhòe" }, { name: "Aria", desc: "Video kính thông minh" }, { name: "RE10k", desc: "Góc máy · AUC cao nhất" }], award: "Best Paper · CVPR 2026", orgs: "DeepMind · UCL · Oxford" };
export default registerComponent<P>({ id: "d4-bench", displayName: "Bench", promptGuide: "benchmark SOTA tiles + award ribbon", schema, Component: Scene, example });
`;

// 8) APPS — three application cards (robot / AR glasses / world model → AGI).
const APPS = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, useTheme, frameRamp } from "@news/blocks";
import { PRINT } from "@news/design";
export const schema = z.object({ meta: z.string().optional(), cards: z.array(z.object({ title: z.string(), text: z.string() })).min(2).max(3), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const ink = PRINT.ink;
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const TONES = [theme.colors.accent, "#1FA463", "#7A4DE0"];
  return (
    <Frame><Story eyebrow={eyebrow ?? "ỨNG DỤNG"} label="VÌ SAO ĐÁNG QUAN TÂM" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ display: "flex", gap: 16, alignItems: "stretch" }}>
        {props.cards.map((c, i) => { const r = frameRamp(f, fps, 8 + i * 8, 22); const col = TONES[i % TONES.length]!; return (
          <div key={i} style={{ flex: 1, border: "4px solid " + ink, background: theme.colors.panel, opacity: r, transform: "translateY(" + ((1 - r) * 24).toFixed(1) + "px)", boxShadow: "8px 8px 0 " + col, display: "flex", flexDirection: "column" }}>
            <div style={{ height: 12, background: col, borderBottom: "4px solid " + ink }} />
            <div style={{ padding: "20px 18px", display: "grid", gap: 12 }}>
              <div style={{ fontWeight: 900, fontSize: 30, lineHeight: 1.1, color: col }}>{c.title}</div>
              <div style={{ fontSize: 24, lineHeight: 1.3, color: ink }}>{c.text}</div>
            </div>
          </div>
        ); })}
      </div>
    </Story></Frame>
  );
};
export const example: P = { cards: [{ title: "Robot", text: "Hiểu môi trường động để đi an toàn." }, { title: "Kính AR", text: "Dựng hình tức thì, đặt vật ảo đúng chỗ." }] };
export default registerComponent<P>({ id: "d4-apps", displayName: "Apps", promptGuide: "application cards", schema, Component: Scene, example });
`;

// 9) CAVEAT — a caution panel with two honest limitations.
const CAVEAT = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, useTheme, frameRamp } from "@news/blocks";
import { PRINT, onColor } from "@news/design";
export const schema = z.object({ meta: z.string().optional(), tag: z.string(), points: z.array(z.string()).min(2).max(3), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const ink = PRINT.ink; const warn = PRINT.yellow;
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  return (
    <Frame><Story eyebrow={eyebrow ?? "LƯU Ý"} label="TRÁNH KỲ VỌNG QUÁ ĐÀ" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ border: "4px solid " + ink, background: theme.colors.panel, borderTop: "12px solid " + warn }}>
        <div style={{ background: warn, color: onColor(warn), borderBottom: "4px solid " + ink, padding: "10px 16px", fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 22, letterSpacing: "0.1em" }}>{props.tag}</div>
        <div style={{ display: "grid" }}>
          {props.points.map((p, i) => { const r = frameRamp(f, fps, 10 + i * 8, 18); return (
            <div key={i} style={{ display: "flex", gap: 16, alignItems: "flex-start", padding: "18px 20px", borderTop: i === 0 ? "none" : "3px solid " + ink, opacity: r }}>
              <div style={{ minWidth: 40, height: 40, background: warn, border: "3px solid " + ink, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 26, color: onColor(warn) }}>!</div>
              <div style={{ fontSize: 26, lineHeight: 1.3, color: ink }}>{p}</div>
            </div>
          ); })}
        </div>
      </div>
    </Story></Frame>
  );
};
export const example: P = { tag: "LƯU Ý", points: ["Vẫn là kết quả nghiên cứu, chưa phải sản phẩm.", "Đánh đổi độ chi tiết 3D lấy tốc độ; cần dữ liệu lớn."] };
export default registerComponent<P>({ id: "d4-caveat", displayName: "Caveat", promptGuide: "caution panel with honest limitations", schema, Component: Scene, example });
`;

// 10) CTA — framed closing question (block-composed).
const CTA = `import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, Callout } from "@news/blocks";
export const schema = z.object({ label: z.string().optional(), meta: z.string().optional(), callout: z.string(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, body, eyebrow, props }) => (
  <Frame><Story eyebrow={eyebrow ?? "CHỐT LẠI"} label={props.label} meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
    <TitleBlock headline={headline} body={body} />
    <Callout tone="signal">{props.callout}</Callout>
  </Story></Frame>
);
export const example: P = { label: "CHỐT LẠI", meta: "2026", callout: "Một câu hỏi" };
export default registerComponent<P>({ id: "d4-cta", displayName: "Cta", promptGuide: "closing question", schema, Component: Scene, example });
`;

type Trans = "slide" | "fade" | "wipe" | "clockWipe" | "zoom";
const M = (id: string, component: string, eyebrow: string, headline: string, narration: string, props: Record<string, unknown>, body?: string, transitionToNext?: Trans, emphasis?: "zoom") =>
  ({ id, component, eyebrow, headline, narration, props, ...(body ? { body } : {}), ...(transitionToNext ? { transitionToNext } : {}), ...(emphasis ? { emphasis } : {}) });

const MANIFEST = {
  title: "D4RT: dựng lại thế giới 4D từ một video phẳng",
  theme: { dominant: "#3B6FE0", mood: "editorial blue, thị giác máy / 4D" },
  scenes: [
    M("scene-01", "d4-eye", "THỊ GIÁC", "Mắt người nhìn 4 chiều",
      "Mỗi khi nhìn, đôi mắt ta làm một việc phi thường, vừa thấy vật ở hiện tại, vừa nhớ chúng ở quá khứ, và đoán chúng sẽ ở đâu trong khoảnh khắc kế tiếp.",
      { meta: "2026", footer: "THỊ GIÁC" }, undefined, "zoom", "zoom"),
    M("scene-02", "d4-flat3d", "BÀI TOÁN", "Video chỉ là ảnh phẳng",
      "Nhưng một đoạn video chỉ là chuỗi ảnh phẳng hai chiều, dạy máy nhìn vào đó rồi dựng lại cả một thế giới ba chiều đang chuyển động là một trong những bài toán khó nhất của thị giác máy tính.",
      { meta: "2026", leftLabel: "Video 2D phẳng", rightLabel: "Thế giới 3D động", footer: "BÀI TOÁN" }, undefined, "slide"),
    M("scene-03", "d4-define", "KHÁI NIỆM", "Tái dựng 4D là gì",
      "Bài toán này có tên là tái dựng bốn chiều, gồm ba chiều của không gian, cộng thêm chiều thứ tư là thời gian.",
      { meta: "2026", footer: "KHÁI NIỆM" }, undefined, "wipe"),
    M("scene-04", "d4-unify", "MÔ HÌNH", "D4RT gom làm một",
      "Google DeepMind vừa giới thiệu D4RT, thay vì chắp vá nhiều mô hình riêng cho độ sâu, chuyển động và góc máy, nó gom tất cả vào một kiến trúc Transformer duy nhất, làm trọn cả ba việc chỉ từ một video.",
      { meta: "2026", parts: ["Độ sâu", "Chuyển động", "Góc máy"], oldLabel: "Chắp vá · chậm · rời rạc", newLabel: "1 Transformer · 1 video", footer: "MÔ HÌNH" }, undefined, "slide", "zoom"),
    M("scene-05", "d4-flow", "CƠ CHẾ", "Hỏi từng điểm ảnh",
      "Bí quyết là mỗi điểm ảnh được hỏi một câu, nó nằm ở đâu trong không gian, vào lúc nào, nhìn từ góc máy nào, một bộ mã hóa nén cả video lại, rồi một bộ giải mã nhẹ trả lời hàng nghìn câu hỏi cùng một lúc.",
      { meta: "2026", stages: ["Video", "Bộ mã hóa: nén biểu diễn", "Bộ giải mã nhẹ"], parallelLabel: "Hàng nghìn câu hỏi · trả lời song song", footer: "CƠ CHẾ" }, undefined, "clockWipe"),
    M("scene-06", "d4-speed", "TỐC ĐỘ", "Nhanh hơn 120 lần",
      "Ấn tượng nhất là tốc độ, một video dài một phút được xử lý chỉ trong khoảng năm giây trên một con chip TPU, trong khi cách cũ có thể mất tới mười phút, tức là nhanh hơn khoảng một trăm hai mươi lần.",
      { meta: "2026", oldLabel: "Cách cũ", oldValue: "≈ 10 phút", newLabel: "D4RT", newValue: "≈ 5 giây", factor: "120×", note: "nhanh hơn · 18–300× qua các phép thử", footer: "TỐC ĐỘ" }, undefined, "wipe", "zoom"),
    M("scene-07", "d4-bench", "CHẤT LƯỢNG", "Nhanh mà vẫn chuẩn",
      "Nhưng nhanh không có nghĩa là làm ẩu, D4RT đạt kết quả tốt nhất hiện nay trên nhiều phép thử khó, từ Sintel, video kính thông minh Aria, tới ước lượng góc máy trên RE10k, và còn được trao giải Best Paper tại CVPR.",
      { meta: "2026", items: [{ name: "Sintel", desc: "Chuyển động nhanh, đầy nhòe" }, { name: "Aria", desc: "Video kính thông minh" }, { name: "RE10k", desc: "Góc máy · AUC cao nhất" }], award: "Best Paper · CVPR 2026", orgs: "DeepMind · UCL · Oxford", footer: "CHẤT LƯỢNG" }, undefined, "slide"),
    M("scene-08", "d4-apps", "ỨNG DỤNG", "Nó mở ra điều gì",
      "Vì sao điều này đáng quan tâm, robot cần hiểu môi trường đang động để di chuyển an toàn, kính thực tế tăng cường cần dựng hình tức thì, và xa hơn, đây là một bước tiến tới world model, mô hình thực sự hiểu thế giới vật lý.",
      { meta: "2026", cards: [{ title: "Robot", text: "Hiểu môi trường động để đi an toàn, cầm nắm khéo." }, { title: "Kính AR", text: "Dựng hình tức thì, đặt vật ảo đúng vị trí." }, { title: "World model", text: "Hiểu thế giới vật lý — bước tới AGI." }], footer: "ỨNG DỤNG" }, undefined, "slide"),
    M("scene-09", "d4-caveat", "LƯU Ý", "Đừng kỳ vọng quá đà",
      "Cũng cần nói rõ để tránh kỳ vọng quá đà, đây vẫn là một kết quả nghiên cứu chứ chưa phải sản phẩm, và nó đánh đổi một phần độ chi tiết của mô hình ba chiều để lấy tốc độ.",
      { meta: "2026", tag: "LƯU Ý", points: ["Vẫn là kết quả nghiên cứu, chưa phải sản phẩm dùng ngay.", "Đánh đổi một phần độ chi tiết 3D để lấy tốc độ; cần dữ liệu huấn luyện rất lớn."], footer: "LƯU Ý" }, undefined, "fade"),
    M("scene-10", "d4-cta", "CHỐT LẠI", "Gần hơn cách ta nhìn",
      "Dù vậy, việc dựng cả một thế giới ba chiều đang động từ một video phẳng chỉ trong vài giây vẫn là một bước nhảy lớn, đưa máy nhìn thế giới tiến gần hơn tới cách con người vẫn nhìn, còn bạn, bạn mong công nghệ này xuất hiện đầu tiên ở đâu?",
      { meta: "2026", label: "CHỐT LẠI", callout: "Bạn mong máy nhìn 4D xuất hiện đầu tiên ở đâu?", footer: "CHỐT LẠI" }, "Dựng thế giới 3D động từ video phẳng, chỉ trong vài giây."),
  ],
};

const FULL = { safeArea: true, alignment: true, transitions: true, clutter: true, hook: true, cta: true, audio: true, richness: true };

async function setup(): Promise<void> {
  await scaffoldVideoProject({ prompt: MANIFEST.title, projectId: ID, duration: TARGET_SECONDS, tts: { provider: "vivibe" } });
  await writeAuthoredScene(ID, "eye.tsx", EYE);
  await writeAuthoredScene(ID, "flat3d.tsx", FLAT3D);
  await writeAuthoredScene(ID, "define.tsx", DEFINE);
  await writeAuthoredScene(ID, "unify.tsx", UNIFY);
  await writeAuthoredScene(ID, "flow.tsx", FLOW);
  await writeAuthoredScene(ID, "speed.tsx", SPEED);
  await writeAuthoredScene(ID, "bench.tsx", BENCH);
  await writeAuthoredScene(ID, "apps.tsx", APPS);
  await writeAuthoredScene(ID, "caveat.tsx", CAVEAT);
  await writeAuthoredScene(ID, "cta.tsx", CTA);
  await writeJson(projectPaths(ID).manifest, MANIFEST);
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "stills";
  await setup();
  const admitted = await admitProjectScenes(ID);
  if (!admitted.ok) { console.error("[v] admission FAILED", admitted.violations); process.exitCode = 1; return; }

  if (mode === "stills") {
    const spec = await loadManifestAsSpec(ID);
    const tts = await synthesizeNarration(spec, { projectId: ID, provider: "mock" });
    const locked = lockSpec(spec, tts, { mixedNarrationSrc: tts?.mixedSrc });
    const p = projectPaths(ID);
    await writeJson(p.lock, locked);
    const entry = p.authoredDir + "\\_entry.tsx";
    await generateAuthoredEntry({ entryPath: entry, authoredFiles: admitted.files, lockJsonPath: p.lock });
    const out = await renderSceneStills(locked, p.reviewDir, { projectRoot: p.root, entryPoint: entry, remotionRoot: remotionAppRoot() });
    console.log("[v] stills " + out.length + " at " + p.reviewDir + " frames=" + locked.durationInFrames);
  } else {
    const provider = (process.argv[3] as "vivibe" | "mock") ?? "vivibe";
    const quality = mode === "draft" ? "draft" : "full";
    const r = await renderProject(ID, { ttsProvider: provider, checklist: FULL, noCache: true, quality });
    console.log("[v] " + quality + " mp4=" + r.mp4Path + " frames=" + r.locked.durationInFrames + " (~" + (r.locked.durationInFrames / r.locked.fps).toFixed(1) + "s) ok=" + r.report.ok);
    const errs = r.report.issues.filter((i) => i.severity === "error");
    const warns = r.report.issues.filter((i) => i.severity === "warning");
    console.log("[v] errors=" + errs.length + " warnings=" + warns.length);
    for (const i of errs) console.log("  ERR " + i.check + " " + (i.sceneId ?? "-") + ": " + i.message);
    for (const i of warns) console.log("  warn " + i.check + " " + (i.sceneId ?? "-") + ": " + i.message);
  }
  console.log("[v] OK");
}

main().catch((e: unknown) => { console.error("[v] FAILED"); console.error(e); process.exitCode = 1; });
