/**
 * The "galaxy" design language — a genuinely different look, NOT editorial with a
 * dark palette. This is the proof that the system is multi-language: it changes
 * polarity, corner geometry, surface grammar, accent expression, labels, fonts,
 * and backdrop — while obeying the SAME invariant layout law (zones, caption
 * band, divider, determinism, min type sizes) that every language must.
 *
 * Premium dark space look: a deep radial night base with light ink, FULLY ROUNDED
 * corners on every block/chip/bar, hairline borders, soft NEON GLOW instead of a
 * hard drop shadow, OUTLINE (not solid) accent chips, natural-case labels (no
 * shouty uppercase), a deterministic starfield backdrop, neon-tuned semantic
 * colors, and a clean Vietnamese-complete sans (Be Vietnam Pro). A faint dark
 * scrim keeps the caption legible over the starfield.
 */

import {
  clamp,
  hexToHsl,
  hslToHex,
  withAlpha,
  type CoreColors,
  type DerivedLanguage,
  type StyleLanguage,
} from "../core.js";

function deriveGalaxy(dominant: string): DerivedLanguage {
  const [h, s] = hexToHsl(dominant);
  // On a dark base the accent must GLOW: lift lightness + keep saturation high so
  // it reads as neon against the deep night, not a muddy mid-tone. The companion
  // is a split-complement, equally lifted, so compares/segments stay distinct.
  const accent = hslToHex(h, clamp(Math.max(s, 72), 62, 96), 64);
  const signal = hslToHex((h + 150) % 360, clamp(Math.max(s, 64), 60, 94), 62);

  // Deep night base, very slightly hue-shifted toward the dominant so the whole
  // canvas reads as ONE color world (a blue project ⇒ a faintly blue night, a
  // magenta project ⇒ a faintly violet night) — but always near-black + legible.
  const bg = hslToHex(h, 36, 7); // deep, barely-tinted night
  const panel = hslToHex(h, 30, 13); // a lifted card surface
  const bgElevated = hslToHex(h, 32, 17); // a nested/elevated surface
  const fg = hslToHex(h, 28, 95); // near-white ink with a faint warm/cool cast
  const muted = hslToHex(h, 20, 66); // legible muted text
  const line = withAlpha(accent, 0.42); // hairline borders glow faintly in the accent

  const colors: CoreColors = {
    bg,
    bgElevated,
    panel,
    fg,
    muted,
    accent,
    signal,
    line,
    // Neon-tuned semantic series (lifted versions of the print hues, so a chart
    // or compare reads as bright on the dark base instead of dim print colors).
    red: "#FF6B5E",
    blue: "#5B8CFF",
    yellow: "#FFD24A",
    green: "#4BE39B",
    violet: "#B388FF",
  };

  return {
    colors,
    surface: {
      borderWidth: 1,
      borderColor: line, // hairline, faintly glowing accent line
      panelFill: withAlpha(panel, 0.72), // glassy translucent card over the night
      panelFillElevated: withAlpha(bgElevated, 0.82),
      shadowStyle: "glow", // neon glow + soft depth, not a hard print drop
      topRule: false, // accent is expressed via glow + tint, not a solid bar
      topRuleHeight: 0,
      chipStyle: "outline", // outlined translucent chips, not solid fills
      labelTracking: "0.06em", // softer tracking than editorial's 0.14em
      labelUppercase: false, // natural case — calmer, more premium
    },
    radius: { sm: 14, md: 22, lg: 34 }, // ROUNDED everything
    backdrop: {
      fill: "radial", // deep radial night wash
      grid: false,
      registrationTicks: false,
      starfield: true, // the signature backdrop
      frameBorder: true, // a soft rounded hairline frame
    },
    captionScrim: { opacity: 0.36, blur: 8, radius: 18, tone: "dark" },
  };
}

const CONTRACT = `NGÔN NGỮ THIẾT KẾ "galaxy" (vũ trụ tối, cao cấp) — KHÁC HẲN editorial, KHÔNG phải editorial đổi màu:
- NỀN TỐI sâu (gần đen, hơi ngả theo màu dominant), chữ sáng gần trắng; tương phản cao (N18). Frame tự vẽ nền radial + STARFIELD (các vì sao) — đừng tự vẽ nền.
- BO TRÒN MỌI THỨ: dùng theme.radius.* cho mọi thẻ/chip/thanh/nút/ảnh (sm≈14, md≈22, lg≈34). TUYỆT ĐỐI không để góc vuông (radius 0) ở style này.
- VIỀN MẢNH (hairline ~1px) phát sáng nhẹ theo accent — KHÔNG viền mực 4px, KHÔNG bóng cứng lệch. Chiều sâu tạo bằng QUẦNG SÁNG NEON (glow) + bóng mềm khuếch tán.
- THẺ kính mờ (translucent) nổi trên nền đêm; nhấn thể hiện bằng GLOW + tint, KHÔNG dùng thanh nhấn đặc (top-rule) ở mép trên.
- NHÃN/EYEBROW: chip VIỀN (outline) mờ, KHÔNG nền đặc; chữ giữ HOA-thường tự nhiên (KHÔNG in hoa toàn bộ), giãn chữ nhẹ ~0.06em.
- MÀU ngữ nghĩa là bản NEON sáng (red/blue/yellow/green/violet) hợp nền tối; chỉ accent/signal theo dominant.
- Đọc MỌI quyết định hình ảnh qua useTheme(): theme.colors.* (màu), theme.radius.* (bo góc), theme.surface (nếu cần). KHÔNG hardcode màu/viền/bo góc/nền sáng.
- Phụ đề có tấm nền tối mờ (scrim) do hệ thống lo — bạn không cần xử lý.`;

export const galaxyLanguage: StyleLanguage = {
  id: "galaxy",
  name: "Galaxy",
  description:
    "Vũ trụ tối cao cấp: nền đêm radial + starfield, chữ sáng, bo tròn mọi khối, viền mảnh phát sáng, quầng neon thay bóng cứng, chip viền, nhãn thường, sans Việt-đủ (Be Vietnam Pro).",
  fonts: { display: "Be Vietnam Pro", body: "Be Vietnam Pro", mono: "Cascadia Mono" },
  derive: deriveGalaxy,
  preview: {
    dark: true,
    rounded: true,
    starfield: true,
    grid: false,
    registrationTicks: false,
    borderWidth: 1,
    density: "airy",
  },
  contract: CONTRACT,
};
