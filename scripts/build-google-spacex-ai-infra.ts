/**
 * Author + render the verified Google / SpaceX AI compute deal video.
 *
 * Sources checked before authoring:
 * - SEC EDGAR, Space Exploration Technologies Corp. FWP, filed June 5, 2026,
 *   accession 0001628280-26-041150, primary doc spacexagreementfwp.htm.
 * - Alphabet Inc. June 1, 2026 equity capital raise PDF.
 *
 * Usage:
 *   npx tsx scripts/build-google-spacex-ai-infra.ts stills
 *   npx tsx --env-file=.env scripts/build-google-spacex-ai-infra.ts draft vivibe
 *   npx tsx --env-file=.env scripts/build-google-spacex-ai-infra.ts full  vivibe
 */
import {
  scaffoldVideoProject, renderProject, admitProjectScenes, loadManifestAsSpec,
  synthesizeNarration, lockSpec, renderSceneStills, generateAuthoredEntry, remotionAppRoot,
} from "../packages/pipeline/src/index.js";
import { projectPaths, writeJson } from "../packages/pipeline/src/store/store.js";
import { writeAuthoredScene } from "../packages/pipeline/src/authoring/manifest.js";

const ID = "google-spacex-ai-infra";
const TARGET_SECONDS = 90 as const;

// Visual plan:
// 01 surprise contract -> relationship map / compute pipe
// 02 source gate -> filing card
// 03 110.000 GPUs -> bespoke unit grid
// 04 920 triệu USD/month -> runway math strip
// 05 delivery risk -> deadline timeline
// 06 90-day exit -> contract switch
// 07 data/model/IP ownership -> firewall split
// 08 Alphabet capex -> scale bar
// 09 meaning -> stack shift from model to capacity
// 10 CTA -> decision board

const DEAL_PIPE = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, Callout, useTheme, frameRamp } from "@news/blocks";
import { PRINT, onColor, withAlpha } from "@news/design";
export const schema = z.object({ meta: z.string().optional(), left: z.string(), right: z.string(), center: z.string(), chips: z.array(z.string()).min(2).max(3), callout: z.string(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const ink = PRINT.ink; const f = useCurrentFrame(); const cfg = useVideoConfig();
  const pipe = frameRamp(f, cfg.fps, 12, 26); const chips = frameRamp(f, cfg.fps, 32, 18);
  return (
    <Frame><Story eyebrow={eyebrow ?? "HỢP ĐỒNG"} label="COMPUTE PIPE" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ display: "grid", gap: 22 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.15fr 1fr", gap: 16, alignItems: "center" }}>
          <div style={{ border: "4px solid " + ink, background: theme.colors.panel, boxShadow: "8px 8px 0 " + theme.colors.accent, padding: "28px 20px", textAlign: "center", fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 48, color: ink }}>{props.left}</div>
          <div style={{ border: "4px solid " + ink, background: withAlpha(theme.colors.accent, 0.13), padding: "18px 14px", display: "grid", gap: 12 }}>
            <div style={{ height: 28, border: "4px solid " + ink, background: theme.colors.bg, overflow: "hidden" }}>
              <div style={{ height: "100%", width: (pipe * 100).toFixed(1) + "%", background: theme.colors.accent }} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", opacity: chips }}>
              {props.chips.map((c, i) => <span key={i} style={{ border: "3px solid " + ink, background: i === 0 ? theme.colors.accent : theme.colors.panel, color: i === 0 ? onColor(theme.colors.accent) : ink, padding: "6px 10px", fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 18 }}>{c}</span>)}
            </div>
            <div style={{ textAlign: "center", fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 24, color: ink }}>{props.center}</div>
          </div>
          <div style={{ border: "4px solid " + ink, background: theme.colors.panel, boxShadow: "8px 8px 0 " + theme.colors.signal, padding: "28px 20px", textAlign: "center", fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 48, color: ink }}>{props.right}</div>
        </div>
        <Callout tone="signal">{props.callout}</Callout>
      </div>
    </Story></Frame>
  );
};
export const example: P = { left: "Google", right: "SpaceX", center: "thuê năng lực tính toán", chips: ["AI", "GPU"], callout: "Một hợp đồng compute cực lớn" };
export default registerComponent<P>({ id: "gsx-deal-pipe", displayName: "Deal Pipe", promptGuide: "hook showing Google and SpaceX connected by a compute pipe", schema, Component: Scene, example });
`;

const FILING_CARD = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, Tag, useTheme, frameRamp } from "@news/blocks";
import { PRINT, onColor } from "@news/design";
export const schema = z.object({ meta: z.string().optional(), stamp: z.string(), rows: z.array(z.object({ k: z.string(), v: z.string() })).min(3).max(5), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const ink = PRINT.ink; const f = useCurrentFrame(); const cfg = useVideoConfig();
  return (
    <Frame><Story eyebrow={eyebrow ?? "NGUỒN"} label="SEC FWP" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ border: "4px solid " + ink, background: theme.colors.panel, boxShadow: "10px 10px 0 " + theme.colors.accent, padding: "24px", display: "grid", gap: 14, transform: "rotate(-1deg)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "4px solid " + ink, paddingBottom: 14 }}>
          <Tag tone="accent">{props.stamp}</Tag>
          <span style={{ fontFamily: theme.fonts.mono, fontSize: 22, fontWeight: 800, color: theme.colors.muted }}>Rule 433</span>
        </div>
        {props.rows.map((r, i) => {
          const show = frameRamp(f, cfg.fps, 8 + i * 6, 18);
          return <div key={i} style={{ display: "grid", gridTemplateColumns: "170px 1fr", gap: 16, alignItems: "center", opacity: show, borderBottom: i === props.rows.length - 1 ? "none" : "3px solid " + ink, padding: "10px 0" }}>
            <span style={{ fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 22, color: theme.colors.muted }}>{r.k}</span>
            <span style={{ fontSize: 31, lineHeight: 1.2, color: ink, fontWeight: i === 1 ? 900 : 700 }}>{r.v}</span>
          </div>;
        })}
        <div style={{ justifySelf: "end", background: theme.colors.accent, color: onColor(theme.colors.accent), border: "4px solid " + ink, padding: "8px 14px", fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 22 }}>đã kiểm chứng</div>
      </div>
    </Story></Frame>
  );
};
export const example: P = { stamp: "FWP", rows: [{ k: "ngày", v: "ngày 5 tháng 6 năm 2026" }, { k: "bên thuê", v: "Google LLC" }, { k: "bên cung cấp", v: "SpaceX" }] };
export default registerComponent<P>({ id: "gsx-filing-card", displayName: "Filing Card", promptGuide: "SEC filing source card", schema, Component: Scene, example });
`;

const GPU_GRID = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, useTheme, frameRamp } from "@news/blocks";
import { PRINT, onColor } from "@news/design";
export const schema = z.object({ meta: z.string().optional(), value: z.string(), unit: z.string(), label: z.string(), sideNotes: z.array(z.string()).min(2).max(3), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const ink = PRINT.ink; const f = useCurrentFrame(); const cfg = useVideoConfig();
  const fill = frameRamp(f, cfg.fps, 10, 34);
  const cells = Array.from({ length: 110 });
  return (
    <Frame><Story eyebrow={eyebrow ?? "GPU"} label="CAPACITY" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 18, alignItems: "stretch" }}>
        <div style={{ border: "4px solid " + ink, background: theme.colors.panel, padding: "22px", display: "grid", gridTemplateColumns: "repeat(11, 1fr)", gap: 6 }}>
          {cells.map((_, i) => {
            const on = i / 110 < fill;
            return <div key={i} style={{ aspectRatio: "1 / 1", border: "2px solid " + ink, background: on ? theme.colors.accent : theme.colors.bg }} />;
          })}
        </div>
        <div style={{ border: "4px solid " + ink, background: theme.colors.accent, color: onColor(theme.colors.accent), boxShadow: "10px 10px 0 " + ink, padding: "22px", display: "grid", alignContent: "center", gap: 16 }}>
          <div style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 84, lineHeight: 0.9 }}>{props.value}</div>
          <div style={{ fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 30, letterSpacing: "0.06em" }}>{props.unit}</div>
          <div style={{ borderTop: "4px solid " + onColor(theme.colors.accent), paddingTop: 14, fontSize: 27, lineHeight: 1.18 }}>{props.label}</div>
          <div style={{ display: "grid", gap: 8 }}>
            {props.sideNotes.map((n, i) => <span key={i} style={{ border: "3px solid " + onColor(theme.colors.accent), padding: "6px 10px", fontFamily: theme.fonts.mono, fontSize: 19, fontWeight: 800 }}>{n}</span>)}
          </div>
        </div>
      </div>
    </Story></Frame>
  );
};
export const example: P = { value: "110.000", unit: "GPU NVIDIA", label: "kèm CPU và bộ nhớ", sideNotes: ["huấn luyện", "vận hành"] };
export default registerComponent<P>({ id: "gsx-gpu-grid", displayName: "GPU Grid", promptGuide: "unit grid for roughly 110,000 GPUs", schema, Component: Scene, example });
`;

const MONEY_RUNWAY = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, useTheme, frameRamp } from "@news/blocks";
import { PRINT, onColor } from "@news/design";
export const schema = z.object({ meta: z.string().optional(), monthly: z.string(), range: z.string(), total: z.string(), note: z.string(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const ink = PRINT.ink; const f = useCurrentFrame(); const cfg = useVideoConfig();
  const grow = frameRamp(f, cfg.fps, 12, 38);
  return (
    <Frame><Story eyebrow={eyebrow ?? "DÒNG TIỀN"} label="33 THÁNG" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ border: "4px solid " + ink, background: theme.colors.panel, boxShadow: "10px 10px 0 " + theme.colors.signal, padding: "26px", display: "grid", gap: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ background: theme.colors.accent, color: onColor(theme.colors.accent), border: "4px solid " + ink, padding: "18px", display: "grid", gap: 4 }}>
            <span style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 58, lineHeight: 0.95 }}>{props.monthly}</span>
            <span style={{ fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 22 }}>mỗi tháng</span>
          </div>
          <div style={{ border: "4px solid " + ink, padding: "18px", display: "grid", alignContent: "center", gap: 8 }}>
            <span style={{ fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 21, color: theme.colors.muted }}>{props.range}</span>
            <span style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 52, color: ink }}>{props.total}</span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(11, 1fr)", gap: 7 }}>
          {Array.from({ length: 33 }).map((_, i) => <div key={i} style={{ height: 34, border: "3px solid " + ink, background: i / 33 < grow ? theme.colors.signal : theme.colors.bg }} />)}
        </div>
        <div style={{ fontSize: 28, lineHeight: 1.2, color: ink, borderTop: "4px solid " + ink, paddingTop: 14 }}>{props.note}</div>
      </div>
    </Story></Frame>
  );
};
export const example: P = { monthly: "920 triệu USD", range: "tháng 10 năm 2026 đến tháng 6 năm 2029", total: ">30 tỷ USD", note: "nếu chạy đủ kỳ hạn" };
export default registerComponent<P>({ id: "gsx-money-runway", displayName: "Money Runway", promptGuide: "monthly payment runway into total contract value", schema, Component: Scene, example });
`;

const DEADLINE_TREE = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, useTheme, frameRamp } from "@news/blocks";
import { PRINT, onColor } from "@news/design";
export const schema = z.object({ meta: z.string().optional(), deadline: z.string(), grace: z.string(), options: z.array(z.string()).length(2), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const ink = PRINT.ink; const f = useCurrentFrame(); const cfg = useVideoConfig();
  const line = frameRamp(f, cfg.fps, 10, 28); const branch = frameRamp(f, cfg.fps, 34, 16);
  return (
    <Frame><Story eyebrow={eyebrow ?? "ĐIỀU KIỆN"} label="DELIVERY GATE" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ border: "4px solid " + ink, background: theme.colors.panel, padding: "26px", display: "grid", gap: 18 }}>
        <div style={{ position: "relative", height: 190, border: "4px solid " + ink, background: theme.colors.bg, padding: 22 }}>
          <div style={{ position: "absolute", top: 92, left: 40, right: 40, height: 8, background: ink }} />
          <div style={{ position: "absolute", top: 92, left: 40, width: (line * 760).toFixed(1) + "px", height: 8, background: theme.colors.accent }} />
          <div style={{ position: "absolute", left: 34, top: 48, width: 120, height: 96, border: "4px solid " + ink, background: theme.colors.panel, display: "grid", placeItems: "center", fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 19, textAlign: "center" }}>triển khai dần</div>
          <div style={{ position: "absolute", left: 410, top: 34, width: 200, height: 124, border: "4px solid " + ink, background: theme.colors.accent, color: onColor(theme.colors.accent), display: "grid", placeItems: "center", textAlign: "center", padding: 8, fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 20 }}>{props.deadline}</div>
          <div style={{ position: "absolute", right: 36, top: 48, width: 160, height: 96, border: "4px solid " + ink, background: PRINT.yellow, color: onColor(PRINT.yellow), display: "grid", placeItems: "center", textAlign: "center", padding: 8, fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 20 }}>{props.grace}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, opacity: branch }}>
          {props.options.map((o, i) => <div key={i} style={{ border: "4px solid " + ink, background: i === 0 ? PRINT.red : theme.colors.signal, color: onColor(i === 0 ? PRINT.red : theme.colors.signal), padding: "18px", textAlign: "center", fontSize: 30, fontWeight: 900, lineHeight: 1.12 }}>{o}</div>)}
        </div>
      </div>
    </Story></Frame>
  );
};
export const example: P = { deadline: "ngày 30 tháng 9 năm 2026", grace: "thêm 1 tháng", options: ["chấm dứt", "giảm phí theo GPU thực tế"] };
export default registerComponent<P>({ id: "gsx-deadline-tree", displayName: "Deadline Tree", promptGuide: "delivery timeline with terminate or prorate branch", schema, Component: Scene, example });
`;

const EXIT_SWITCH = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, Callout, useTheme, frameRamp } from "@news/blocks";
import { PRINT, onColor } from "@news/design";
export const schema = z.object({ meta: z.string().optional(), trigger: z.string(), notice: z.string(), callout: z.string(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const ink = PRINT.ink; const f = useCurrentFrame(); const cfg = useVideoConfig();
  const lever = frameRamp(f, cfg.fps, 16, 28);
  return (
    <Frame><Story eyebrow={eyebrow ?? "ĐIỀU KHOẢN"} label="EXIT CLAUSE" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ display: "grid", gridTemplateColumns: "0.9fr 1.1fr", gap: 18, alignItems: "stretch" }}>
        <div style={{ border: "4px solid " + ink, background: theme.colors.panel, boxShadow: "8px 8px 0 " + PRINT.yellow, padding: "24px", display: "grid", alignContent: "center", gap: 18 }}>
          <div style={{ fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 22, color: theme.colors.muted }}>sau mốc</div>
          <div style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 54, lineHeight: 1, color: ink }}>{props.trigger}</div>
          <div style={{ height: 22, border: "4px solid " + ink, background: theme.colors.bg, position: "relative" }}>
            <div style={{ position: "absolute", left: (lever * 72).toFixed(1) + "%", top: -18, width: 46, height: 46, background: PRINT.red, border: "4px solid " + ink }} />
          </div>
        </div>
        <div style={{ border: "4px solid " + ink, background: theme.colors.accent, color: onColor(theme.colors.accent), padding: "28px", display: "grid", alignContent: "center", gap: 12 }}>
          <div style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 76, lineHeight: 0.9 }}>{props.notice}</div>
          <div style={{ fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 26, letterSpacing: "0.04em" }}>thông báo trước</div>
        </div>
      </div>
      <Callout tone="danger">{props.callout}</Callout>
    </Story></Frame>
  );
};
export const example: P = { trigger: "ngày 31 tháng 12 năm 2026", notice: "90 ngày", callout: "Đây không phải hợp đồng không thể thoát" };
export default registerComponent<P>({ id: "gsx-exit-switch", displayName: "Exit Switch", promptGuide: "90-day termination clause visual switch", schema, Component: Scene, example });
`;

const OWNERSHIP_FIREWALL = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, useTheme, frameRamp } from "@news/blocks";
import { PRINT, onColor } from "@news/design";
export const schema = z.object({ meta: z.string().optional(), leftTitle: z.string(), rightTitle: z.string(), items: z.array(z.string()).length(3), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const ink = PRINT.ink; const f = useCurrentFrame(); const cfg = useVideoConfig();
  return (
    <Frame><Story eyebrow={eyebrow ?? "SỞ HỮU"} label="FIREWALL" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 42px 1fr", gap: 14, alignItems: "stretch" }}>
        <div style={{ border: "4px solid " + ink, background: theme.colors.panel, padding: "22px", display: "grid", gap: 16 }}>
          <div style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 46, color: ink }}>{props.leftTitle}</div>
          <div style={{ display: "grid", gap: 10 }}>
            {props.items.map((it, i) => { const r = frameRamp(f, cfg.fps, 10 + i * 8, 18); return <div key={i} style={{ border: "4px solid " + ink, background: theme.colors.accent, color: onColor(theme.colors.accent), padding: "12px 14px", fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 26, opacity: r }}>{it}</div>; })}
          </div>
        </div>
        <div style={{ background: ink, display: "grid", placeItems: "center" }}><span style={{ writingMode: "vertical-rl", color: PRINT.paper, fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 20, letterSpacing: "0.08em" }}>KHÔNG CHUYỂN QUYỀN</span></div>
        <div style={{ border: "4px solid " + ink, background: theme.colors.panel, padding: "22px", display: "grid", alignContent: "center", gap: 18, boxShadow: "8px 8px 0 " + theme.colors.signal }}>
          <div style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 46, color: ink }}>{props.rightTitle}</div>
          <div style={{ height: 150, border: "4px solid " + ink, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, padding: 8, background: theme.colors.bg }}>
            {Array.from({ length: 15 }).map((_, i) => <div key={i} style={{ border: "2px solid " + ink, background: i % 3 === 0 ? theme.colors.signal : theme.colors.panel }} />)}
          </div>
          <div style={{ fontFamily: theme.fonts.mono, fontSize: 24, color: theme.colors.muted, fontWeight: 800 }}>năng lực tính toán được thuê</div>
        </div>
      </div>
    </Story></Frame>
  );
};
export const example: P = { leftTitle: "Google giữ", rightTitle: "SpaceX cung cấp", items: ["dữ liệu", "mô hình AI", "tài sản trí tuệ"] };
export default registerComponent<P>({ id: "gsx-ownership-firewall", displayName: "Ownership Firewall", promptGuide: "data/model/IP stays on Google side while compute is rented", schema, Component: Scene, example });
`;

const CAPEX_SCALE = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, useTheme, frameRamp } from "@news/blocks";
import { PRINT, onColor } from "@news/design";
export const schema = z.object({ meta: z.string().optional(), capex: z.string(), raise: z.string(), note: z.string(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const ink = PRINT.ink; const f = useCurrentFrame(); const cfg = useVideoConfig();
  const cap = frameRamp(f, cfg.fps, 10, 34); const eq = frameRamp(f, cfg.fps, 32, 18);
  return (
    <Frame><Story eyebrow={eyebrow ?? "BỐI CẢNH"} label="CAPEX" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ border: "4px solid " + ink, background: theme.colors.panel, padding: "26px", display: "grid", gap: 18, boxShadow: "10px 10px 0 " + theme.colors.accent }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ border: "4px solid " + ink, padding: "18px", display: "grid", gap: 8 }}>
            <span style={{ fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 22, color: theme.colors.muted }}>capex 2026 dự kiến</span>
            <span style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 54, color: ink }}>{props.capex}</span>
          </div>
          <div style={{ border: "4px solid " + ink, background: theme.colors.accent, color: onColor(theme.colors.accent), padding: "18px", display: "grid", gap: 8 }}>
            <span style={{ fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 22 }}>huy động vốn</span>
            <span style={{ fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 54 }}>{props.raise}</span>
          </div>
        </div>
        <div style={{ height: 70, border: "4px solid " + ink, background: theme.colors.bg, position: "relative" }}>
          <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: (cap * 100).toFixed(1) + "%", background: theme.colors.signal }} />
          <div style={{ position: "absolute", top: -10, bottom: -10, left: (eq * 42).toFixed(1) + "%", width: 8, background: ink }} />
        </div>
        <div style={{ fontSize: 30, lineHeight: 1.22, color: ink }}>{props.note}</div>
      </div>
    </Story></Frame>
  );
};
export const example: P = { capex: "180-190 tỷ USD", raise: "80 tỷ USD", note: "Nguồn vốn nhắm vào hạ tầng AI và global compute." };
export default registerComponent<P>({ id: "gsx-capex-scale", displayName: "Capex Scale", promptGuide: "Alphabet capex and capital raise context", schema, Component: Scene, example });
`;

const STACK_SHIFT = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, useTheme, frameRamp } from "@news/blocks";
import { PRINT, onColor } from "@news/design";
export const schema = z.object({ meta: z.string().optional(), layers: z.array(z.object({ title: z.string(), text: z.string() })).length(3), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const theme = useTheme(); const ink = PRINT.ink; const f = useCurrentFrame(); const cfg = useVideoConfig();
  const tones = [theme.colors.accent, theme.colors.signal, PRINT.yellow];
  return (
    <Frame><Story eyebrow={eyebrow ?? "Ý NGHĨA"} label="AI STACK" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ display: "grid", gap: 14 }}>
        {props.layers.map((l, i) => { const r = frameRamp(f, cfg.fps, 10 + i * 10, 20); const c = tones[i]!; return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 0, border: "4px solid " + ink, background: theme.colors.panel, opacity: r, transform: "translateY(" + ((1 - r) * 20).toFixed(1) + "px)" }}>
            <div style={{ background: c, color: onColor(c), borderRight: "4px solid " + ink, padding: "18px", fontFamily: theme.fonts.display, fontWeight: 900, fontSize: 35, display: "grid", placeItems: "center", textAlign: "center" }}>{l.title}</div>
            <div style={{ padding: "20px 24px", fontSize: 31, lineHeight: 1.2, color: ink, fontWeight: 700 }}>{l.text}</div>
          </div>
        ); })}
      </div>
    </Story></Frame>
  );
};
export const example: P = { layers: [{ title: "mô hình", text: "thuật toán và dữ liệu" }, { title: "compute", text: "GPU, CPU, bộ nhớ" }, { title: "vận hành", text: "điện, làm mát, hợp đồng dài hạn" }] };
export default registerComponent<P>({ id: "gsx-stack-shift", displayName: "Stack Shift", promptGuide: "AI competition shifting from model only to compute capacity", schema, Component: Scene, example });
`;

const DECISION_CTA = `import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, useTheme } from "@news/blocks";
import { PRINT, onColor } from "@news/design";
export const schema = z.object({ meta: z.string().optional(), choices: z.array(z.object({ title: z.string(), text: z.string() })).length(3), callout: z.string(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, body, eyebrow, props }) => {
  const theme = useTheme(); const ink = PRINT.ink; const tones = [theme.colors.accent, theme.colors.signal, PRINT.yellow];
  return (
    <Frame><Story eyebrow={eyebrow ?? "CHỐT LẠI"} label="DECISION" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined} gap={18}>
      <TitleBlock headline={headline} body={body} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
        {props.choices.map((c, i) => {
          const col = tones[i]!;
          return <div key={i} style={{ border: "4px solid " + ink, background: theme.colors.panel, boxShadow: "6px 6px 0 " + col, minHeight: 160, display: "grid", gridTemplateRows: "54px 1fr" }}>
            <div style={{ background: col, color: onColor(col), borderBottom: "4px solid " + ink, display: "grid", placeItems: "center", fontFamily: theme.fonts.mono, fontWeight: 800, fontSize: 24, letterSpacing: "0.08em" }}>{c.title}</div>
            <div style={{ padding: "18px 16px", fontSize: 31, lineHeight: 1.18, color: ink, display: "flex", alignItems: "center" }}>{c.text}</div>
          </div>;
        })}
      </div>
      <div style={{ border: "4px solid " + ink, borderLeft: "16px solid " + theme.colors.signal, background: theme.colors.panel, padding: "18px 24px", fontSize: 36, fontWeight: 900, lineHeight: 1.15, color: ink }}>{props.callout}</div>
    </Story></Frame>
  );
};
export const example: P = { choices: [{ title: "mua", text: "tự sở hữu" }, { title: "thuê", text: "linh hoạt" }, { title: "lai", text: "cân bằng" }], callout: "Câu hỏi chốt" };
export default registerComponent<P>({ id: "gsx-decision-cta", displayName: "Decision CTA", promptGuide: "closing decision board", schema, Component: Scene, example });
`;

type Trans = "slide" | "fade" | "wipe" | "clockWipe" | "zoom";
const M = (
  id: string,
  component: string,
  eyebrow: string,
  headline: string,
  narration: string,
  props: Record<string, unknown>,
  body?: string,
  transitionToNext?: Trans,
  emphasis?: "zoom",
) => ({ id, component, eyebrow, headline, narration, props, ...(body ? { body } : {}), ...(transitionToNext ? { transitionToNext } : {}), ...(emphasis ? { emphasis } : {}) });

const MANIFEST = {
  title: "Google thuê compute AI từ SpaceX",
  theme: { dominant: "#1E9CB0", mood: "editorial teal hạ tầng AI" },
  scenes: [
    M(
      "scene-01",
      "gsx-deal-pipe",
      "HỢP ĐỒNG",
      "Google mua thứ khan nhất của AI",
      "Điểm bất ngờ không phải là Google chi thêm tiền cho AI, mà là theo FWP của SpaceX gửi SEC, Google đang thuê trực tiếp năng lực tính toán AI quy mô cực lớn từ SpaceX.",
      { meta: "SEC FWP", left: "Google", right: "SpaceX", center: "thuê compute AI", chips: ["GPU", "CPU", "bộ nhớ"], callout: "Khi compute thành tài nguyên chiến lược", footer: "GOOGLE x SPACEX" },
      undefined,
      "zoom",
      "zoom",
    ),
    M(
      "scene-02",
      "gsx-filing-card",
      "NGUỒN",
      "Tin này nằm trong hồ sơ SEC",
      "Nguồn chính là Free Writing Prospectus của SpaceX, nộp ngày 5 tháng 6 năm 2026, nói rằng SpaceX đã ký Cloud Service Agreement với Google LLC cùng ngày.",
      { meta: "ngày 5 tháng 6 năm 2026", stamp: "SEC FWP", rows: [{ k: "nguồn", v: "SpaceX gửi SEC" }, { k: "ngày ký", v: "ngày 5 tháng 6 năm 2026" }, { k: "bên thuê", v: "Google LLC" }, { k: "hợp đồng", v: "Cloud Service Agreement" }], footer: "ĐÃ KIỂM CHỨNG" },
      undefined,
      "wipe",
    ),
    M(
      "scene-03",
      "gsx-gpu-grid",
      "GPU",
      "110.000 GPU NVIDIA",
      "Gói compute trong tài liệu gồm khoảng 110.000 GPU NVIDIA, cộng với CPU, bộ nhớ và các linh kiện liên quan để huấn luyện và vận hành mô hình AI.",
      { meta: "compute bundle", value: "110.000", unit: "GPU NVIDIA", label: "kèm CPU, bộ nhớ và linh kiện liên quan", sideNotes: ["huấn luyện", "vận hành", "mô hình AI"], footer: "NĂNG LỰC TÍNH TOÁN" },
      undefined,
      "slide",
      "zoom",
    ),
    M(
      "scene-04",
      "gsx-money-runway",
      "DÒNG TIỀN",
      "920 triệu USD mỗi tháng",
      "Từ tháng 10 năm 2026 đến tháng 6 năm 2029, Google đồng ý trả 920 triệu USD mỗi tháng; nếu chạy đủ kỳ hạn, giá trị có thể vượt 30 tỷ USD.",
      { meta: "2026-2029", monthly: "920 triệu USD", range: "tháng 10 năm 2026 đến tháng 6 năm 2029", total: ">30 tỷ USD", note: "Con số này phụ thuộc hợp đồng chạy đủ kỳ hạn và đủ năng lực được bàn giao.", footer: "GIÁ TRỊ HỢP ĐỒNG" },
      undefined,
      "clockWipe",
      "zoom",
    ),
    M(
      "scene-05",
      "gsx-deadline-tree",
      "ĐIỀU KIỆN",
      "Không giao đủ thì giảm tiền",
      "Công suất GPU được triển khai dần đến tháng 9 năm 2026. Nếu SpaceX không giao đủ trước ngày 30 tháng 9 năm 2026, sau 1 tháng ân hạn, Google có thể chấm dứt hoặc trả ít hơn theo số GPU thực tế.",
      { meta: "deadline", deadline: "ngày 30 tháng 9 năm 2026", grace: "ân hạn 1 tháng", options: ["Google chấm dứt", "giảm phí theo GPU thực tế"], footer: "RỦI RO BÀN GIAO" },
      undefined,
      "slide",
    ),
    M(
      "scene-06",
      "gsx-exit-switch",
      "ĐIỀU KHOẢN",
      "Có cửa thoát sau 2026",
      "FWP cũng ghi rằng sau ngày 31 tháng 12 năm 2026, mỗi bên có thể chấm dứt thỏa thuận bằng thông báo trước 90 ngày. Vì vậy đây không phải một khoản chi hoàn toàn khóa cứng đến 2029.",
      { meta: "exit clause", trigger: "ngày 31 tháng 12 năm 2026", notice: "90 ngày", callout: "Quy mô rất lớn, nhưng vẫn có điều khoản rút lui.", footer: "ĐIỀU KHOẢN" },
      undefined,
      "wipe",
    ),
    M(
      "scene-07",
      "gsx-ownership-firewall",
      "SỞ HỮU",
      "Google vẫn giữ lõi AI",
      "Một chi tiết quan trọng: Google giữ quyền sở hữu với nội dung, dữ liệu, mô hình AI và tài sản trí tuệ liên quan. SpaceX cung cấp compute, không lấy phần lõi của hệ thống.",
      { meta: "data rights", leftTitle: "Google giữ", rightTitle: "SpaceX cung cấp", items: ["dữ liệu", "mô hình AI", "tài sản trí tuệ"], footer: "RANH GIỚI QUYỀN SỞ HỮU" },
      undefined,
      "slide",
      "zoom",
    ),
    M(
      "scene-08",
      "gsx-capex-scale",
      "BỐI CẢNH",
      "Capex AI phình rất nhanh",
      "Vài ngày trước, Alphabet cũng công bố kế hoạch huy động 80 tỷ USD, đồng thời nói capex năm 2026 dự kiến ở mức 180 đến 190 tỷ USD để mở rộng hạ tầng AI và global compute.",
      { meta: "Alphabet · ngày 1 tháng 6 năm 2026", capex: "180-190 tỷ USD", raise: "80 tỷ USD", note: "Alphabet nói nguồn vốn phục vụ mở rộng hạ tầng AI và global compute; 2027 còn dự kiến tăng đáng kể so với 2026.", footer: "BỐI CẢNH THỊ TRƯỜNG" },
      undefined,
      "clockWipe",
    ),
    M(
      "scene-09",
      "gsx-stack-shift",
      "Ý NGHĨA",
      "Cuộc đua chuyển xuống tầng compute",
      "Thỏa thuận này cho thấy cuộc đua AI không chỉ nằm ở mô hình nào thông minh hơn. Lợi thế mới nằm ở ai có đủ GPU, điện, làm mát và hợp đồng vận hành để chạy AI ở quy mô công nghiệp.",
      { meta: "AI infrastructure", layers: [{ title: "mô hình", text: "khả năng suy luận và sản phẩm AI" }, { title: "compute", text: "GPU, CPU, bộ nhớ, mạng tốc độ cao" }, { title: "vận hành", text: "điện, làm mát, lịch bàn giao và hợp đồng dài hạn" }], footer: "TỪ MODEL ĐẾN HẠ TẦNG" },
      undefined,
      "slide",
    ),
    M(
      "scene-10",
      "gsx-decision-cta",
      "CHỐT LẠI",
      "AI giờ là bài toán công suất",
      "Nếu nút thắt của AI là compute, câu hỏi lớn không còn chỉ là mô hình nào tốt nhất, mà là doanh nghiệp nên tự xây, đi thuê, hay kết hợp cả hai để không bị hụt công suất.",
      { meta: "takeaway", choices: [{ title: "tự xây", text: "kiểm soát cao, vốn lớn" }, { title: "đi thuê", text: "mở rộng nhanh, phụ thuộc đối tác" }, { title: "kết hợp", text: "giữ phần lõi, thuê phần thiếu" }], callout: "Bạn sẽ đặt cược vào sở hữu hạ tầng hay thuê compute linh hoạt?", footer: "QUYẾT ĐỊNH CHIẾN LƯỢC" },
      "Từ mô hình sang công suất vận hành.",
      "fade",
    ),
  ],
};

const FULL = { safeArea: true, alignment: true, transitions: true, clutter: true, hook: true, cta: true, audio: true, richness: true };

async function setup(): Promise<void> {
  await scaffoldVideoProject({ prompt: MANIFEST.title, projectId: ID, duration: TARGET_SECONDS, tts: { provider: "vivibe" } });
  await writeAuthoredScene(ID, "deal-pipe.tsx", DEAL_PIPE);
  await writeAuthoredScene(ID, "filing-card.tsx", FILING_CARD);
  await writeAuthoredScene(ID, "gpu-grid.tsx", GPU_GRID);
  await writeAuthoredScene(ID, "money-runway.tsx", MONEY_RUNWAY);
  await writeAuthoredScene(ID, "deadline-tree.tsx", DEADLINE_TREE);
  await writeAuthoredScene(ID, "exit-switch.tsx", EXIT_SWITCH);
  await writeAuthoredScene(ID, "ownership-firewall.tsx", OWNERSHIP_FIREWALL);
  await writeAuthoredScene(ID, "capex-scale.tsx", CAPEX_SCALE);
  await writeAuthoredScene(ID, "stack-shift.tsx", STACK_SHIFT);
  await writeAuthoredScene(ID, "decision-cta.tsx", DECISION_CTA);
  await writeJson(projectPaths(ID).manifest, MANIFEST);
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "stills";
  await setup();
  const admitted = await admitProjectScenes(ID);
  if (!admitted.ok) {
    console.error("[gsx] admission FAILED", admitted.violations);
    process.exitCode = 1;
    return;
  }

  if (mode === "stills") {
    const spec = await loadManifestAsSpec(ID);
    const tts = await synthesizeNarration(spec, { projectId: ID, provider: "mock" });
    const locked = lockSpec(spec, tts, { mixedNarrationSrc: tts?.mixedSrc });
    const p = projectPaths(ID);
    await writeJson(p.lock, locked);
    const entry = p.authoredDir + "\\_entry.tsx";
    await generateAuthoredEntry({ entryPath: entry, authoredFiles: admitted.files, lockJsonPath: p.lock });
    const out = await renderSceneStills(locked, p.reviewDir, { projectRoot: p.root, entryPoint: entry, remotionRoot: remotionAppRoot() });
    console.log("[gsx] stills " + out.length + " at " + p.reviewDir + " frames=" + locked.durationInFrames);
  } else {
    const provider = (process.argv[3] as "vivibe" | "mock") ?? "vivibe";
    const quality = mode === "draft" ? "draft" : "full";
    const r = await renderProject(ID, { ttsProvider: provider, checklist: FULL, noCache: true, quality });
    console.log("[gsx] " + quality + " mp4=" + r.mp4Path + " frames=" + r.locked.durationInFrames + " (~" + (r.locked.durationInFrames / r.locked.fps).toFixed(1) + "s) ok=" + r.report.ok);
    const errs = r.report.issues.filter((i) => i.severity === "error");
    const warns = r.report.issues.filter((i) => i.severity === "warning");
    console.log("[gsx] errors=" + errs.length + " warnings=" + warns.length);
    for (const i of errs) console.log("  ERR " + i.check + " " + (i.sceneId ?? "-") + ": " + i.message);
    for (const i of warns) console.log("  warn " + i.check + " " + (i.sceneId ?? "-") + ": " + i.message);
  }
  console.log("[gsx] OK");
}

main().catch((e: unknown) => {
  console.error("[gsx] FAILED");
  console.error(e);
  process.exitCode = 1;
});
