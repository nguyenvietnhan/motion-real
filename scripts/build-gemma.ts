/**
 * Author + render the Gemma 3 QAT / local-LLM video (a DIFFERENT topic, to test
 * the system produces content-appropriate, diverse visuals — incl. a bespoke
 * memory-fit chart). Usage:
 *   npx tsx scripts/build-gemma.ts stills
 *   npx tsx --env-file=.env scripts/build-gemma.ts draft vivibe
 *   npx tsx --env-file=.env scripts/build-gemma.ts full  vivibe
 *
 * Facts grounded in Google's Gemma 3 QAT release (developers.googleblog.com):
 * 27B 54GB→14.1GB (int4, fits a 24GB consumer GPU like RTX 3090), 12B→6.6GB,
 * 4B→2.6GB, 1B→0.5GB; QAT keeps quality close to bf16.
 */
import {
  scaffoldVideoProject, renderProject, admitProjectScenes, loadManifestAsSpec,
  synthesizeNarration, lockSpec, renderSceneStills, generateAuthoredEntry, remotionAppRoot,
} from "../packages/pipeline/src/index.js";
import { projectPaths, writeJson } from "../packages/pipeline/src/store/store.js";
import { writeAuthoredScene } from "../packages/pipeline/src/authoring/manifest.js";

const ID = "gemma-qat";
const TARGET_SECONDS = 120 as const;

const STATEMENT = `import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, Callout } from "@news/blocks";
export const schema = z.object({ label: z.string().optional(), meta: z.string().optional(), callout: z.string().optional(), tone: z.enum(["accent","signal","danger"]).optional(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, body, eyebrow, props }) => (
  <Frame><Story eyebrow={eyebrow ?? "GEMMA"} label={props.label} meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
    <TitleBlock headline={headline} body={body} />
    {props.callout ? <Callout tone={props.tone ?? "accent"}>{props.callout}</Callout> : null}
  </Story></Frame>
);
export const example: P = { label: "TIN AI", meta: "2026", callout: "Một ý chính" };
export default registerComponent<P>({ id: "gm-statement", displayName: "Statement", promptGuide: "hook/idea/cta", schema, Component: Scene, example });
`;

const STAT = `import React from "react";
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
export default registerComponent<P>({ id: "gm-stat", displayName: "Stat", promptGuide: "animated number", schema, Component: Scene, example });
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
export default registerComponent<P>({ id: "gm-points", displayName: "Points", promptGuide: "list", schema, Component: Scene, example });
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
      <div style={{ flex: 1 }}><Panel title={props.leftTag} tone="red">{props.left}</Panel></div>
      <div style={{ flex: 1 }}><Panel title={props.rightTag} tone="green">{props.right}</Panel></div>
    </div>
  </Story></Frame>
);
export const example: P = { leftTag: "A", left: "x", rightTag: "B", right: "y" };
export default registerComponent<P>({ id: "gm-compare", displayName: "Compare", promptGuide: "two-column", schema, Component: Scene, example });
`;

// BESPOKE, topic-specific visualization: horizontal VRAM bars labeled in GB with
// a dashed "GPU capacity" line so you can SEE which models fit on a 24GB card.
// Bars grow in (fps-aware ramp), then hold. Deterministic.
const MEMFIT = `import React from "react";
import { z } from "zod";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Story, TitleBlock, frameRamp } from "@news/blocks";
const INK = "#17150F"; const PAPER = "#FCF9F1"; const MUTED = "#6E6757";
const TONES: Record<string,string> = { red: "#E8412E", green: "#1FA463", blue: "#2F5FF0", yellow: "#F4B400", violet: "#7A4DE0" };
export const schema = z.object({ meta: z.string().optional(), items: z.array(z.object({ label: z.string(), gb: z.number(), tone: z.enum(["red","green","blue","yellow","violet"]).optional() })).min(1).max(4), maxGb: z.number(), capacityGb: z.number().optional(), capacityLabel: z.string().optional(), footer: z.string().optional() });
type P = z.infer<typeof schema>;
const Scene: React.FC<SceneComponentProps<P>> = ({ headline, eyebrow, props }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const capPct = props.capacityGb != null ? Math.min(1, props.capacityGb / props.maxGb) : null;
  return (
    <Frame><Story eyebrow={eyebrow ?? "BỘ NHỚ"} label="VRAM" meta={props.meta} footer={props.footer ? { left: props.footer, right: props.meta } : undefined}>
      <TitleBlock headline={headline} />
      <div style={{ border: "4px solid " + INK, background: PAPER, padding: 34, display: "grid", gap: 26, position: "relative" }}>
        {capPct != null ? (
          <div style={{ position: "absolute", top: 18, bottom: 18, left: "calc(" + (capPct * 100).toFixed(2) + "% )", width: 0, borderLeft: "4px dashed " + INK }}>
            <div style={{ position: "absolute", top: -2, left: capPct > 0.72 ? -10 : 10, transform: capPct > 0.72 ? "translateX(-100%)" : "none", fontFamily: "Cascadia Mono, Consolas, monospace", fontSize: 22, fontWeight: 800, color: INK, whiteSpace: "nowrap" }}>{props.capacityLabel ?? "GPU"}</div>
          </div>
        ) : null}
        {props.items.map((it, i) => {
          const c = TONES[it.tone ?? "green"]!;
          const grow = frameRamp(f, fps, 8 + i * 7, 26);
          const full = Math.min(1, it.gb / props.maxGb);
          const w = full * grow;
          return (
            <div key={i} style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "Cascadia Mono, Consolas, monospace", fontSize: 26, color: INK }}>
                <span style={{ fontWeight: 800 }}>{it.label}</span>
                <span style={{ color: c, fontWeight: 800 }}>{(it.gb * grow).toFixed(1)} GB</span>
              </div>
              <div style={{ height: 44, border: "4px solid " + INK, background: "#F2ECDC" }}>
                <div style={{ height: "100%", width: (w * 100).toFixed(2) + "%", background: c }} />
              </div>
            </div>
          );
        })}
        <div style={{ fontFamily: "Cascadia Mono, Consolas, monospace", fontSize: 22, color: MUTED, letterSpacing: "0.04em" }}>Thang đo tới {props.maxGb}GB VRAM</div>
      </div>
    </Story></Frame>
  );
};
export const example: P = { items: [{ label: "FP16 27B", gb: 54, tone: "red" }, { label: "QAT 27B", gb: 14.1, tone: "green" }], maxGb: 56, capacityGb: 24, capacityLabel: "GPU 24GB" };
export default registerComponent<P>({ id: "gm-memfit", displayName: "MemFit", promptGuide: "bespoke VRAM bars with a GPU-capacity line", schema, Component: Scene, example });
`;

// A DIFFERENT way to present an enumeration: a row of standing CARDS (big index
// + title + line), not the usual horizontal numbered list — same 1·2·3, varied
// form. Staggered entrance, deterministic.
const CARDS = `import React from "react";
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
  const grid = props.cards.length === 4; // 4 ideas read better as a 2x2 grid than a cramped row
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
export default registerComponent<P>({ id: "gm-cards", displayName: "Cards", promptGuide: "enumeration shown as a row of standing cards", schema, Component: Scene, example });
`;

// Another way to present a PERCENTAGE (not a giant count-up number): a squared
// 10-cell fill meter + the figure. Same kind of data, different, on-brand form.
const METER = `import React from "react";
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
export const example: P = { percent: 72, statLabel: "Giảm bộ nhớ" };
export default registerComponent<P>({ id: "gm-meter", displayName: "Meter", promptGuide: "a percentage as a squared 10-cell fill meter", schema, Component: Scene, example });
`;

type Trans = "slide" | "fade" | "wipe" | "clockWipe" | "zoom";
const M = (id: string, component: string, eyebrow: string, headline: string, narration: string, props: Record<string, unknown>, body?: string, transitionToNext?: Trans, emphasis?: "zoom") =>
  ({ id, component, eyebrow, headline, narration, props, ...(body ? { body } : {}), ...(transitionToNext ? { transitionToNext } : {}), ...(emphasis ? { emphasis } : {}) });

const MANIFEST = {
  title: "Gemma 3 QAT: LLM mạnh chạy trên máy nhà",
  theme: { dominant: "#1E9CB0", mood: "editorial teal kỹ thuật" },
  scenes: [
    M("scene-01", "gm-statement", "GEMMA", "LLM 27B chạy trên máy nhà",
      "Trước đây, để chạy một mô hình hai mươi bảy tỷ tham số bạn cần cả một dàn máy chủ đắt đỏ, nhưng với Gemma 3 bản QAT, chính chiếc card đồ họa phổ thông trong máy bạn giờ đã đủ sức gánh nó.",
      { label: "TIN AI", meta: "2026", callout: "Mô hình lớn không còn là đặc quyền của server", tone: "accent", footer: "GEMMA 3 QAT" }, "Mô hình lớn giờ chạy được trên GPU phổ thông.", "zoom", "zoom"),
    M("scene-02", "gm-memfit", "BỘ NHỚ", "54GB co lại còn 14GB",
      "Hãy nhìn vào con số gây sốc nhất, bản gốc của mô hình hai mươi bảy tỷ tham số ngốn tới năm mươi tư gigabyte bộ nhớ, nhưng sau khi nén bằng QAT, nó chỉ còn khoảng mười bốn gigabyte, lọt thỏm dưới ngưỡng của một card hai mươi bốn gigabyte.",
      { meta: "2026", items: [{ label: "Bản gốc 27B", gb: 54, tone: "red" }, { label: "QAT 27B", gb: 14.1, tone: "green" }], maxGb: 56, capacityGb: 24, capacityLabel: "GPU 24GB", footer: "VRAM" }, undefined, "slide", "zoom"),
    M("scene-03", "gm-statement", "KHÁI NIỆM", "QAT là gì",
      "QAT, hay lượng tử hóa ngay trong lúc huấn luyện, nghĩa là mô hình được dạy để quen với việc bị nén số ngay từ đầu, thay vì nén thô bạo sau khi đã huấn luyện xong rồi mới chịu hậu quả về chất lượng.",
      { label: "GIẢI THÍCH", meta: "2026", callout: "Học cách sống chung với việc bị nén", tone: "accent", footer: "QAT" }, "Mô hình quen với việc bị nén ngay từ khi học.", "wipe"),
    M("scene-04", "gm-meter", "DỮ LIỆU", "Bộ nhớ giảm mạnh",
      "Kết quả là phần bộ nhớ cần thiết giảm tới khoảng bảy mươi hai phần trăm so với bản gốc, một mức cắt giảm khổng lồ mà vẫn giữ được chất lượng gần như ngang ngửa phiên bản đầy đủ.",
      { meta: "2026", percent: 72, statLabel: "Giảm bộ nhớ so với bản gốc", footer: "QAT" }, undefined, "zoom"),
    M("scene-05", "gm-memfit", "BỘ NHỚ", "Cả nhà Gemma đều vừa",
      "Và không chỉ riêng bản lớn nhất, cả gia đình Gemma đều thu gọn lại, từ bản mười hai tỷ chỉ còn quanh sáu phẩy sáu gigabyte, cho tới bản bốn tỷ chỉ còn khoảng hai phẩy sáu gigabyte, tất cả đều lọt thỏm dưới ngưỡng máy phổ thông.",
      { meta: "2026", items: [{ label: "QAT 27B", gb: 14.1, tone: "green" }, { label: "QAT 12B", gb: 6.6, tone: "blue" }, { label: "QAT 4B", gb: 2.6, tone: "violet" }], maxGb: 28, capacityGb: 24, capacityLabel: "GPU 24GB", footer: "VRAM" }, undefined, "slide"),
    M("scene-06", "gm-compare", "SO SÁNH", "QAT khác gì nén thường",
      "Điểm khác biệt then chốt nằm ở đây, nén thô sau huấn luyện thường khiến mô hình mất chất lượng thấy rõ, trong khi QAT dạy mô hình thích nghi từ sớm nên gần như giữ trọn được độ thông minh ban đầu.",
      { meta: "2026", leftTag: "NÉN THƯỜNG", left: "Nén sau khi học, chất lượng rớt thấy rõ.", rightTag: "QAT", right: "Quen nén từ sớm, giữ gần trọn chất lượng.", footer: "ĐÁNH ĐỔI" }, undefined, "clockWipe"),
    M("scene-07", "gm-stat", "PHẦN CỨNG", "Vừa khít một chiếc GPU",
      "Cụ thể hơn, bản hai mươi bảy tỷ sau khi nén chỉ cần khoảng mười bốn gigabyte, nghĩa là một chiếc card chơi game đời cũ với hai mươi bốn gigabyte bộ nhớ cũng đủ sức chạy nó ngon lành.",
      { meta: "2026", to: 14.1, decimals: 1, suffix: " GB", statLabel: "VRAM cho bản 27B đã nén", note: "Đủ chạy trên một card 24GB như dòng RTX phổ thông.", tone: "signal", footer: "PHẦN CỨNG" }, undefined, "zoom", "zoom"),
    M("scene-08", "gm-cards", "MỞ RA", "Nó mở ra điều gì",
      "Khi một mô hình mạnh chạy được ngay trên máy, rất nhiều cánh cửa mở ra, từ xử lý dữ liệu riêng tư, dựng trợ lý chạy nội bộ, cho tới các tác vụ lặp đi lặp lại mà không còn lo hóa đơn gọi máy chủ phình to.",
      { meta: "2026", cards: [{ title: "Dữ liệu riêng tư", text: "Xử lý ngay trên máy, không gửi ra ngoài." }, { title: "Trợ lý nội bộ", text: "Agent chạy trong máy, không lệ thuộc API." }, { title: "Việc lặp lại", text: "Chạy hàng loạt mà không lo hóa đơn." }], footer: "ỨNG DỤNG" }, undefined, "slide"),
    M("scene-09", "gm-statement", "LƯU Ý", "Đừng kỳ vọng quá đà",
      "Nhưng hãy thành thật với nhau, QAT giúp mô hình nhẹ đi chứ không hô biến nó thành những mô hình khổng lồ mạnh nhất, nên đừng kỳ vọng một bản chạy trên máy nhà sẽ thay thế hoàn toàn các mô hình hàng đầu.",
      { label: "THỰC TẾ", meta: "2026", callout: "Nhẹ hơn, không phải mạnh nhất hành tinh", tone: "danger", footer: "GIỚI HẠN" }, "Nhẹ hơn, nhưng không thành mô hình khổng lồ.", "fade"),
    M("scene-10", "gm-compare", "CHIẾN LƯỢC", "Cách dùng khôn ngoan",
      "Vì vậy cách dùng hợp lý nhất là kết hợp, để mô hình chạy trên máy lo những việc nhỏ và lặp lại, còn những việc thực sự khó thì mới gọi tới mô hình mạnh trên đám mây, vừa tiết kiệm vừa an toàn dữ liệu.",
      { meta: "2026", leftTag: "TRÊN MÁY", left: "Việc nhỏ, lặp lại, cần riêng tư.", rightTag: "ĐÁM MÂY", right: "Việc khó, cần mô hình mạnh nhất.", footer: "HYBRID" }, undefined, "slide"),
    M("scene-11", "gm-points", "TÓM LẠI", "Ba điều cần nhớ",
      "Tóm lại, hãy ghi nhớ ba điều cốt lõi này trước khi bạn quyết định kéo một mô hình ngôn ngữ lớn về chạy thẳng trên chính chiếc máy của mình.",
      { meta: "2026", points: ["QAT cắt mạnh bộ nhớ mà giữ chất lượng", "Bản 27B vừa khít một card 24GB", "Khôn nhất là kết hợp máy nhà và đám mây"], footer: "RECAP" }, undefined, "fade"),
    M("scene-12", "gm-statement", "CÂU HỎI", "Bạn sẽ chạy thử chứ",
      "Vậy nếu giờ đây một mô hình hai mươi bảy tỷ tham số đã nằm gọn trong chiếc máy của bạn, công việc đầu tiên mà bạn muốn giao cho nó xử lý ngay tại chỗ sẽ là gì?",
      { label: "CHỐT LẠI", meta: "2026", callout: "Việc đầu tiên bạn giao cho model chạy local là gì?", tone: "signal", footer: "QUYẾT ĐỊNH" }, "Mô hình lớn đã nằm trong máy bạn, để làm gì trước?"),
  ],
};

const FULL = { safeArea: true, alignment: true, transitions: true, clutter: true, hook: true, cta: true, audio: true, richness: true };

async function setup(): Promise<void> {
  await scaffoldVideoProject({ prompt: MANIFEST.title, projectId: ID, duration: TARGET_SECONDS, tts: { provider: "vivibe" } });
  await writeAuthoredScene(ID, "statement.tsx", STATEMENT);
  await writeAuthoredScene(ID, "stat.tsx", STAT);
  await writeAuthoredScene(ID, "points.tsx", POINTS);
  await writeAuthoredScene(ID, "compare.tsx", COMPARE);
  await writeAuthoredScene(ID, "memfit.tsx", MEMFIT);
  await writeAuthoredScene(ID, "cards.tsx", CARDS);
  await writeAuthoredScene(ID, "meter.tsx", METER);
  await writeJson(projectPaths(ID).manifest, MANIFEST);
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "stills";
  await setup();
  const admitted = await admitProjectScenes(ID);
  if (!admitted.ok) { console.error("[g] admission FAILED", admitted.violations); process.exitCode = 1; return; }

  if (mode === "stills") {
    const spec = await loadManifestAsSpec(ID);
    const tts = await synthesizeNarration(spec, { projectId: ID, provider: "mock" });
    const locked = lockSpec(spec, tts, { mixedNarrationSrc: tts?.mixedSrc });
    const p = projectPaths(ID);
    await writeJson(p.lock, locked);
    const entry = p.authoredDir + "\\_entry.tsx";
    await generateAuthoredEntry({ entryPath: entry, authoredFiles: admitted.files, lockJsonPath: p.lock });
    const out = await renderSceneStills(locked, p.reviewDir, { projectRoot: p.root, entryPoint: entry, remotionRoot: remotionAppRoot() });
    console.log("[g] stills " + out.length + " at " + p.reviewDir + " frames=" + locked.durationInFrames);
  } else {
    const provider = (process.argv[3] as "vivibe" | "mock") ?? "vivibe";
    const quality = mode === "draft" ? "draft" : "full";
    const r = await renderProject(ID, { ttsProvider: provider, checklist: FULL, noCache: true, quality });
    console.log("[g] " + quality + " mp4=" + r.mp4Path + " frames=" + r.locked.durationInFrames + " (~" + (r.locked.durationInFrames / r.locked.fps).toFixed(1) + "s) ok=" + r.report.ok);
    const errs = r.report.issues.filter((i) => i.severity === "error");
    const warns = r.report.issues.filter((i) => i.severity === "warning");
    console.log("[g] errors=" + errs.length + " warnings=" + warns.length);
    for (const i of errs) console.log("  ERR " + i.check + " " + (i.sceneId ?? "-") + ": " + i.message);
    for (const i of warns) console.log("  warn " + i.check + " " + (i.sceneId ?? "-") + ": " + i.message);
  }
  console.log("[g] OK");
}

main().catch((e: unknown) => { console.error("[g] FAILED"); console.error(e); process.exitCode = 1; });
