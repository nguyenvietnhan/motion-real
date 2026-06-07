/**
 * Deterministic Vietnamese number normalization for the TTS layer (hướng B).
 *
 * The problem: an authoring AI that hand-spells numbers in narration often gets
 * Vietnamese wrong — most visibly years, read English-style as digit pairs
 * ("2026" → "hai mươi hai sáu") instead of the natural cardinal
 * ("hai nghìn không trăm hai mươi sáu"). The fix: let the AI write DIGITS in
 * narration ("năm 2026", "920 triệu USD", "92%") and convert them to natural
 * Vietnamese words here, right before synthesis — so pronunciation no longer
 * depends on the AI spelling numbers correctly.
 *
 * This runs on the SPOKEN text only; display/captions keep the compact digits.
 * Pure + deterministic (no Date/random), so it never breaks the render cache.
 *
 * Scope (conservative on purpose): standalone integers (incl. "." / "," thousand
 * groups), decimals, and percentages. Numbers glued to letters (H100, B200,
 * GPT-4o, 5G) are left ALONE so model/brand names read naturally. Slash dates
 * are not restructured — guidance asks for "ngày 5 tháng 6 năm 2026" form, whose
 * bare numbers this then reads correctly.
 */

const UNITS = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"] as const;

/** Read 0..999. `withLeadingZero` forces "không trăm"/"lẻ" for non-leading groups. */
function readThreeDigits(n: number, withLeadingZero: boolean): string {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  const parts: string[] = [];

  if (h > 0) {
    parts.push(`${UNITS[h]} trăm`);
  } else if (withLeadingZero && (t > 0 || u > 0)) {
    parts.push("không trăm");
  }

  if (t > 1) {
    parts.push(`${UNITS[t]} mươi`);
    if (u === 1) parts.push("mốt");
    else if (u === 5) parts.push("lăm");
    else if (u > 0) parts.push(UNITS[u]!);
  } else if (t === 1) {
    parts.push("mười");
    if (u === 5) parts.push("lăm");
    else if (u > 0) parts.push(UNITS[u]!);
  } else if (u > 0) {
    // tens == 0
    if (h > 0 || withLeadingZero) parts.push("lẻ");
    parts.push(UNITS[u]!);
  }

  return parts.join(" ");
}

/**
 * Scale word for the g-th 3-digit group (group = 10^(3g)):
 * 0→"", 1→nghìn, 2→triệu, 3→tỷ, 4→nghìn tỷ, 5→triệu tỷ, 6→tỷ tỷ, …
 */
function scaleFor(g: number): string {
  const small = ["", "nghìn", "triệu"][g % 3]!;
  const ty = Array.from({ length: Math.floor(g / 3) }, () => "tỷ").join(" ");
  return [small, ty].filter(Boolean).join(" ");
}

/** Read a non-negative integer as natural Vietnamese words. */
export function readVietnameseInteger(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  let n = Math.trunc(Math.abs(value));
  if (n === 0) return "không";

  const groups: number[] = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }

  const top = groups.length - 1;
  const parts: string[] = [];
  for (let g = top; g >= 0; g -= 1) {
    const val = groups[g]!;
    if (val === 0) continue; // internal zero groups are covered by "không trăm"
    const chunk = readThreeDigits(val, g !== top);
    const scale = scaleFor(g);
    parts.push(scale ? `${chunk} ${scale}` : chunk);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Read one numeric token (integer / grouped-thousands / decimal) to words. */
function readNumberToken(token: string): string {
  if (/^\d+$/.test(token)) return readVietnameseInteger(Number(token));
  // Thousand-grouped integers ("110.000", "1,234,567").
  if (/^\d{1,3}(\.\d{3})+$/.test(token)) return readVietnameseInteger(Number(token.replace(/\./g, "")));
  if (/^\d{1,3}(,\d{3})+$/.test(token)) return readVietnameseInteger(Number(token.replace(/,/g, "")));
  // Decimal ("1,25", "1.5"): integer part as words, fractional part digit-by-digit.
  const dec = token.match(/^(\d+)[.,](\d+)$/);
  if (dec) {
    const intWords = readVietnameseInteger(Number(dec[1]));
    const fracWords = dec[2]!
      .split("")
      .map((d) => UNITS[Number(d)]!)
      .join(" ");
    return `${intWords} phẩy ${fracWords}`;
  }
  const digits = token.replace(/\D/g, "");
  return digits ? readVietnameseInteger(Number(digits)) : token;
}

/**
 * Convert standalone digit numbers + percentages in `text` to Vietnamese words.
 * Numbers fused to letters (model names like H100/GPT-4o) are left untouched.
 */
export function normalizeVietnameseNumbers(text: string): string {
  // Percentages first (consume the % sign): "92%" → "chín mươi hai phần trăm".
  let out = text.replace(/(?<![A-Za-z\d.,])(\d[\d.,]*\d|\d)\s*%/g, (_m, num: string) => `${readNumberToken(num)} phần trăm`);
  // Standalone numbers not glued to a letter (skip H100, 5G, 4o, …).
  out = out.replace(/(?<![A-Za-z\d.,])(\d[\d.,]*\d|\d)(?![A-Za-z%])/g, (_m, num: string) => readNumberToken(num));
  return out;
}
