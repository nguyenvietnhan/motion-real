/**
 * The "editorial" design language — the original look, refactored into the
 * self-contained `StyleLanguage` shape.
 *
 * Light editorial print: a warm CREAM paper base, near-black ink, bold SQUARED
 * borders (corner radius 0), a solid accent top-rule + hard-offset drop shadow on
 * floating blocks, vivid PRINT accents, uppercase mono labels, a faint ink grid +
 * corner registration ticks. Readable in dark / bright / glare. The base is fixed
 * and high-contrast; only the accent pair follows the project dominant.
 *
 * This is the default language (`isDefault`), so existing projects with no
 * stylePackId resolve here and render byte-identically to before the refactor.
 */

import {
  PRINT,
  clamp,
  hexToHsl,
  hslToHex,
  type CoreColors,
  type DerivedLanguage,
  type StyleLanguage,
} from "../core.js";

function deriveEditorial(dominant: string): DerivedLanguage {
  const [h, s] = hexToHsl(dominant);
  // Accent: vivid, dark enough to carry paper-colored text on a solid chip and to
  // read against the cream base. Companion: a strong split-complement.
  const accent = hslToHex(h, clamp(Math.max(s, 70), 55, 95), 50);
  const signal = hslToHex((h + 150) % 360, clamp(Math.max(s, 60), 55, 92), 47);

  const colors: CoreColors = {
    bg: PRINT.paper, // warm cream
    bgElevated: "#EAE2CE", // a touch deeper cream
    panel: "#FCF9F1", // near-white card
    fg: PRINT.ink, // near-black ink
    muted: "#6E6757", // warm grey
    accent,
    signal,
    line: PRINT.ink, // bold ink borders
    // PRINT semantic set (fixed, deterministic).
    red: PRINT.red,
    blue: PRINT.blue,
    yellow: PRINT.yellow,
    green: PRINT.green,
    violet: PRINT.violet,
  };

  return {
    colors,
    surface: {
      borderWidth: 4,
      borderColor: PRINT.ink, // bold ink border on every block
      panelFill: colors.panel,
      panelFillElevated: colors.bgElevated,
      shadowStyle: "hard-offset", // the editorial print drop
      topRule: true, // solid accent bar across the block top
      topRuleHeight: 12,
      chipStyle: "solid", // solid accent eyebrow chips
      labelTracking: "0.14em",
      labelUppercase: true,
    },
    radius: { sm: 0, md: 0, lg: 0 }, // SQUARED — never round a card/chip/bar
    backdrop: {
      fill: "flat", // flat cream base
      grid: true, // faint ink grid
      registrationTicks: true, // corner ticks
      starfield: false,
      frameBorder: true, // bold outer border
      divider: true, // editorial draws the ink baseline under content
    },
    // No caption scrim — the classic look draws the caption on the cream base.
  };
}

const CONTRACT = `NGÔN NGỮ THIẾT KẾ "editorial" (bản tin in ấn sáng):
- NỀN kem sáng (#F2ECDC), mực gần đen; chữ tương phản rất cao (N18). KHÔNG nền tối.
- HÌNH KHỐI VUÔNG: bo góc 0 — KHÔNG bao giờ bo tròn thẻ/chip/thanh/nút. Mỗi khối là một đơn vị có VIỀN MỰC 4px rõ, thường kèm thanh nhấn (top-rule) đặc ở mép trên và đổ bóng cứng lệch (vd "12px 12px 0 accent").
- NHÃN/EYEBROW: chip nền nhấn ĐẶC, chữ mono IN HOA, giãn chữ ~0.14em.
- CHỮ: display nặng (800–900), tracking chặt, lớn. Mono cho nhãn/đơn vị/số-liệu/footer.
- MÀU: nền cố định; chỉ accent/signal theo dominant. Bộ màu ngữ nghĩa cố định (red/blue/yellow/green/violet) cho so sánh/biểu đồ/cảnh báo.
- Đọc MỌI quyết định hình ảnh qua useTheme(): theme.colors.* (màu), theme.radius.* (bo góc — ở style này = 0). KHÔNG hardcode màu/đường viền/bo góc.
- BACKDROP: nền phẳng + lưới mực mờ + tick góc do Frame tự vẽ. Đừng tự vẽ nền.`;

export const editorialLanguage: StyleLanguage = {
  id: "bold-editorial",
  name: "Bold Editorial",
  description:
    "Bản tin in ấn sáng: nền kem, mực gần đen, viền vuông đậm, thanh nhấn + bóng cứng, nhãn mono in hoa, lưới + tick góc. Đậm, tương phản cao, đọc tốt mọi điều kiện sáng.",
  isDefault: true,
  fonts: { display: "Inter", body: "Inter", mono: "Cascadia Mono" },
  derive: deriveEditorial,
  preview: {
    dark: false,
    rounded: false,
    starfield: false,
    grid: true,
    registrationTicks: true,
    borderWidth: 4,
    density: "editorial",
  },
  contract: CONTRACT,
};
