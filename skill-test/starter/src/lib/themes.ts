export type Theme = {
  name: string;
  bg: string;
  text: string;
  sub: string;
  accent: string;
  danger: string;
  cardBg: string;
  cardBorder: string;
  display: string;
  body: string;
  mono: string;
  captionText: string;
  captionActive: string;
  captionShadow: string;
  texture: "none" | "grid" | "scanline";
  radius: number;
  control: "pill" | "square";
  listStyle: "check" | "numbered";
  cardTopRule: boolean;
};

const MONO = "'IBM Plex Mono', monospace";
const BVP = "'Be Vietnam Pro', sans-serif";

export const THEMES: Record<string, Theme> = {
  default: {
    name: "default",
    bg: "#0B0E14",
    text: "#F4F7FB",
    sub: "#8B94A6",
    accent: "#60A5FA",
    danger: "#F87171",
    cardBg: "#121722",
    cardBorder: "#60A5FA",
    display: BVP,
    body: BVP,
    mono: MONO,
    captionText: "rgba(255,255,255,0.55)",
    captionActive: "#FFFFFF",
    captionShadow: "0 2px 12px rgba(0,0,0,0.85)",
    texture: "none",
    radius: 32,
    control: "pill",
    listStyle: "check",
    cardTopRule: false,
  },
  "bao-giay": {
    name: "bao-giay",
    bg: "#F6F1E7",
    text: "#17140E",
    sub: "#6B6459",
    accent: "#D6452C",
    danger: "#B3382B",
    cardBg: "#FFFDF7",
    cardBorder: "#17140E",
    display: "'Literata', serif",
    body: BVP,
    mono: MONO,
    captionText: "rgba(23,20,14,0.55)",
    captionActive: "#D6452C",
    captionShadow: "0 1px 0 rgba(246,241,231,0.9)",
    texture: "none",
    radius: 8,
    control: "square",
    listStyle: "numbered",
    cardTopRule: true,
  },
  "phong-lab": {
    name: "phong-lab",
    bg: "#0C0F0E",
    text: "#E8F0E9",
    sub: "#7C8A80",
    accent: "#46E08A",
    danger: "#FFC24B",
    cardBg: "#111613",
    cardBorder: "#2A352E",
    display: "'Archivo', sans-serif",
    body: BVP,
    mono: MONO,
    captionText: "rgba(232,240,233,0.5)",
    captionActive: "#46E08A",
    captionShadow: "0 2px 10px rgba(0,0,0,0.9)",
    texture: "grid",
    radius: 4,
    control: "pill",
    listStyle: "check",
    cardTopRule: false,
  },
};
