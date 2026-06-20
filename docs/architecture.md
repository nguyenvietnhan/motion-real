# Architecture — news_remotion_tool (current state)

Tài liệu này mô tả **hiện trạng** kiến trúc, không phải target. Cập nhật khi cấu
trúc thay đổi thực sự.

## 1. Monorepo (npm workspaces)

Không dùng pnpm/turbo. Hai vùng: `packages/` (logic) + `apps/` (entry points).

| Package | Vai trò |
| --- | --- |
| `@news/schema` | `VideoSpec`/`LockedVideoSpec` renderer-agnostic, timing consts, `geometry(format)` (`tiktok` 1080×1920, `youtube` 1920×1080), layout zones, duration tiers, `CaptionCue`, free-pacing validation |
| `@news/theme` | Một theme TRUNG TÍNH duy nhất (sau pivot freeform, thay `@news/design` đa-ngôn-ngữ đã xoá): `theme.ts` giữ shape `Theme` + phòng thủ 2 lớp cross-model (typed aliases + Proxy fallback) để runtime render + `SceneImage` resolve `useTheme()` nội bộ; KHÔNG nằm trong whitelist authored — cảnh authored hardcode mọi visual trong code |
| `@news/blocks` | Runtime nội bộ của lớp render do `@news/compositions` tiêu thụ (KHÔNG phải authored-facing): Captions, layout-probe, scene-timing, motion, theme-context, chrome surface-kit, fonts — cộng `SceneImage` là authored-facing survivor duy nhất, re-export qua `@news/compositions`. Các layout block slot-based (Frame/TitleBlock/KeyPoints/Panel/Story/…) đã bị XOÁ |
| `@news/compositions` | Registry + master `VideoComposition` (TransitionSeries + TikTok caption overlay; caption/divider omitted for `format:"youtube"`), `ThumbnailComposition`; KHÔNG có template built-in |
| `@news/tts` | Vivibe/LucyLab + ElevenLabs clients, audio measure/concat-with-gaps/mix, SRT/timestamp capture |
| `@news/pipeline` | authoring/admission, manifest, ingest, tts, captions, lock, BGM handoff, no-TTS stills, thumbnail render, sfx, store, cache, determinism, renderer, review, orchestrator, cli, safety grid |
| `@news/mcp` | MCP server phơi pipeline thành typed tools |
| `apps/remotion` | Remotion root (`Root.tsx`), một composition `NewsVideo`, studio/render entry |
| `apps/desktop` | Electron app (create/workspace/settings UI, format/tier/video-language/provider pickers, hidden stills/vision refine loop, BGM + thumbnail UI, 9router gateway, license, self-repair loop) wrap pipeline |

**Format status:** TikTok 9:16 is the stable end-to-end production path. The repo
already carries YouTube-format primitives (schema geometry, prompt budgeting,
caption-off composition behavior, thumbnail canvas), but long-form
author-by-segment and the true 16:9 main-video render path are still Group J
work in `docs/specs/freeform-engine/tasks.md`.

## 2. Data flow (topic → MP4)

```
Topic/URL
  -> AI authors scenes .tsx + manifest.json (desktop: qua 9router gateway)
  -> desktop hidden stills refine (optional): renderStills no-TTS -> creative bootstrap -> vision QA pass(es)
  -> admission gate (N4/N5 AST)          [authoring/admission.ts]
  -> manifest -> VideoSpec               [loadManifestAsSpec]
  -> static grid (N1-N9)                 [safety/*, runStaticGrid]
  -> typecheck authored (N10)            [safety/typecheck-authored.ts]
  -> configured TTS (Vivibe/ElevenLabs; breath gaps + timing) [@news/tts]
  -> lockSpec (transition-aware, caption cues) -> LockedVideoSpec
  -> build grid (N11-N13)                [safety/build-grid.ts]
  -> determinism guard (N16)             [render/determinism.ts]
  -> Remotion render (headless Chromium) [render/renderer.ts]
  -> review stills -> render oracles (N14, N15, N17, N18-N22, N28-N30)  [safety/render-grid.ts]
  -> review loop (N24-N25) -> done
```

Toàn bộ chạy trong **một process** import `@news/pipeline` từ source (một registry
instance duy nhất). Xem [adr/004-single-process-orchestration.md](adr/004-single-process-orchestration.md).

## 3. AI authoring — runtime vs dev-tool

Hai loại "AI" KHÔNG nhầm lẫn:

- **Runtime AI** (sinh cảnh/refine): desktop gửi prompt qua **9router** (HTTP gateway
  OpenAI-compatible trên `localhost:20128`) tới model user chọn (Claude/Gemini/
  Codex/...). Model chỉ nhận `messages[]`, trả **một string**. Nó KHÔNG thấy MCP,
  KHÔNG thấy CLAUDE.md/AGENTS.md. Prompt thực tế là hằng `AUTHORING_CONTRACT`
  inline trong [apps/desktop/src/main/authoring/contract-text.ts](../apps/desktop/src/main/authoring/contract-text.ts),
  ghép bởi [prompt.ts](../apps/desktop/src/main/authoring/prompt.ts).
- **Dev-tool AI** (Claude Code, Codex CLI, Cursor — giúp code): đọc CLAUDE.md +
  docs. KHÔNG liên quan luồng render runtime.

Luồng research/ảnh hôm nay do **code Node** làm, không phải runtime AI:
`ingest_url` đọc URL, `crawlArticleImages` cào ảnh, rồi nhét vào prompt. Model chỉ
đọc và trả manifest + tsx.

## 4. Safety grid (N1–N30) — phân tán theo tier

Không có một file "oracle" tập trung. Mỗi check sống ở tier của nó:

- **Tier 1 static lint (pre-TTS)**: N1 structure, N2 unknown component, N3 Zod
  props, N4 import whitelist, N5 forbidden API, N6/N7 phonetics, N8 number rules,
  N9 evidence-gate/media bans, N26 hook, N27 CTA. → `authoring/admission.ts`,
  `safety/forbidden-api.ts`, `safety/*`. Current hard blockers: N4/N5, N2, N9,
  duplicate scene id, empty spec. N3, N6/N7, N8, N26, N27 are warnings.
- **Tier 2 build/type (pre-render)**: N10 typecheck (hard for crash /
  SceneFallback-prone diagnostics; warning only for known runtime-safe slips),
  N11 bundle, N12 locked timing, N13 scene audio. → `safety/build-grid.ts`,
  `safety/typecheck-authored.ts`.
- **Tier 3 render oracles (post-render, auto-run)**: N14 content-zone/caption
  clearance / in-frame family (warning), N16 determinism (hard), N18 contrast,
  N19 dead-air, N20 pacing, N21 transition/flicker, N22 audio-sync, N28 duration,
  N29 captions, N30 density. Trên measure pass: N15 overlap, N17 truncation
  (warnings). → `safety/render-grid.ts`, `safety/frame-stats.ts`,
  `render/determinism.ts`.
- **Tier 4 review (pre-done)**: N24 keyframes/contact sheet, N25 self-critique.

Mỗi check có **non-vacuous self-test** (fixture known-bad chứng minh nó fire).

## 5. State / persistence (JSON files, không SQLite)

- `VIDEO_TOOL_HOME/.video-tool/projects/<id>/brief.json` — state machine
  (`scaffolded` → `ts` → `locking` → `rendering` → `reviewing` → `done`/`failed`).
- `video-spec.json`, `video-spec.lock.json`, `manifest.json`, `safety-report.json`,
  `ts-manifest.json`, `events.ndjson` (append-only).
- Write luôn atomic: serialize → temp → `rename()`.

## 6. God-file map (nợ kỹ thuật)

| File | LoC (2026-06-16) | Trạng thái |
| --- | --- | --- |
| `apps/desktop/.../workspace-controller.ts` | 1159 | State machine ngầm |
| `safety/render-grid.ts` | 1035 | Tier-3 oracles, fragile với layout/resolution |
| `apps/desktop/.../authoring/ninerouter-backend.ts` | 755 | Vùng commit-churn cao nhất (pilot target) |
| `orchestrator.ts` | 627 | God-function, off-limits per user |
| `cli/cli.ts` | 606 | CLI verbs |

Chi tiết + library candidate: [refactor-backlog.md](refactor-backlog.md).

## 7. Tests

Vitest. ~20+ test files. Admission gate có 9 fixtures + 11 case (RCE/computed-key/
host-RCE/media). Determinism, review, orchestrator, characterization-baseline đều
có test. Chạy: `npx tsx scripts/test.ts` (KHÔNG bare `tsc`).
