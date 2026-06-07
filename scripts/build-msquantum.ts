/**
 * Author + render: "Microsoft Discovery agentic AI & lượng tử" (Majorana 2).
 * Facts grounded in Microsoft Source (news.microsoft.com, ingested to
 * planning/ms-discovery-quantum.md): Majorana 2 topological chip; qubits 1,000x
 * more reliable than the prior generation; mean qubit lifetime 20s (up to 1
 * minute) vs microseconds for other approaches; scalable quantum computer
 * expected 2029 (timeline halved); aluminium → lead superconductor (shields
 * qubits from cosmic disturbances); Microsoft Discovery agentic AI (automates
 * measurements, parallel voltage adjustments, 3D qubit-condition maps, filters
 * noise, synthesizes ~2 decades of siloed data) — scientist in the loop.
 *
 *   npx tsx scripts/build-msquantum.ts stills
 *   npx tsx --env-file=.env scripts/build-msquantum.ts draft vivibe
 *   npx tsx --env-file=.env scripts/build-msquantum.ts full  vivibe
 */
import {
  scaffoldVideoProject, renderProject, admitProjectScenes, loadManifestAsSpec,
  synthesizeNarration, lockSpec, renderSceneStills, generateAuthoredEntry, remotionAppRoot,
} from "../packages/pipeline/src/index.js";
import { projectPaths, writeJson } from "../packages/pipeline/src/store/store.js";
import { writeAuthoredScene } from "../packages/pipeline/src/authoring/manifest.js";

const ID = "ms-quantum";
const TARGET_SECONDS = 90 as const;

// --- generic text/structure scenes ---------------------------------------

const STATEMENT = `import React from "react";
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
export const example: P = { label: "LƯỢNG TỬ", meta: "2026", callout: "Một ý chính" };
export default registerComponent<P>({ id: "mq-statement", displayName: "Statement", promptGuide: "hook/idea/cta", schema, Component: Scene, example });
`;

const POINTS = `import React from "react";
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
export default registerComponent<P>({ id: "mq-points", displayName: "Points", promptGuide: "recap list", schema, Component: Scene, example });
`;

const COMPARE = `import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, Panel } from "@news/blocks";
export const schema = z.object({ meta: z.string().optional(), leftTag: z.string(), left: z.string(), rightTag: z.string(), right: z.string(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => (
  <Frame><Story eyebrow={eyebrow ?? "SO SÁNH"} label="COMPARE" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
    <TitleBlock headline={headline} />
    <div style={{ display: "flex", gap: 24 }}>
      <div style={{ flex: 1 }}><Panel title={props.leftTag} tone="danger">{props.left}</Panel></div>
      <div style={{ flex: 1 }}><Panel title={props.rightTag} tone="accent">{props.right}</Panel></div>
    </div>
  </Story></Frame>
);
export const example: P = { leftTag: "A", left: "x", rightTag: "B", right: "y" };
export default registerComponent<P>({ id: "mq-compare", displayName: "Compare", promptGuide: "two-column tradeoff", schema, Component: Scene, example });
`;

// --- bespoke, topic-specific scenes (theme/pack-aware) --------------------

// Halved roadmap: a full muted bar (original) over a half accent bar to a
// target year, with a dashed cut line at the midpoint.
const TIMELINE = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, useTheme, chromeBorder, frameRamp } from "@news/blocks";
export const schema = z.object({ meta: z.string().optional(), oldLabel: z.string(), newLabel: z.string(), targetYear: z.string(), cutLabel: z.string(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const ink = theme.colors.fg; const muted = theme.colors.muted; const accent = theme.colors.accent; const border = chromeBorder(theme);
  const grow = frameRamp(f, fps, 12, 28);
  return (
    <Frame><Story eyebrow={eyebrow ?? "LỘ TRÌNH"} label="ROADMAP" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ display: "grid", gap: 24 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontFamily: theme.fonts.mono, fontSize: 24, color: muted, letterSpacing: "0.05em" }}>{props.oldLabel}</div>
          <div style={{ height: 38, border: border === "none" ? "1px solid " + ink : border, background: theme.colors.bg }}>
            <div style={{ height: "100%", width: "100%", background: muted, opacity: 0.3 }} />
          </div>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontFamily: theme.fonts.mono, fontSize: 24, color: accent, fontWeight: 800, letterSpacing: "0.05em" }}>{props.newLabel}</div>
          <div style={{ height: 38, border: border === "none" ? "1px solid " + ink : border, background: theme.colors.bg, position: "relative" }}>
            <div style={{ height: "100%", width: (50 * grow).toFixed(1) + "%", background: accent }} />
            <div style={{ position: "absolute", top: -8, bottom: -8, left: "50%", borderLeft: "3px dashed " + ink }} />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontFamily: theme.fonts.mono, fontSize: 24, color: ink }}>
          <span>{props.cutLabel}</span>
          <span style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 64, color: accent, lineHeight: 1 }}>{props.targetYear}</span>
        </div>
      </div>
    </Story></Frame>
  );
};
export const example: P = { oldLabel: "LỘ TRÌNH BAN ĐẦU", newLabel: "VỚI AGENTIC AI", targetYear: "2029", cutLabel: "Rút ngắn một nửa" };
export default registerComponent<P>({ id: "mq-timeline", displayName: "Timeline", promptGuide: "halved roadmap to a target year", schema, Component: Scene, example });
`;

// Reliability hero: a giant qubit lifetime figure with two context chips
// (1,000x vs prior gen; microseconds for others) — carries the headline number.
const LIFETIME = `import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, useTheme, chromeBorder, useRamp } from "@news/blocks";
export const schema = z.object({ meta: z.string().optional(), value: z.string(), unit: z.string(), sub: z.string(), chipA: z.string(), chipB: z.string(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme();
  const ink = theme.colors.fg; const muted = theme.colors.muted; const accent = theme.colors.accent; const border = chromeBorder(theme);
  const t = useRamp(6, 30);
  const chip = { fontFamily: theme.fonts.mono, fontSize: 24, padding: "10px 16px", border: border === "none" ? "2px solid " + ink : border } as const;
  return (
    <Frame><Story eyebrow={eyebrow ?? "ĐỘ TIN CẬY"} label="QUBIT" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <div style={{ fontFamily: theme.fonts.mono, fontSize: 32, fontWeight: 800, letterSpacing: "0.04em", color: muted }}>{headline}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
        <span style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 180, lineHeight: 0.85, color: ink, opacity: t, letterSpacing: "-0.03em" }}>{props.value}</span>
        <span style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 58, color: accent }}>{props.unit}</span>
      </div>
      <div style={{ fontFamily: theme.fonts.mono, fontSize: 26, color: muted }}>{props.sub}</div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ ...chip, color: accent, fontWeight: 800 }}>{props.chipA}</div>
        <div style={{ ...chip, color: muted }}>{props.chipB}</div>
      </div>
    </Story></Frame>
  );
};
export const example: P = { value: "20", unit: "giây", sub: "tuổi thọ trung bình của qubit", chipA: "× 1.000 so với thế hệ trước", chipB: "cách khác: vài micro giây" };
export default registerComponent<P>({ id: "mq-lifetime", displayName: "Lifetime", promptGuide: "hero figure with context chips", schema, Component: Scene, example });
`;

// Battery metaphor: two horizontal battery glyphs (squared) — a near-empty "1
// day" vs a near-full "~3 years" — the article's own analogy.
const BATTERY = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, useTheme, chromeBorder, frameRamp } from "@news/blocks";
export const schema = z.object({ meta: z.string().optional(), smallLabel: z.string(), bigLabel: z.string(), note: z.string(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Batt: React.FC<{ fill: number; color: string; ink: string; border: string; label: string; mono: string }> = ({ fill, color, ink, border, label, mono }) => (
  <div style={{ flex: 1, display: "grid", gap: 12, justifyItems: "center" }}>
    <div style={{ display: "flex", alignItems: "center" }}>
      <div style={{ width: 220, height: 96, border: border === "none" ? "3px solid " + ink : border, background: "transparent", padding: 8 }}>
        <div style={{ height: "100%", width: Math.max(4, fill * 100).toFixed(1) + "%", background: color }} />
      </div>
      <div style={{ width: 14, height: 40, background: ink }} />
    </div>
    <div style={{ fontFamily: mono, fontSize: 30, fontWeight: 800, color: ink }}>{label}</div>
  </div>
);
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const ink = theme.colors.fg; const muted = theme.colors.muted; const accent = theme.colors.accent; const border = chromeBorder(theme);
  const g = frameRamp(f, fps, 12, 30);
  return (
    <Frame><Story eyebrow={eyebrow ?? "VÍ DỤ"} label="ANALOGY" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ display: "flex", gap: 28, alignItems: "center" }}>
        <Batt fill={0.06} color={muted} ink={ink} border={border} label={props.smallLabel} mono={theme.fonts.mono} />
        <div style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 56, color: muted }}>→</div>
        <Batt fill={0.06 + 0.9 * g} color={accent} ink={ink} border={border} label={props.bigLabel} mono={theme.fonts.mono} />
      </div>
      <div style={{ fontFamily: theme.fonts.mono, fontSize: 26, color: muted, letterSpacing: "0.03em" }}>{props.note}</div>
    </Story></Frame>
  );
};
export const example: P = { smallLabel: "1 ngày", bigLabel: "≈ 3 năm", note: "Như một viên pin điện thoại trụ được gần 3 năm" };
export default registerComponent<P>({ id: "mq-battery", displayName: "Battery", promptGuide: "battery-life metaphor", schema, Component: Scene, example });
`;

// Material swap (change over time): old material struck through, new material
// revealed in the accent, with a note.
const SWAP = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, useTheme, chromeBorder, frameRamp } from "@news/blocks";
export const schema = z.object({ meta: z.string().optional(), from: z.string(), to: z.string(), note: z.string(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const ink = theme.colors.fg; const muted = theme.colors.muted; const accent = theme.colors.accent; const border = chromeBorder(theme);
  const strike = frameRamp(f, fps, 14, 18);
  const reveal = frameRamp(f, fps, 30, 22);
  const card = { border: border === "none" ? "1px solid " + ink : border, background: theme.colors.panel, padding: "22px 26px" } as const;
  return (
    <Frame><Story eyebrow={eyebrow ?? "VẬT LIỆU"} label="SWAP" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ display: "grid", gap: 18 }}>
        <div style={{ ...card, position: "relative" }}>
          <span style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 52, color: muted }}>{props.from}</span>
          <div style={{ position: "absolute", left: 26, right: (100 - 100 * strike).toFixed(1) + "%", top: "50%", height: 5, background: ink }} />
        </div>
        <div style={{ ...card, opacity: reveal, transform: "translateY(" + ((1 - reveal) * 16).toFixed(1) + "px)", boxShadow: "none", borderColor: accent }}>
          <span style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 60, color: accent }}>{props.to}</span>
        </div>
        <div style={{ fontFamily: theme.fonts.mono, fontSize: 26, color: muted, letterSpacing: "0.03em", opacity: reveal }}>{props.note}</div>
      </div>
    </Story></Frame>
  );
};
export const example: P = { from: "Nhôm (Al)", to: "Chì (Pb)", note: "Chắn các qubit khỏi nhiễu từ tia vũ trụ" };
export default registerComponent<P>({ id: "mq-swap", displayName: "Swap", promptGuide: "material swap, change over time", schema, Component: Scene, example });
`;

// Agent hub (relationship): a 2x2 grid of agent cards + a full-width human-in-
// the-loop bar.
const AGENTS = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, useTheme, chromeBorder, frameRamp } from "@news/blocks";
export const schema = z.object({ meta: z.string().optional(), agents: z.array(z.string()).min(3).max(4), human: z.string(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const ink = theme.colors.fg; const muted = theme.colors.muted; const accent = theme.colors.accent; const border = chromeBorder(theme);
  return (
    <Frame><Story eyebrow={eyebrow ?? "MICROSOFT DISCOVERY"} label="AGENTS" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        {props.agents.map((a, i) => {
          const r = frameRamp(f, fps, 8 + i * 7, 20);
          return (
            <div key={i} style={{ flexBasis: "calc(50% - 8px)", flexGrow: 1, border: border === "none" ? "1px solid " + ink : border, background: theme.colors.panel, padding: "20px 22px", display: "flex", alignItems: "center", gap: 14, opacity: r, transform: "translateY(" + ((1 - r) * 18).toFixed(1) + "px)" }}>
              <div style={{ width: 16, height: 16, background: accent }} />
              <span style={{ fontWeight: 800, fontSize: 28, color: ink }}>{a}</span>
            </div>
          );
        })}
      </div>
      <div style={{ border: border === "none" ? "2px solid " + ink : border, background: accent, color: "#FCF9F1", padding: "16px 22px", fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 26, letterSpacing: "0.04em" }}>{props.human}</div>
    </Story></Frame>
  );
};
export const example: P = { agents: ["Đo lường", "Vật liệu", "Lọc nhiễu", "Tổng hợp dữ liệu"], human: "NHÀ KHOA HỌC VẪN RA QUYẾT ĐỊNH" };
export default registerComponent<P>({ id: "mq-agents", displayName: "Agents", promptGuide: "agent hub + human in the loop", schema, Component: Scene, example });
`;

// Parallel vs linear (process): a single human lane filling sequentially vs
// several AI lanes filling at once → a 3D-map note.
const PARALLEL = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, useTheme, chromeBorder, frameRamp } from "@news/blocks";
const Cells: React.FC<{ n: number; lit: (i: number) => number; color: string; ink: string; border: string }> = ({ n, lit, color, ink, border }) => (
  <div style={{ display: "flex", gap: 8 }}>
    {Array.from({ length: n }).map((_, i) => (
      <div key={i} style={{ width: 40, height: 26, border: border === "none" ? "2px solid " + ink : border, background: "transparent" }}>
        <div style={{ height: "100%", width: (Math.max(0, Math.min(1, lit(i))) * 100).toFixed(0) + "%", background: color }} />
      </div>
    ))}
  </div>
);
export const schema = z.object({ meta: z.string().optional(), humanLabel: z.string(), aiLabel: z.string(), note: z.string(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const ink = theme.colors.fg; const muted = theme.colors.muted; const accent = theme.colors.accent; const border = chromeBorder(theme);
  const seq = (i: number) => frameRamp(f, fps, 10 + i * 6, 6);
  const par = frameRamp(f, fps, 12, 22);
  return (
    <Frame><Story eyebrow={eyebrow ?? "TỐC ĐỘ"} label="PARALLEL" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ display: "grid", gap: 22 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontFamily: theme.fonts.mono, fontSize: 24, color: muted, letterSpacing: "0.05em" }}>{props.humanLabel}</div>
          <Cells n={6} lit={seq} color={muted} ink={ink} border={border} />
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontFamily: theme.fonts.mono, fontSize: 24, color: accent, fontWeight: 800, letterSpacing: "0.05em" }}>{props.aiLabel}</div>
          <div style={{ display: "grid", gap: 8 }}>
            <Cells n={6} lit={() => par} color={accent} ink={ink} border={border} />
            <Cells n={6} lit={() => par} color={accent} ink={ink} border={border} />
            <Cells n={6} lit={() => par} color={accent} ink={ink} border={border} />
          </div>
        </div>
        <div style={{ fontFamily: theme.fonts.mono, fontSize: 24, color: ink }}>{props.note}</div>
      </div>
    </Story></Frame>
  );
};
export const example: P = { humanLabel: "CON NGƯỜI · TUẦN TỰ", aiLabel: "AGENTIC AI · SONG SONG", note: "→ bản đồ 3D điều kiện qubit" };
export default registerComponent<P>({ id: "mq-parallel", displayName: "Parallel", promptGuide: "linear vs parallel processing", schema, Component: Scene, example });
`;

type Trans = "slide" | "fade" | "wipe" | "clockWipe" | "zoom";
const M = (id: string, component: string, eyebrow: string, headline: string, narration: string, props: Record<string, unknown>, body?: string, transitionToNext?: Trans, emphasis?: "zoom") =>
  ({ id, component, eyebrow, headline, narration, props, ...(body ? { body } : {}), ...(transitionToNext ? { transitionToNext } : {}), ...(emphasis ? { emphasis } : {}) });

const MANIFEST = {
  title: "Agentic AI viết lại cách làm R&D lượng tử",
  theme: { dominant: "#5B53E0", stylePackId: "clean-premium", mood: "premium quantum" },
  scenes: [
    M("scene-01", "mq-statement", "LƯỢNG TỬ", "AI vừa rút ngắn nửa lộ trình lượng tử",
      "Microsoft vừa công bố một điều khiến cả ngành công nghệ phải nhìn lại, nhờ trí tuệ nhân tạo dạng agent, họ đã rút ngắn một nửa chặng đường tiến tới chiếc máy tính lượng tử thực sự hữu dụng.",
      { label: "TIN CÔNG NGHỆ", meta: "2026", callout: "Một nửa thời gian bị xóa khỏi lộ trình", tone: "accent", footer: "MICROSOFT" }, undefined, "slide", "zoom"),
    M("scene-02", "mq-timeline", "LỘ TRÌNH", "Về đích dự kiến năm 2029",
      "Thay vì phải chờ thêm rất nhiều năm như kế hoạch ban đầu, đội ngũ lượng tử của Microsoft giờ kỳ vọng đạt cột mốc máy tính lượng tử quy mô lớn ngay trong năm 2029, sớm hơn một nửa so với dự kiến cũ.",
      { meta: "2026", oldLabel: "LỘ TRÌNH BAN ĐẦU", newLabel: "VỚI AGENTIC AI", targetYear: "2029", cutLabel: "Rút ngắn một nửa", footer: "ROADMAP" }, undefined, "wipe"),
    M("scene-03", "mq-lifetime", "ĐỘ TIN CẬY", "Bền hơn gấp 1.000 lần",
      "Trái tim của bước nhảy này là con chip mới mang tên Majorana 2, với các qubit có độ bền gấp 1.000 lần thế hệ trước, giữ được trạng thái lượng tử trung bình 20 giây, thậm chí có lúc kéo dài tới 1 phút.",
      { meta: "2026", value: "20", unit: "giây", sub: "tuổi thọ trung bình của qubit, có lúc tới 1 phút", chipA: "× 1.000 so với thế hệ trước", chipB: "cách khác: chỉ vài micro giây", footer: "MAJORANA 2" }, undefined, "slide", "zoom"),
    M("scene-04", "mq-battery", "VÍ DỤ", "Như pin trụ được 3 năm",
      "Để dễ hình dung, nếu các cách làm khác chỉ giữ được trạng thái trong vài micro giây, thì đây giống như một viên pin điện thoại, thay vì cạn sau một ngày lại có thể trụ được gần 3 năm chỉ với một lần sạc.",
      { meta: "2026", smallLabel: "1 ngày", bigLabel: "gần 3 năm", note: "Cùng một lần sạc, bền hơn cả nghìn lần", footer: "ĐỘ BỀN" }, undefined, "fade"),
    M("scene-05", "mq-swap", "VẬT LIỆU", "Đổi từ nhôm sang chì",
      "Bí quyết nằm ở vật liệu, nhóm nghiên cứu thay lớp siêu dẫn từ nhôm sang chì, thứ vốn được dùng để chắn phóng xạ, nhờ đó che chắn các qubit mong manh khỏi những nhiễu loạn đến từ tia vũ trụ.",
      { meta: "2026", from: "Nhôm (Al)", to: "Chì (Pb)", note: "Chắn các qubit khỏi nhiễu từ tia vũ trụ", footer: "SIÊU DẪN" }, undefined, "slide"),
    M("scene-06", "mq-agents", "MICROSOFT DISCOVERY", "Một đội AI, người vẫn cầm lái",
      "Nhưng nhân vật chính thật sự là Microsoft Discovery, một đội ngũ AI dạng agent chuyên biệt, chúng tự đo lường, dò vật liệu, lọc nhiễu và tổng hợp dữ liệu, còn nhà khoa học vẫn luôn là người đưa ra quyết định cuối cùng.",
      { meta: "2026", agents: ["Tự động đo lường", "Dò tìm vật liệu", "Lọc nhiễu dữ liệu", "Tổng hợp tri thức"], human: "NHÀ KHOA HỌC VẪN RA QUYẾT ĐỊNH CUỐI CÙNG", footer: "AGENTIC AI" }, undefined, "wipe"),
    M("scene-07", "mq-compare", "CÁCH LÀM", "Trật tự cũ và trật tự mới",
      "Khác biệt lớn nhất nằm ở cách làm việc, trong trật tự cũ người ta phải thử đi thử lại rất nhiều lần, còn trong trật tự mới, mô phỏng sẽ chỉ ra đáp án khả dĩ nhất để gần như chỉ cần thí nghiệm đúng một lần.",
      { meta: "2026", leftTag: "TRẬT TỰ CŨ", left: "Thử đi thử lại rất nhiều lần.", rightTag: "TRẬT TỰ MỚI", right: "Mô phỏng trước, gần như chỉ thử một lần.", footer: "R&D" }, undefined, "clockWipe"),
    M("scene-08", "mq-parallel", "TỐC ĐỘ", "AI chỉnh song song, người tuần tự",
      "Việc đo đạc từng khiến con người mất hàng tuần, nay được agent chạy tự động và liên tục, điều chỉnh hàng loạt thông số điện áp cùng một lúc để dựng nên bản đồ ba chiều về điều kiện của qubit, thứ mà một người không thể tự làm.",
      { meta: "2026", humanLabel: "CON NGƯỜI · TUẦN TỰ", aiLabel: "AGENTIC AI · SONG SONG", note: "→ bản đồ 3D về điều kiện của qubit", footer: "ĐO LƯỜNG" }, undefined, "slide"),
    M("scene-09", "mq-points", "TÓM LẠI", "Agentic AI đang gánh việc gì",
      "Tóm lại, lớp AI này gánh ba việc nặng nhất, nối liền gần hai thập kỷ dữ liệu từng nằm rời rạc, tự động hóa các phép đo cực kỳ tốn thời gian, và lọc bỏ nhiễu để lộ ra những tín hiệu thật sự quan trọng.",
      { meta: "2026", points: ["Nối gần 2 thập kỷ dữ liệu rời rạc", "Tự động hóa các phép đo tốn thời gian", "Lọc nhiễu, giữ lại tín hiệu thật"], footer: "VAI TRÒ" }, undefined, "fade"),
    M("scene-10", "mq-statement", "CHỐT LẠI", "Lợi thế mới: ai lặp nhanh nhất",
      "Câu hỏi đặt ra cho mọi lĩnh vực nghiên cứu là, khi AI có thể chạy R&D song song suốt ngày đêm, lợi thế cạnh tranh sẽ không còn thuộc về ai thông minh nhất, mà thuộc về ai dám thử và lặp lại nhanh nhất.",
      { label: "GÓC NHÌN", meta: "2026", callout: "Không phải ai giỏi nhất, mà ai lặp nhanh nhất", tone: "signal", footer: "R&D MỚI" }, undefined),
  ],
};

const FULL = { safeArea: true, alignment: true, transitions: true, clutter: true, hook: true, cta: true, audio: true, richness: true };

async function setup(): Promise<void> {
  await scaffoldVideoProject({ prompt: MANIFEST.title, projectId: ID, duration: TARGET_SECONDS, tts: { provider: "vivibe" } });
  await writeAuthoredScene(ID, "statement.tsx", STATEMENT);
  await writeAuthoredScene(ID, "points.tsx", POINTS);
  await writeAuthoredScene(ID, "compare.tsx", COMPARE);
  await writeAuthoredScene(ID, "timeline.tsx", TIMELINE);
  await writeAuthoredScene(ID, "lifetime.tsx", LIFETIME);
  await writeAuthoredScene(ID, "battery.tsx", BATTERY);
  await writeAuthoredScene(ID, "swap.tsx", SWAP);
  await writeAuthoredScene(ID, "agents.tsx", AGENTS);
  await writeAuthoredScene(ID, "parallel.tsx", PARALLEL);
  await writeJson(projectPaths(ID).manifest, MANIFEST);
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "stills";
  await setup();
  const admitted = await admitProjectScenes(ID);
  if (!admitted.ok) { console.error("[mq] admission FAILED", admitted.violations); process.exitCode = 1; return; }

  if (mode === "stills") {
    const spec = await loadManifestAsSpec(ID);
    const tts = await synthesizeNarration(spec, { projectId: ID, provider: "mock" });
    const locked = lockSpec(spec, tts, { mixedNarrationSrc: tts?.mixedSrc });
    const p = projectPaths(ID);
    await writeJson(p.lock, locked);
    const entry = p.authoredDir + "\\_entry.tsx";
    await generateAuthoredEntry({ entryPath: entry, authoredFiles: admitted.files, lockJsonPath: p.lock });
    const out = await renderSceneStills(locked, p.reviewDir, { projectRoot: p.root, entryPoint: entry, remotionRoot: remotionAppRoot() });
    console.log("[mq] stills " + out.length + " at " + p.reviewDir + " frames=" + locked.durationInFrames);
  } else {
    const provider = (process.argv[3] as "vivibe" | "mock") ?? "vivibe";
    const quality = mode === "draft" ? "draft" : "full";
    const r = await renderProject(ID, { ttsProvider: provider, checklist: FULL, noCache: true, quality });
    console.log("[mq] " + quality + " mp4=" + r.mp4Path + " frames=" + r.locked.durationInFrames + " (~" + (r.locked.durationInFrames / r.locked.fps).toFixed(1) + "s) ok=" + r.report.ok);
    const errs = r.report.issues.filter((i) => i.severity === "error");
    const warns = r.report.issues.filter((i) => i.severity === "warning");
    console.log("[mq] errors=" + errs.length + " warnings=" + warns.length);
    for (const i of errs) console.log("  ERR " + i.check + " " + (i.sceneId ?? "-") + ": " + i.message);
    for (const i of warns) console.log("  warn " + i.check + " " + (i.sceneId ?? "-") + ": " + i.message);
  }
  console.log("[mq] OK");
}

main().catch((e: unknown) => { console.error("[mq] FAILED"); console.error(e); process.exitCode = 1; });
