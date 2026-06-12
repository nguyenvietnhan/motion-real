import type { VideoSpec } from "@news/schema";
import type { SafetyIssue } from "../types.js";

/**
 * Tier-1 content lint (N6–N9, plus hook/CTA/media rules). Ported and adapted
 * from news_video_tool's schema validators. These are renderer-independent
 * Vietnamese/TTS/evidence rules that protect on-screen and spoken text quality.
 */

function normalizeVietnameseText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s?]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Display + narration text fields per scene, for field-scoped checks. */
function sceneTextFields(scene: VideoSpec["scenes"][number]): Array<{ name: string; value: string }> {
  return [
    { name: "headline", value: scene.headline },
    { name: "eyebrow", value: scene.eyebrow ?? "" },
    { name: "body", value: scene.body ?? "" },
    { name: "narration", value: scene.narration },
    { name: "props", value: JSON.stringify(scene.props ?? {}) },
  ];
}

function displayFields(scene: VideoSpec["scenes"][number]): Array<{ name: string; value: string }> {
  return [
    { name: "headline", value: scene.headline },
    { name: "eyebrow", value: scene.eyebrow ?? "" },
    { name: "body", value: scene.body ?? "" },
    { name: "props", value: JSON.stringify(scene.props ?? {}) },
  ];
}

// --- N6: phonetic spellings / spaced abbreviations in display or narration ---

const PHONETIC_PATTERNS: Array<[RegExp, string]> = [
  [/Ô[- ]?pân/i, "OpenAI"],
  [/Gút[- ]?gồ/i, "Google"],
  [/Đíp[- ]?xích/i, "DeepSeek"],
  [/Giê[- ]?mi[- ]?nai/i, "Gemini"],
  [/Cờ[- ]?lót/i, "Claude"],
  [/An[- ]?thờ[- ]?rô[- ]?pích/i, "Anthropic"],
  [/Chát\s*Gi\s*Pi\s*Ti/i, "ChatGPT"],
  [/Diu[- ]?túp/i, "YouTube"],
  [/Eo[- ]?eo[- ]?em/i, "LLM"],
];

const SPACED_ABBREV_PATTERNS: Array<[RegExp, string]> = [
  [/\bA[\s.\-]+I\b/, "AI"],
  [/\bA[\s.\-]+P[\s.\-]+I\b/, "API"],
  [/\bG[\s.\-]+P[\s.\-]+T\b/, "GPT"],
  [/\bL[\s.\-]+L[\s.\-]+M\b/, "LLM"],
];

// --- N8: narration may use DIGITS (the TTS layer reads them as natural
//        Vietnamese, hướng B); only flag forms the reader can't voice well.
//        Display must still keep numbers compact.

// Forms the Vietnamese number normalizer does NOT expand, so they'd be
// mispronounced if left in narration: currency symbols and English magnitude
// suffixes glued to a number. Plain digits, years, and "%" are fine now.
const NARRATION_NUMERIC_PATTERNS: RegExp[] = [
  /[$€¥₫]\s?\d/,
  /\b\d+(?:[.,]\d+)?[KMBT]\b/,
];

const DISPLAY_SPOKEN_NUMBER_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:mot|hai)\s+nghin(?:\s+khong\s+tram)?\b/, "spoken-out year"],
  [
    /\b(?:khong|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi|tram|nghin|trieu|ty|phay)(?:\s+(?:khong|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi|tram|nghin|trieu|ty|phay)){1,8}\s+phan\s+tram\b/,
    "spoken-out percentage",
  ],
];

// --- N9: evidence gate / generic CTA / weak hook ---

function badOpeningReason(value: string): string | null {
  const normalized = normalizeVietnameseText(value);
  const patterns: Array<[RegExp, string]> = [
    [/^(xin chao|hello|hi|chao mung|chao cac ban|helo)\b/, "do not greet the audience"],
    [/^(hom nay|trong video nay|chung ta se|toi se|cung minh|trong clip nay)\b/, "do not announce the video format"],
    [/^(tim hieu|cung tim hieu|hay cung|kham pha|gioi thieu|tong quan ve)\b/, "do not open with a generic explainer frame"],
    [/^(ban co biet|co bao gio ban|ban da tung|lieu ban co|ban co muon)\b/, "avoid generic opening questions"],
    [/^(.{0,40}\s)?la gi\??$/, "do not open with a definition"],
  ];
  return patterns.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

function genericCtaReason(scene: VideoSpec["scenes"][number]): string | null {
  const values = [scene.headline, scene.body ?? "", scene.narration, JSON.stringify(scene.props ?? {})];
  const joined = values.map(normalizeVietnameseText).filter(Boolean).join(" ");
  if (/\b(dang ky|subscribe|like|theo doi kenh|theo doi)\b/.test(joined)) {
    return "avoid subscribe/follow/like calls";
  }
  if (/\b(binh luan|comment)\b/.test(joined) || /\bde lai\s+(?:y kien|binh luan|comment)\b/.test(joined)) {
    return "avoid generic comment prompts";
  }
  if (/\bchia se\b/.test(joined)) {
    return "avoid generic 'chia sẻ' engagement-bait";
  }
  if (/\b(ben duoi|phia duoi)\b/.test(joined)) {
    return "avoid 'bên dưới' comment/share bait";
  }
  if (/\bban nghi sao\b/.test(joined) || /\bban thay sao\b/.test(joined)) {
    return "avoid vague 'Bạn nghĩ sao?' closers";
  }
  return null;
}

/** Run all content rules across the spec. */
export function runContentRules(spec: VideoSpec): SafetyIssue[] {
  const issues: SafetyIssue[] = [];

  for (const scene of spec.scenes) {
    // N6: phonetic spellings (hard) in any field
    for (const field of sceneTextFields(scene)) {
      for (const [pattern, original] of PHONETIC_PATTERNS) {
        const matched = field.value.match(pattern)?.[0];
        if (matched) {
          issues.push({
            check: "N6",
            severity: "error",
            sceneId: scene.id,
            path: field.name,
            message: `${scene.id} ${field.name} contains phonetic spelling "${matched}"; use original English "${original}".`,
          });
        }
      }
      // N7 (folded into N6 tier): spaced abbreviations (hard)
      for (const [pattern, original] of SPACED_ABBREV_PATTERNS) {
        const matched = field.value.match(pattern)?.[0];
        if (matched) {
          issues.push({
            check: "N7",
            severity: "error",
            sceneId: scene.id,
            path: field.name,
            message: `${scene.id} ${field.name} contains spaced abbreviation "${matched.trim()}"; write "${original}".`,
          });
        }
      }
    }

    // N8a: narration with un-voiceable number forms (warning). Plain digits,
    // years, and "%" are fine (the TTS layer reads them); only currency symbols
    // and English magnitude suffixes (1.5M) need spelling out as Vietnamese.
    for (const pattern of NARRATION_NUMERIC_PATTERNS) {
      const matched = scene.narration.match(pattern)?.[0];
      if (matched) {
        issues.push({
          check: "N8",
          severity: "warning",
          sceneId: scene.id,
          path: "narration",
          message: `${scene.id} narration has "${matched}" which the TTS reader can't voice; write the unit in Vietnamese (e.g. "triệu", "tỷ", "đô la") and keep the digits.`,
        });
        break;
      }
    }

    // N8b: display fields with spoken-out numbers (warning)
    for (const field of displayFields(scene)) {
      const normalized = normalizeVietnameseText(field.value);
      for (const [pattern, kind] of DISPLAY_SPOKEN_NUMBER_PATTERNS) {
        if (pattern.test(normalized)) {
          issues.push({
            check: "N8",
            severity: "warning",
            sceneId: scene.id,
            path: field.name,
            message: `${scene.id} ${field.name} contains ${kind}; keep display numbers compact (e.g. "2026", "92%").`,
          });
          break;
        }
      }
    }

    // N9: remote-media ban (hard). The tool now allows ≤1 LOCAL image per scene
    // via the first-class `image` field, but NEVER a remote image at render time
    // — a network-fetched `<Img>` would break the offline + determinism (N16)
    // invariant and can't be contained. So N9 bans remote refs, not all media.
    //  (a) the structured `image.ref` must be a local path (the schema refinement
    //      already enforces this; re-checked here as defense-in-depth so a spec
    //      built bypassing schema parse can't smuggle a remote ref past the grid);
    //  (b) any remote image URL hidden in free-form `props` (e.g. an authored
    //      component reading `props.bg` and rendering it) is banned too.
    const imageRef = scene.image?.ref;
    if (imageRef && /^[a-z][a-z0-9+.-]*:/i.test(imageRef)) {
      issues.push({
        check: "N9",
        severity: "error",
        sceneId: scene.id,
        path: "image.ref",
        message: `${scene.id} image.ref "${imageRef}" is a URL/remote scheme; remote media is banned at render time. Use a LOCAL project-relative asset path (e.g. "assets/<name>.png").`,
      });
    }
    const propText = JSON.stringify(scene.props ?? {});
    const remoteInProps = propText.match(/https?:\/\/[^"'\s]+\.(?:png|jpe?g|webp|gif)/i)?.[0];
    if (remoteInProps) {
      issues.push({
        check: "N9",
        severity: "error",
        sceneId: scene.id,
        path: "props",
        message: `${scene.id} props reference a remote image URL ("${remoteInProps}"); remote media is banned at render time. Download it to a local asset and use the scene's image field instead.`,
      });
    }
  }

  // N9: weak hook (warning) on scene-01
  const first = spec.scenes[0];
  if (first) {
    const reason = badOpeningReason(first.headline) ?? badOpeningReason(first.narration);
    if (reason) {
      issues.push({
        check: "N26",
        severity: "warning",
        sceneId: first.id,
        path: "narration",
        message: `${first.id} opening hook is weak: ${reason}. Start with a warning, paradox, or surprising consequence.`,
      });
    }
  }

  // N27: generic CTA (warning) on final scene
  const last = spec.scenes.at(-1);
  if (last) {
    const reason = genericCtaReason(last);
    if (reason) {
      issues.push({
        check: "N27",
        severity: "warning",
        sceneId: last.id,
        path: "narration",
        message: `${last.id} final CTA is generic: ${reason}. End with a topic-specific decision/tradeoff question.`,
      });
    }
  }

  return issues;
}
