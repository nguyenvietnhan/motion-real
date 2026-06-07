/**
 * Authoring scene kit (web-dashboard A1). A small library of proven, admissible
 * scene `.tsx` modules composing `@news/blocks` (generalized from the worked
 * build scripts). The authoring model selects among these by id and supplies the
 * Vietnamese content + props; the code is known-good so output reliably passes
 * admission + the safety grid. Bespoke per-topic visuals are a later upgrade.
 */

export type KitEntry = { id: string; file: string; code: string; spec: string };

const statement = `import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, Callout } from "@news/blocks";
export const schema = z.object({ label: z.string().optional(), meta: z.string().optional(), callout: z.string().optional(), tone: z.enum(["accent","signal","danger"]).optional(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, body, eyebrow, props }) => (
  <Frame><Story eyebrow={eyebrow ?? "TIN"} label={props.label} meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
    <TitleBlock headline={headline} body={body} />
    {props.callout ? <Callout tone={props.tone ?? "accent"}>{props.callout}</Callout> : null}
  </Story></Frame>
);
export const example: P = { label: "TIN", meta: "2026", callout: "Một ý chính" };
export default registerComponent<P>({ id: "ns-statement", displayName: "Statement", promptGuide: "hook / idea / cta", schema, Component: Scene, example });
`;

const stat = `import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, CountUp, Panel } from "@news/blocks";
export const schema = z.object({ meta: z.string().optional(), to: z.number(), prefix: z.string().optional(), suffix: z.string().optional(), decimals: z.number().optional(), statLabel: z.string(), note: z.string().optional(), tone: z.enum(["accent","signal","blue","red","yellow","green"]).optional(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => (
  <Frame><Story eyebrow={eyebrow ?? "DỮ LIỆU"} label="STAT" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
    <div style={{ fontFamily: "Cascadia Mono, Consolas, monospace", fontSize: 34, fontWeight: 800, letterSpacing: "0.04em", color: "#6E6757" }}>{headline}</div>
    <CountUp to={props.to} prefix={props.prefix} suffix={props.suffix} decimals={props.decimals ?? 0} tone={props.tone ?? "accent"} />
    <div style={{ fontFamily: "Cascadia Mono, Consolas, monospace", fontSize: 32, letterSpacing: "0.06em", color: "#6E6757" }}>{props.statLabel}</div>
    {props.note ? <Panel title="GHI CHÚ" tone={props.tone ?? "accent"}>{props.note}</Panel> : null}
  </Story></Frame>
);
export const example: P = { to: 72, suffix: "%", statLabel: "Giảm bộ nhớ" };
export default registerComponent<P>({ id: "ns-stat", displayName: "Stat", promptGuide: "one animated number", schema, Component: Scene, example });
`;

const points = `import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, KeyPoints } from "@news/blocks";
export const schema = z.object({ meta: z.string().optional(), points: z.array(z.string()).min(2).max(4), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => (
  <Frame><Story eyebrow={eyebrow ?? "TÓM TẮT"} label="LIST" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
    <TitleBlock headline={headline} />
    <KeyPoints items={props.points} />
  </Story></Frame>
);
export const example: P = { points: ["A", "B", "C"] };
export default registerComponent<P>({ id: "ns-points", displayName: "Points", promptGuide: "numbered recap list", schema, Component: Scene, example });
`;

const compare = `import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, Panel } from "@news/blocks";
export const schema = z.object({ meta: z.string().optional(), leftTag: z.string(), left: z.string(), rightTag: z.string(), right: z.string(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => (
  <Frame><Story eyebrow={eyebrow ?? "SO SÁNH"} label="COMPARE" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
    <TitleBlock headline={headline} />
    <div style={{ display: "flex", gap: 24 }}>
      <div style={{ flex: 1 }}><Panel title={props.leftTag} tone="red">{props.left}</Panel></div>
      <div style={{ flex: 1 }}><Panel title={props.rightTag} tone="green">{props.right}</Panel></div>
    </div>
  </Story></Frame>
);
export const example: P = { leftTag: "A", left: "x", rightTag: "B", right: "y" };
export default registerComponent<P>({ id: "ns-compare", displayName: "Compare", promptGuide: "two-column contrast", schema, Component: Scene, example });
`;

const cards = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, frameRamp } from "@news/blocks";
const INK = "#17150F"; const PAPER = "#FCF9F1"; const MUTED = "#6E6757";
const TONES = ["#1E9CB0", "#E8412E", "#1FA463", "#7A4DE0"];
export const schema = z.object({ meta: z.string().optional(), cards: z.array(z.object({ title: z.string(), text: z.string() })).min(2).max(4), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const grid = props.cards.length === 4;
  return (
    <Frame><Story eyebrow={eyebrow ?? "Ý CHÍNH"} label="CARDS" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ display: "flex", flexWrap: grid ? "wrap" : "nowrap", gap: 20, alignItems: "stretch" }}>
        {props.cards.map((c, i) => {
          const r = frameRamp(f, fps, 8 + i * 8, 22);
          const col = TONES[i % TONES.length]!;
          return (
            <div key={i} style={{ flexGrow: 1, flexBasis: grid ? "calc(50% - 10px)" : 0, border: "4px solid " + INK, background: PAPER, opacity: r, transform: "translateY(" + ((1 - r) * 28).toFixed(1) + "px)", boxShadow: "8px 8px 0 " + col, display: "flex", flexDirection: "column" }}>
              <div style={{ height: 12, background: col, borderBottom: "4px solid " + INK }} />
              <div style={{ padding: "22px 20px", display: "grid", gap: 12 }}>
                <div style={{ fontFamily: "Aptos Display, Segoe UI, sans-serif", fontWeight: 900, fontSize: 74, lineHeight: 0.95, color: col }}>{i + 1}</div>
                <div style={{ fontWeight: 800, fontSize: 31, lineHeight: 1.15, color: INK }}>{c.title}</div>
                <div style={{ fontSize: 25, lineHeight: 1.3, color: MUTED }}>{c.text}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Story></Frame>
  );
};
export const example: P = { cards: [{ title: "A", text: "x" }, { title: "B", text: "y" }] };
export default registerComponent<P>({ id: "ns-cards", displayName: "Cards", promptGuide: "enumeration as standing cards", schema, Component: Scene, example });
`;

const meter = `import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, useRamp } from "@news/blocks";
const INK = "#17150F"; const PAPER = "#FCF9F1"; const MUTED = "#6E6757"; const ACCENT = "#1E9CB0";
export const schema = z.object({ meta: z.string().optional(), percent: z.number(), statLabel: z.string(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const t = useRamp(6, 34);
  const shown = props.percent * t;
  const tenths = shown / 10;
  return (
    <Frame><Story eyebrow={eyebrow ?? "DỮ LIỆU"} label="METER" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <div style={{ fontFamily: "Cascadia Mono, Consolas, monospace", fontSize: 34, fontWeight: 800, letterSpacing: "0.04em", color: MUTED }}>{headline}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
        <span style={{ fontFamily: "Aptos Display, Segoe UI, sans-serif", fontWeight: 900, fontSize: 160, lineHeight: 0.9, color: INK, letterSpacing: "-0.03em" }}>{Math.round(shown)}</span>
        <span style={{ fontFamily: "Cascadia Mono, Consolas, monospace", fontWeight: 800, fontSize: 50, color: ACCENT }}>%</span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {Array.from({ length: 10 }).map((_, i) => {
          const fill = Math.max(0, Math.min(1, tenths - i));
          return (
            <div key={i} style={{ flex: 1, height: 56, border: "3px solid " + INK, background: PAPER, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: (fill * 100).toFixed(1) + "%", background: ACCENT }} />
            </div>
          );
        })}
      </div>
      <div style={{ fontFamily: "Cascadia Mono, Consolas, monospace", fontSize: 30, letterSpacing: "0.04em", color: MUTED }}>{props.statLabel}</div>
    </Story></Frame>
  );
};
export const example: P = { percent: 72, statLabel: "Tỉ lệ" };
export default registerComponent<P>({ id: "ns-meter", displayName: "Meter", promptGuide: "a percentage as a 10-cell fill meter", schema, Component: Scene, example });
`;

export const SCENE_KIT: KitEntry[] = [
  { id: "ns-statement", file: "statement.tsx", code: statement, spec: 'ns-statement — câu khẳng định / hook / CTA. props: { callout?: string, tone?: "accent"|"signal"|"danger", label?: string, meta?: string, footer?: string }' },
  { id: "ns-stat", file: "stat.tsx", code: stat, spec: 'ns-stat — MỘT con số đếm lên. props: { to: number, suffix?: string, prefix?: string, decimals?: number, statLabel: string, note?: string, tone?: "accent"|"signal"|"blue"|"red"|"yellow"|"green", meta?, footer? }' },
  { id: "ns-points", file: "points.tsx", code: points, spec: "ns-points — danh sách 2–4 ý (đánh số tự động). props: { points: string[] (2–4), meta?, footer? }" },
  { id: "ns-compare", file: "compare.tsx", code: compare, spec: "ns-compare — so sánh hai cột. props: { leftTag: string, left: string, rightTag: string, right: string, meta?, footer? }" },
  { id: "ns-cards", file: "cards.tsx", code: cards, spec: "ns-cards — 2–4 thẻ ý chính (tiêu đề + mô tả). props: { cards: {title,text}[] (2–4), meta?, footer? }" },
  { id: "ns-meter", file: "meter.tsx", code: meter, spec: "ns-meter — MỘT phần trăm dạng thanh 10 ô. props: { percent: number, statLabel: string, meta?, footer? }" },
];
