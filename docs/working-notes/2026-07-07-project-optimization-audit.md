# MotionReal Project Optimization Plan - 2026-07-07

## Muc Dich

File nay thay cho audit note tam thoi truoc do. Muc tieu la bien cac diem da
quet duoc thanh mot plan toi uu hoa co the thuc thi theo tung phase nho, co dau
ra mong muon, co dieu kien chap nhan, va co lenh kiem chung rieng.

Trang thai hien tai cua du an: hoat dong on dinh hon sau checkpoint
`af68f52 Stabilize authoring reliability and audit optimization`. Tuy nhien,
"on dinh hien tai" khong dong nghia la "da toi uu". Vung nhay cam nhat la
prompt/authoring, vi no dieu khien story, narration, manifest va TSX code do AI
sinh ra. Mot thay doi nho trong prompt co the lam thay doi scene count, reply
size, parseability, admission errors, batching behavior, va chat luong video.

Plan nay khong them feature moi. Day la plan giam no ky thuat, giam nhieu,
giam drift, va lam prompt/codegen de kiem soat hon truoc khi tiep tuc SFX,
speech-sync, YouTube long-form, hay render parallelism.

## Nguyen Tac

1. Doc `AI_CONTRACT.md` truoc moi lan bat dau.
2. Prompt la production surface, khong phai copywriting tuy y.
3. Hard safety gates khong duoc yeu di: import/API cam, host access, remote/file
   media, invalid TSX, build/runtime crash, determinism, invalid timing/audio,
   duplicate scene ids, empty specs, va admission/range blockers.
4. Chat luong visual van quan trong. Khong xoa "bold first draft" mot cach mu
   quang; hay tach no khoi hard output contract de giam fragility.
5. Moi prompt change phai co metric ky vong: parse fail giam, normalization count
   giam, missing TSX giam, N5/N10 giam, reply size giam, provider truncation giam,
   hoac log/debug de hon.
6. Khong them broad retry de che prompt/pipeline debt.
7. Refactor file nhay cam theo hanh vi va test, khong theo line count.
8. Moi policy change rong phai co rollback path ro: revert commit hoac internal
   flag neu can.
9. Feature moi dung lai cho den khi plan prompt/cleanup nay co checkpoint ro.

## Evidence Map

Re-check line numbers truoc khi sua code.

| Id | Evidence | Tai sao quan trong |
| --- | --- | --- |
| E1 | `AI_CONTRACT.md:57-58`, `101-102` | Safety grid la contract; repeated AI defects nen thanh schema/normalizer/admission/oracle voi tests, khong chi them prompt rules. |
| E2 | `apps/desktop/src/main/authoring/prompt.ts:117` | Prompt dang ep "TAO BAO NGAY TU BAN DAU" voi visual must-haves. Tot cho chat luong, nhung la fragility lever. |
| E3 | `apps/desktop/src/main/authoring/prompt.ts:183` | Main author system prompt dat muc tieu "THAT LOA MAT, CUON HUT"; creative pressure dang nam cung hard contract. |
| E4 | `apps/desktop/src/main/authoring/prompt.test.ts:477-501` | Test dang bao ve bold-first behavior vi prompt yeu truoc day sinh canh nhat. Khong duoc xoa yeu cau nay tuy tien. |
| E5 | `apps/desktop/src/main/authoring/contract-text.ts:58-65` | Motion guidance da an toan hon, nhung van la mot contract dai nhung vao nhieu prompt. |
| E6 | `apps/desktop/src/main/authoring/contract-text.ts:2-6`; `docs/current/authoring-contract.md` | Runtime prompt contract la ban condensed copy cua durable doc, co nguy co drift. |
| E7 | `apps/desktop/src/main/authoring/prompt.ts:96`, `181`, `224`, `313`, `364`, `524`, `558` | `prompt.ts` gom nhieu policy: content, author, batch, recovery, QA, image filter. |
| E8 | `apps/desktop/src/main/authoring/content-plan.ts:40`, `420`, `498` | Content-plan schema/validation/normalization/prompt generation dang nam chung file. |
| E9 | `apps/desktop/src/main/authoring/content-plan-runner.ts:54`, `123`; `author-reply-runner.ts:94`, `154`, `261`; `reauthor-runner.ts:130` | Raw AI replies duoc log 2000 chars khi parse fail; huu ich debug nhung nhay cam/noisy. |
| E10 | `apps/desktop/src/main/authoring/reply-parser.ts`; `manifest-schema.ts`; `content-plan.ts:310-345`; `normalize-imports.ts` | Recovery/normalization bang string la hotspot; them regex de tang edge cases. |
| E11 | `apps/remotion/src/Root.tsx:18`; `packages/pipeline/src/authoring/authored-entry.ts:55` | `NewsVideo` alias con ton tai ben canh `MotionRealVideo`; can co ly do/sunset de giam noise. |
| E12 | `apps/desktop/src/main/index.ts:79`; `scripts/calibrate-voice.ts:74` | `news-studio-settings.json` legacy settings con duoc doc cho compat. |
| E13 | `packages/schema/src/index.ts:117`; `packages/pipeline/src/audio/sfx.ts`; `packages/pipeline/src/index.ts:33` | SFX visible trong schema/export nhung chua phai feature hoan chinh. |
| E14 | `apps/desktop/src/shared/settings-model.ts:133-134`; `workspace-create-flow.ts:95`, `111` | Image crawl/filter/review defaults co the tao them provider/vision cost trong stable path. |
| E15 | Largest files: `workspace-controller.ts` ~57 KB, `render-grid.ts` ~48 KB, `orchestrator.ts` ~47 KB, `prompt.ts` ~40 KB, `ninerouter-backend.ts` ~35 KB, `content-plan.ts` ~25 KB | File nhay cam lon lam audit/merge/refactor kho hon. |
| E16 | `docs/current/maintenance.md:65-76`; `composition-prep.ts:135-143`; `project-lock.ts:7` | Render/cache hien thien ve single workflow, chua thiet ke cho cross-project parallelism. |
| E17 | `packages/pipeline/src/store/store.ts:457-459` | Cache prune theo tuoi file, khong phai true LRU. |
| E18 | `packages/pipeline/src/types.ts:22`; `packages/pipeline/src/cli/cli.ts:122`, `558`; `AI_CONTRACT.md:50-51` | `mock`/`none` hop le cho dev/CLI nhung khong duoc thanh fallback am tham trong production. |
| E19 | `apps/desktop/src/main/authoring/ninerouter-backend.ts:91-94`, `713-717`; `docs/current/maintenance.md:113-115` | Authoring capacity hien tai la single path den 12 component, batch size 2, cap 16 component; 10-12/13-16 khong phai magic number. |
| E20 | `apps/desktop/src/main/authoring/pacing-policy.ts:25`; `pacing-policy.test.ts:5-12`; `prompt.test.ts:439-447` | 90s TikTok anchor la 10-12 scenes, nen normal single path phai phu hop scene-count guidance. |
| E21 | `package.json:scripts`; current environment `V:\MotionReal` PowerShell | Plan dung `npm.cmd` cho local Windows lane; npm scripts ben trong van la workspace scripts co the chay bang `npm` tren POSIX neu can. |
| E22 | `AI_CONTRACT.md:10`; `packages/schema/src/index.ts:179-184`; `docs/current/content-guide.md:11`, `56-58`; `apps/desktop/src/main/authoring/prompt.ts:57-69`, `102-109` | Vietnamese and English are real product axes, not edge cases; canary coverage must include both. |
| E23 | Extension of E7/E15: `apps/desktop/src/main/authoring/prompt.ts` is both dense and roughly 40 KB today | Prompt size/density is a real optimization target, not only a growth-control concern; do not add another broad prompt section without removing or extracting lower-value wording. |

## External Review Verification - 2026-07-07

An external AI review was treated as a signal to verify, not as default truth.
After checking the repo, the following points were accepted into this plan:

- Ownership needed clearer wording. The repo already uses owner-approved slices
  in durable docs, but this plan now defines who approves which kind of step.
- Rough effort bands were missing. They are added as planning estimates, not
  commitments.
- Thresholds for prompt size and metadata drift were too vague. They are now
  bounded by initial numeric rules and still require evidence before broadening
  normalizers.
- Scene thresholds needed evidence. They are now tied to E19/E20.
- Product-facing choices such as SFX visibility and image-crawl defaults are
  explicitly marked as owner/product decisions.
- Phase 3 prompt edits need a before/after canary set, not only a loose smoke
  run.
- Some work can run in parallel after Phase 0/1, but prompt-contract phases
  remain sequential.
- The plan now says `npm.cmd` is the Windows local lane and how to translate it
  for POSIX.
- Archive/delete criteria for this temporary note are more concrete.

The review request for SLA was not adopted as a hard rule because this checkout
does not show a ticket-based multi-owner process. Approval means explicit owner
approval in the chat or handoff before behavior/policy changes.

Second external review follow-up:

- The 30+ attempt drift threshold now says where data comes from: accumulated
  Phase 4 log counters plus provider smoke notes, not one small smoke run.
- Prompt-size controls now include an optimization target, not only growth
  prevention.
- Phase 3 canary coverage now requires at least one Vietnamese and one English
  request because VI/EN are supported product axes.
- Reviewer is now tied to concrete gates instead of being only a named role.
- Durable-doc closeout now includes threshold rationale and canary protocol so
  the reasoning does not disappear when this temporary note is archived.

Final external review follow-up:

- Accepted: Step 3.0 canary coverage was not wired tightly enough into Step
  3.1-3.5 verification. Phase 3 now requires relevant per-step canary subsets
  plus a full Phase 3 canary rerun before accepting prompt behavior changes.
- Accepted: the 30+ attempt drift window needed a reset/baseline rule. The
  window now starts at the recorded Phase 0.3/Step 3.0 baseline and resets after
  an accepted prompt-policy checkpoint or rollback.
- Accepted as clarification: E23 overlapped with E7/E15. It is now marked as an
  extension of those evidence points instead of a separate root cause.
- Accepted as operating caution: this working note is temporary and should not
  become a new durable source of truth. New broad sections should replace stale
  detail or be synced into `docs/current/*` before archive.

Current repo self-review after final follow-up:

- Latest committed checkpoint is still `af68f52 Stabilize authoring reliability
  and audit optimization`; this edit only changes this working note.
- The plan still reflects the real stability state: runtime code is not being
  changed here, but Phase 0.2 full local gate remains the first execution step
  before any runtime prompt/code behavior change.
- Referenced focused test paths were checked and exist in this checkout.
- Current size check: `prompt.ts` is about 40.9 KB and this temporary note is
  about 41.9 KB. That is acceptable for a handoff plan, but future updates
  should replace stale sections or move accepted policy into durable docs instead
  of appending more review history.

## Roles, Approval, Effort

Roles:

- Owner/product owner: the project owner/user. Approves product-facing choices,
  prompt-quality tradeoffs, feature-surface decisions, render parallelism, and
  any rollback.
- Engineering executor: Codex/agent/engineer implementing the approved step.
  May gather evidence, write docs/tests/code, and run verification within scope.
- Reviewer: owner or a fresh agent reading the plan. Checks that evidence,
  output, acceptance, and verification match before commit.

Approval model:

- Docs-only mapping/inventory may be done directly and reported.
- Runtime prompt/code behavior changes use: check evidence -> report -> owner
  approval -> implement -> verify -> owner approval -> commit.
- Product decisions in Phase 6 and Phase 8 require owner approval before code
  changes.

Reviewer gates:

- Required for Phase 1 hard/quality/advisory boundary before runtime prompt
  edits.
- Required for Phase 3 prompt behavior changes before commit.
- Required for Phase 8 render/cache design before implementation.
- Required for Phase 9 closeout before archiving/deleting this note.
- Optional for docs-only inventory steps; the executor may self-review and
  report if no behavior/policy change is made.

Effort bands are rough single-engineer estimates and must be recalibrated after
Phase 0 local gate:

- XS: less than half a day, docs/tests/localized edit.
- S: about half to one day, focused code/doc slice.
- M: one to two days, behavior-preserving refactor or prompt slice with tests.
- L: three to five days, provider smoke or cross-module cleanup.
- XL: more than one week; split before implementation.

Command environment:

- Verification commands are written for the current Windows/PowerShell local
  environment and use `npm.cmd`.
- On POSIX shells, use the same npm scripts with `npm` instead of `npm.cmd`
  unless a workspace script says otherwise.

## Priority

- P0: Khong thay blocker khan cap.
- P1: Prompt/codegen contract, prompt-doc drift, provider-validation discipline.
- P2: Raw AI logging, string recovery debt, reserved feature surfaces, legacy
  naming/comment noise, content-plan tolerance boundary.
- P3: UI inline style cleanup, YouTube deferred doc placement, cache LRU decision,
  render parallelism design.

## Dependency And Parallelization Notes

- Phase 0 is mandatory before any implementation.
- Phase 1 must happen before Phase 2 and Phase 3 because prompt boundaries must
  be known before splitting or rewriting prompt sections.
- Phase 2 should precede Phase 3 so prompt edits are made inside smaller modules
  with tests.
- Phase 4 can start after Phase 1, and can run beside Phase 3 if it does not
  touch the same files.
- Phase 5 and Phase 6 can run after Phase 0 if the owner wants parallel cleanup,
  but should not modify prompt behavior while Phase 3 is active.
- Phase 8 is design-only until owner approval; no render parallelism code before
  the design is accepted.

## Phase 0 - Baseline Checkpoint And Re-Entry

Goal: bao dam moi nguoi bat dau tu cung mot checkpoint, khong lam feature moi
tren mot workspace mo ho.

### Step 0.1 - Confirm Checkpoint

Scope:

- Git only.
- No source changes.

Output:

- Ghi nhan latest commit hash.
- Ghi nhan working tree co sach hay chi co plan note dang sua.

Acceptance:

- `git log -1 --oneline` hien checkpoint gan nhat.
- `git status --short` khong co dirty runtime code ngoai plan note neu dang
  thuc thi plan.

Verification:

```powershell
git log -1 --oneline
git status --short
git diff --check
```

### Step 0.2 - Local Gate Before Implementation

Scope:

- Verify checkpoint da commit, chua sua them behavior.

Output:

- Baseline gate result.
- Neu fail, classify fail la pre-existing, plan-change, env/provider, hay flaky.

Acceptance:

- Typecheck/test/build green truoc khi sua prompt/code.
- Neu test flaky, rerun focused file va ghi ro.

Verification:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
git diff --check
```

### Step 0.3 - Prompt/Authoring Metrics Baseline

Scope:

- Logs/fixtures/docs only.
- No runtime change.

Output:

- Bang baseline gom:
  - content-plan parse fail count;
  - `content-plan tolerant normalizations applied`;
  - `motion-defaulted`;
  - `author-reply parse failed`;
  - `authoring batch parse failed`;
  - `authoring will use compact TSX batches`;
  - `admission failed`, nhat la N5/N10;
  - response truncation/missing TSX class;
  - average/large prompt/reply size neu co log.

Acceptance:

- Co metric de biet prompt optimization co that su cai thien hay chi "nghe hay".
- Neu khong co log that, tao mot manual baseline note tu 3-5 provider smoke.

Verification:

```powershell
rg -n "content-plan parse failed|content-plan tolerant normalizations applied|author-reply parse failed|authoring batch parse failed|authoring will use compact TSX batches|admission failed" .
git diff --check
```

## Phase 1 - Prompt Contract Boundary

Goal: tach ro cai gi la hard contract phai pass render, cai gi la creative
quality guidance. Chua toi uu wording o phase nay.

### Step 1.1 - Map Prompt Sources

Scope:

- `apps/desktop/src/main/authoring/prompt.ts`
- `apps/desktop/src/main/authoring/contract-text.ts`
- `apps/desktop/src/main/authoring/content-plan.ts`
- `docs/current/authoring-contract.md`
- `docs/current/content-guide.md`
- `docs/current/maintenance.md`

Output:

- Mot table trong working note/durable doc phan loai:
  - hard output format;
  - import/security contract;
  - TSX module contract;
  - factual/story rules;
  - narration quality;
  - visual ambition;
  - motion recipes;
  - image rules;
  - batch/recovery rules;
  - visual QA/refine rules.

Acceptance:

- Biet chinh xac mot rule nam o runtime prompt, durable docs, tests, hay ca ba.
- Khong con noi chung "prompt dang dai" ma khong biet dai o phan nao.

Verification:

```powershell
npm.cmd test -- --run apps/desktop/src/main/authoring/prompt.test.ts apps/desktop/src/main/authoring/contract-text.test.ts
git diff --check
```

### Step 1.2 - Define Hard Contract Vs Quality Guidance

Scope:

- Docs/working note first.
- Runtime prompt only after owner approval.

Output:

- Danh sach "hard": output fences, manifest fields, component id matching,
  import whitelist, deterministic frame logic, SceneImage rule, example/schema,
  forbidden host APIs.
- Danh sach "quality": bold-first, bespoke SVG/CSS, layout variety, narration
  voice, motion richness.
- Danh sach "advisory": style/layout aesthetics that should not gate unless
  owner approves.

Acceptance:

- Hard contract co the test bang parser/admission/build.
- Quality guidance khong bi tron voi safety gate.
- Bold-first van duoc giu, nhung khong lam model nghi phai viet TSX phuc tap hon
  kha nang pass render.

Verification:

```powershell
git diff --check
```

### Step 1.3 - Add Prompt Change Checklist

Scope:

- `docs/current/maintenance.md`
- Tests only if docs assertions exist.

Output:

- Checklist ngan cho moi prompt change:
  - rule thuoc hard contract hay quality guidance?
  - metric nao ky vong cai thien?
  - focused tests nao can chay?
  - provider smoke nao can chay?
  - rollback path la gi?

Acceptance:

- Future prompt edits khong con la wording cleanup cam tinh.
- Checklist khong bien thanh bureaucratic gate dai dong; chi du de chan drift.

Verification:

```powershell
git diff --check
```

## Phase 2 - Prompt Module Split Without Behavior Change

Goal: giam rui ro khi toi uu prompt bang cach chia file/section truoc, nhung
giu output prompt gan nhu khong doi.

### Step 2.1 - Extract Prompt Sections

Scope:

- `apps/desktop/src/main/authoring/prompt.ts`
- New local prompt modules if needed, for example:
  - `prompt-content-rules.ts`
  - `prompt-output-format.ts`
  - `prompt-batch.ts`
  - `prompt-visual-qa.ts`
  - `prompt-image-filter.ts`

Output:

- `prompt.ts` thanh orchestrator nho hon.
- Moi module co mot responsibility ro.
- Khong doi wording co y nghia o phase nay.

Acceptance:

- Prompt tests pass without changing behavior assertions except import paths.
- Diff wording duoc review de dam bao day la structural refactor.

Verification:

```powershell
npm.cmd test -- --run apps/desktop/src/main/authoring/prompt.test.ts apps/desktop/src/main/authoring/ninerouter-backend.test.ts
npm.cmd run typecheck
git diff --check
```

### Step 2.2 - Lock Section Markers In Tests

Scope:

- `apps/desktop/src/main/authoring/prompt.test.ts`
- `apps/desktop/src/main/authoring/contract-text.test.ts`

Output:

- Tests kiem tra hard contract section xuat hien truoc creative guidance.
- Tests kiem tra batch/recovery prompt khong vo tinh nhan full context qua lon.
- Tests giu `Quick entrance + readable final hold` va bold-first requirement.

Acceptance:

- Neu sau nay ai them rule prompt moi sai cho, test se fail som.
- Tests khong lock tung cau qua muc gay kho sua wording.

Verification:

```powershell
npm.cmd test -- --run apps/desktop/src/main/authoring/prompt.test.ts apps/desktop/src/main/authoring/contract-text.test.ts
npm.cmd run typecheck
```

### Step 2.3 - Prompt Size Snapshot

Scope:

- `prompt.test.ts` or a small helper test.

Output:

- Approximate character/token budget snapshots for:
  - main author prompt;
  - TSX batch prompt;
  - missing-TSX recovery prompt;
  - reauthor prompt;
  - visual QA prompt.

Acceptance:

- Prompt size changes become visible.
- Snapshot co tolerance/threshold, khong brittle tung ky tu:
  - first implementation records current baseline only;
  - Phase 3 should aim to reduce main author, batch, or recovery prompt size by
    roughly 5-15% where duplicate/low-value wording can be removed without
    lowering quality; if no reduction is safe, record why;
  - later prompt-size growth above 10% in any section needs an inline reason in
    the test/doc diff;
  - growth above 20% in main author, batch, or recovery prompt needs owner
    approval and provider smoke before commit;
  - batch/recovery prompts should not grow above baseline unless the added text
    directly reduces a measured failure class.

Verification:

```powershell
npm.cmd test -- --run apps/desktop/src/main/authoring/prompt.test.ts
```

## Phase 3 - Prompt Fragility Reduction

Goal: toi uu prompt nhay cam nhat ma khong lam video nhat di.

### Step 3.0 - Fixed Before/After Canary Set

Scope:

- Test fixtures/docs only.
- Provider smoke protocol only; no runtime prompt change in this step.

Output:

- A fixed canary set of 5-7 prompts that cover:
  - RAG/news explainer with cited facts;
  - no-URL conceptual explainer;
  - numeric/evidence-heavy topic;
  - 90s TikTok tier 2/tier 3 duration;
  - optional image-assisted request if provider supports images;
  - at least one Vietnamese request and at least one English request.
- A before/after recording template:
  - content-plan parse result;
  - purpose/motion normalizations;
  - scene count and authoring path;
  - reply parse result;
  - admission result;
  - still/draft readiness;
  - subjective quality note: bland, acceptable, strong, or broken.

Acceptance:

- Phase 3 prompt edits are compared against the same input set, not just ad-hoc
  smoke attempts.
- A prompt change is not accepted if reliability improves only by making every
  output visibly bland or generic.
- Step 3.0 records the before baseline. Each runtime prompt-change step in
  3.1-3.5 must run a relevant 2-3 prompt subset against that baseline before
  the step is accepted. After Step 3.5, run the full 5-7 prompt set once before
  Phase 3 is marked done.
- If provider cost/access blocks per-step canaries, record the exception and
  keep Phase 3 in partial status until the full canary set is run.

Verification:

```powershell
git diff --check
```

### Step 3.1 - Put Render-Pass Contract Before Ambition

Scope:

- Prompt modules from Phase 2.
- `prompt.test.ts`.

Output:

- System prompt order ro:
  1. role and target format;
  2. hard output/render contract;
  3. factual/content rules;
  4. creative ambition/quality guidance;
  5. examples.

Acceptance:

- Model doc prompt thay "pass and render" truoc "dazzle".
- Bold-first van ton tai, nhung nam trong quality section.
- Output format rules khong bi chen sau visual ambition.

Verification:

- Canary: run the Step 3.0 subset that covers main author prompt ordering and
  compare output format, parse result, admission result, and quality note
  against baseline.

```powershell
npm.cmd test -- --run apps/desktop/src/main/authoring/prompt.test.ts apps/desktop/src/main/authoring/ninerouter-backend.test.ts
npm.cmd run typecheck
```

### Step 3.2 - Replace Vague Creative Pressure With Safe Recipes

Scope:

- Content/visual guidance in prompt.
- `docs/current/content-guide.md` only if durable wording changes.

Output:

- Giu yeu cau "first draft phai co visual anchor", nhung noi bang recipe ngan:
  - big number only when number is supported;
  - two-column compare only when beat is compare/tradeoff;
  - SVG diagram only when the idea has structure/process;
  - statement beat can be strong typography + quick entrance + hold.
- Giam cac cum nhu "muc tieu toi thuong" neu chung tao ap luc qua lon ma khong
  giup pass contract.

Acceptance:

- Prompt van chan title-card blandness.
- Prompt khong khuyen khich model biet them number/fact hay animation phuc tap.
- Tests update de bao ve "bold but safe".

Verification:

- Canary: run the Step 3.0 subset that covers visual ambition/story guidance,
  including at least one evidence-heavy prompt, and compare quality plus
  parse/admission results against baseline.

```powershell
npm.cmd test -- --run apps/desktop/src/main/authoring/prompt.test.ts apps/desktop/src/main/authoring/contract-text.test.ts
npm.cmd run typecheck
```

### Step 3.3 - Tighten Motion Guidance Around Safe Defaults

Scope:

- `contract-text.ts`
- `prompt.ts` modules
- `contract-text.test.ts`

Output:

- Motion guidance van gom:
  - quick entrance 0.2-0.8s;
  - semantic progression only when content changes over time;
  - deterministic living motion only when bounded/purposeful;
  - readable final hold always valid.
- Khong them auto-fix TSX motion source.

Acceptance:

- No regression ve N5: invalid interpolate literal ranges van bi reject.
- Prompt khong day model viet multi-stage animation cho moi scene.

Verification:

- Canary: run the Step 3.0 subset that covers motion-heavy or long-duration
  prompts and check N5/admission result plus visible quality against baseline.

```powershell
npm.cmd test -- --run apps/desktop/src/main/authoring/contract-text.test.ts apps/desktop/src/main/authoring/prompt.test.ts packages/pipeline/src/authoring/admission.test.ts
npm.cmd run typecheck
```

### Step 3.4 - Content-Plan Prompt And Tolerance Boundary

Scope:

- `content-plan.ts`
- `content-plan.test.ts`
- `docs/current/content-guide.md` if needed.

Output:

- Content-plan prompt nhan manh allowed literal enum values cho schema-critical
  fields, nhung khong them rubric dai.
- Khong broaden tolerance truoc. Neu log cho thay `layoutFamily` hoac `hookType`
  drift, them normalizer cuc hep voi diagnostic nhu purpose/motion.
- Initial threshold for considering a new non-safety normalizer:
  - at least 3 occurrences of the same field drift in real logs/smoke, or
  - at least 10% over an observed window of 30+ attempts,
  - and the drift is clearly non-safety metadata.
- The 30+ attempt window is cumulative: Phase 4 log counters plus provider smoke
  notes over time. It is not a requirement to run 30 attempts in one smoke
  session.
- The observed window starts at the Phase 0.3 metrics baseline or Step 3.0
  canary baseline, whichever exists for that provider/model lane. It resets
  after an accepted prompt-policy checkpoint or rollback. Do not combine stale
  drift from unrelated prompt checkpoints to justify a new normalizer.

Acceptance:

- Non-safety metadata drift khong gay broad retry.
- Evidence/claims safety van hard.
- Diagnostics khong che mat model drift.
- Small smoke samples can trigger investigation, but not automatic broad
  normalization.

Verification:

- Canary: run the Step 3.0 subset that covers content-plan/schema-sensitive
  prompts and compare scene count, normalizations, and authoring path against
  baseline.

```powershell
npm.cmd test -- --run apps/desktop/src/main/authoring/content-plan.test.ts apps/desktop/src/main/authoring/ninerouter-backend.test.ts
npm.cmd run typecheck
```

### Step 3.5 - Batch Prompt Budget Guard

Scope:

- `prompt.ts` batch modules.
- `ninerouter-backend.ts` only if policy needs tiny guard.

Output:

- Batch prompt tiep tuc compact:
  - selected manifest scenes;
  - selected plan scenes;
  - selected usable claims;
  - global title/promise/payoff only.
- Add/confirm test that batch prompt does not include full research/full content
  plan/full manifest for every batch.

Acceptance:

- 10-12 scenes normal path khong vao 4-scene batch; this is tied to E19/E20.
- 13-16 scenes neu batch thi batch size compact va prompt size duoc kiem soat;
  this is tied to E19/E20, not a new magic threshold.
- Missing-TSX recovery van bounded.

Verification:

- Canary: run the full Step 3.0 set once after this step if it is the last
  Phase 3 prompt/batching change; otherwise run the subset that crosses the
  10-12 and 13-16 scene authoring paths.

```powershell
npm.cmd test -- --run apps/desktop/src/main/authoring/prompt.test.ts apps/desktop/src/main/authoring/ninerouter-backend.test.ts apps/desktop/src/main/authoring/reply-parser.test.ts
npm.cmd run typecheck
```

## Phase 4 - Authoring Observability And Log Hygiene

Goal: do duoc prompt/pipeline health ma khong log raw data qua nhieu.

### Step 4.1 - Gate Raw AI Reply Snippets

Scope:

- `content-plan-runner.ts`
- `author-reply-runner.ts`
- `reauthor-runner.ts`
- Tests around logging if present.

Output:

- Default logs giu structured reason/detail/counts.
- Raw reply snippets chi log khi explicit debug/diagnostic flag bat.

Acceptance:

- Parse failures van debuggable.
- Default logs khong de lo 2000 chars user/source/generated code mot cach mac
  dinh.

Verification:

```powershell
npm.cmd test -- --run apps/desktop/src/main/authoring/ninerouter-backend.test.ts
npm.cmd run typecheck
```

### Step 4.2 - Stable Failure Counters

Scope:

- Logging only.
- No UI feature.

Output:

- Stable log anchors cho:
  - content-plan parse invalid;
  - purpose normalized;
  - motion defaulted;
  - author reply parse failed;
  - batch selected;
  - batch parse failed;
  - missing TSX recovery attempted/succeeded/failed;
  - admission failed N5/N10.

Acceptance:

- Co the `rg` logs de xem prompt optimization co tac dung.
- Logging khong block authoring.

Verification:

```powershell
npm.cmd test -- --run apps/desktop/src/main/authoring/content-plan.test.ts apps/desktop/src/main/authoring/ninerouter-backend.test.ts
npm.cmd run typecheck
```

### Step 4.3 - Provider Smoke Protocol

Scope:

- Manual/provider-connected validation.
- No code change during smoke.

Output:

- Short note recording 3-5 attempts on same model family:
  - success/fail;
  - failure class if any;
  - normalization counts;
  - batch selected or not;
  - admission rejects.

Acceptance:

- At least one real RAG/explainer flow succeeds end-to-end through draft/stills
  review path.
- Do not declare "closed" from one lucky pass.

Manual command:

```powershell
npm.cmd --workspace @motionreal/desktop run app
```

## Phase 5 - Parser, Normalizer, And Recovery Debt

Goal: giu cac transform hien co vi chung da duoc test, nhung chan viec them
regex/string recovery vo toi va.

### Step 5.1 - Recovery Inventory

Scope:

- `reply-parser.ts`
- `manifest-schema.ts`
- `content-plan.ts`
- `normalize-imports.ts`
- tests tuong ung.

Output:

- Table: transform nao dang co, vi sao ton tai, test nao bao ve.

Acceptance:

- Future bug khong tu dong duoc fix bang mot regex moi trong parser.
- Biet transform nao la compatibility, transform nao la safety, transform nao la
  provider-output tolerance.

Verification:

```powershell
npm.cmd test -- --run apps/desktop/src/main/authoring/reply-parser.test.ts apps/desktop/src/main/authoring/content-plan.test.ts
npm.cmd run typecheck
git diff --check
```

### Step 5.2 - Define AST Transform Threshold

Scope:

- Docs/test policy first.
- No production AST transform unless a repeated failure proves need.

Output:

- Rule: only add source mutation when pattern is mechanical, AST-safe, tested
  before/after, and less risky than retry.

Acceptance:

- No hidden source mutation just to pass admission.
- N5/N10 remain hard where appropriate.

Verification:

```powershell
git diff --check
```

## Phase 6 - Repo Hygiene And Reserved Surfaces

Goal: giam nhieu doc/code de future agent khong nham scope, khong lam feature
moi.

### Step 6.1 - Legacy Naming/Sunset Notes

Scope:

- `apps/remotion/src/Root.tsx`
- `packages/pipeline/src/authoring/authored-entry.ts`
- `apps/desktop/src/main/index.ts`
- `scripts/calibrate-voice.ts`
- durable docs if needed.

Output:

- Neu `NewsVideo` va `news-studio-settings.json` can compat, them note ngan:
  why kept, when removable.
- Rewrite old task-code comments only where they no longer explain live behavior.

Acceptance:

- Compatibility aliases van hoat dong.
- Khong con cam giac co hai product identity/canonical contracts.

Verification:

```powershell
npm.cmd test -- --run packages/pipeline/src/authoring/authored-entry.test.ts apps/desktop/src/main/settings/settings-store.test.ts apps/desktop/src/main/startup-sequence.test.ts
npm.cmd run typecheck
git diff --check
```

If exact tests do not exist, run the nearest focused package tests and record
that gap.

### Step 6.2 - SFX Surface Decision

Scope:

- `packages/schema/src/index.ts`
- `packages/pipeline/src/audio/sfx.ts`
- `packages/pipeline/src/index.ts`
- docs only unless owner approves code change.

Decision type:

- Product owner decision, because this changes what looks feature-ready to users
  and integrators.

Output:

- Decision:
  - keep SFX as reserved/internal with docs; or
  - hide export/schema surface until feature work resumes.

Acceptance:

- Repo khong gui tin hieu rang SFX la feature ready neu no chua ready.
- Khong break existing schema consumers without explicit migration.

Verification:

```powershell
npm.cmd test -- --run packages/schema/src/schema.test.ts
npm.cmd run typecheck
git diff --check
```

If SFX logic changes instead of docs-only policy, add a focused SFX test first
instead of relying only on schema/typecheck.

### Step 6.3 - Image Crawl Defaults Decision

Scope:

- `apps/desktop/src/shared/settings-model.ts`
- `apps/desktop/src/main/workspace/workspace-create-flow.ts`
- docs/settings tests.

Decision type:

- Product owner decision, because defaults affect UX, provider/vision cost, and
  whether URL-based create feels like the stable product path or a feature
  expansion.

Output:

- Confirm whether article image AI filtering and human review default true are
  still desired for stable product path.
- If not, change defaults behind explicit owner decision and tests.

Acceptance:

- URL-based create flow khong ton provider/vision work bat ngo neu owner khong
  muon feature expansion.
- Existing image safety/media rules khong bi yeu di.

Verification:

```powershell
npm.cmd test -- --run apps/desktop/src/shared/settings-model.test.ts apps/desktop/src/main/workspace/workspace-create-flow.test.ts
npm.cmd run typecheck
```

### Step 6.4 - Dev/Test TTS Scope

Scope:

- `docs/current/maintenance.md`
- `packages/pipeline/src/cli/cli.ts` only if CLI help needs wording.
- Desktop config tests if changed.

Output:

- Durable docs say `mock`/`none` are explicit CLI/dev modes only.
- Desktop production path still blocks missing real voice config.

Acceptance:

- No contradiction with `AI_CONTRACT.md`.
- No silent fallback.

Verification:

```powershell
npm.cmd test -- --run packages/pipeline/src/cli/cli.test.ts packages/pipeline/src/audio/tts-config.test.ts apps/desktop/src/main/settings/settings-store.test.ts
npm.cmd run typecheck
git diff --check
```

## Phase 7 - Sensitive File Refactors And UI Style Cleanup

Goal: giam cognitive load nhung khong refactor lung tung cac file nhay cam.

### Step 7.1 - Content Plan File Split

Scope:

- `content-plan.ts`
- possible new files:
  - `content-plan-schema.ts`
  - `content-plan-normalize.ts`
  - `content-plan-prompt.ts`

Output:

- Parser/schema/normalizer/prompt builder tach ro.
- Public API cua content-plan giu nguyen neu co the.

Acceptance:

- Behavior tests pass unchanged.
- Diff mainly move/extract, not policy change.

Verification:

```powershell
npm.cmd test -- --run apps/desktop/src/main/authoring/content-plan.test.ts apps/desktop/src/main/authoring/ninerouter-backend.test.ts
npm.cmd run typecheck
git diff --check
```

### Step 7.2 - Ninerouter Backend Runner Boundaries

Scope:

- `ninerouter-backend.ts`
- existing runner modules.

Output:

- Only extract if a behavior slice needs it.
- Candidate helpers: capacity policy, batch selection, logging summary.

Acceptance:

- No broad orchestration rewrite.
- Tests prove partial-write safety and missing-TSX recovery unchanged.

Verification:

```powershell
npm.cmd test -- --run apps/desktop/src/main/authoring/ninerouter-backend.test.ts
npm.cmd run typecheck
```

### Step 7.3 - Renderer Inline Style Cleanup

Scope:

- `apps/desktop/src/renderer/primitives.tsx`
- `apps/desktop/src/renderer/views/workspace.tsx`
- `apps/desktop/src/renderer/views/storyboard.tsx`
- owning CSS partials.

Output:

- Move stable repeated layout/style clusters to CSS.
- Keep dynamic sizing/measurement inline.

Acceptance:

- UI appearance remains equivalent.
- No overlap/clipping/layout shift introduced.

Verification:

```powershell
npm.cmd run typecheck
npm.cmd test
git diff --check
```

Manual visual check if desktop UI changed:

```powershell
npm.cmd --workspace @motionreal/desktop run app
```

### Step 7.4 - Do Not Big-Bang Render/Grid/Orchestrator

Scope:

- `render-grid.ts`
- `orchestrator.ts`
- `workspace-controller.ts`

Output:

- Written decision for any proposed extraction before code change.

Acceptance:

- No refactor solely because a file is large.
- Every extraction has a behavior boundary and focused tests.

Verification:

```powershell
git diff --check
```

## Phase 8 - Render/Cache Scaling Design

Goal: khong mo parallelism truoc khi cache/bundle lifetime duoc thiet ke.

### Step 8.1 - Document Current Single-Workflow Assumption

Scope:

- `docs/current/maintenance.md`
- maybe `docs/current/architecture.md`.

Output:

- Current rendering assumption documented:
  - per-project lock;
  - small in-memory bundle/composition cache;
  - not cross-project parallel-safe by design.

Acceptance:

- Future UI concurrency work khong bat dau tu button/queue truoc khi cache design
  xong.

Verification:

```powershell
git diff --check
```

### Step 8.2 - Cache Pruning Decision

Scope:

- `packages/pipeline/src/store/store.ts`
- docs/tests if behavior changes.

Output:

- Decision:
  - accept age-based pruning and document it; or
  - touch cache mtime on hit to approximate LRU.

Acceptance:

- If behavior changes, tests cover reused cache staying fresh.
- If not changing, docs stop calling it LRU.

Verification:

```powershell
npm.cmd test -- --run packages/pipeline/src/render/cache.test.ts packages/pipeline/src/store/store.test.ts
npm.cmd run typecheck
git diff --check
```

### Step 8.3 - Bundle Lifetime Design Before Parallelism

Scope:

- Design note only unless owner approves implementation.

Decision type:

- Product owner plus engineering decision, because concurrency changes product
  behavior, runtime cost, cache semantics, and failure recovery.

Output:

- Proposed model for:
  - ref-counted bundle cache;
  - eviction policy;
  - per-project vs global concurrency;
  - stale lock threshold;
  - cleanup on crash.

Acceptance:

- No code change to enable cross-project parallel rendering before design is
  accepted.

Verification:

```powershell
git diff --check
```

## Phase 9 - Final Validation And Closeout

Goal: chi goi plan xong khi behavior, docs, va provider smoke deu co bang chung.

### Step 9.1 - Full Local Gate

Scope:

- Whole repo.

Output:

- Gate result.
- Classify any failure.

Acceptance:

- Full gate green, or documented known flaky with focused rerun evidence.

Verification:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
git diff --check
```

### Step 9.2 - Provider-Connected Authoring Smoke

Scope:

- Manual.
- Same provider/model family as normal desktop authoring.

Output:

- 3 attempts minimum, 5 preferred.
- Record:
  - content-plan parse result;
  - normalization counts;
  - TSX authoring parse result;
  - batch path selected or not;
  - admission result;
  - still/draft readiness.

Acceptance:

- At least one real flow succeeds through still/draft review.
- No recurrence of target failure classes without classification.

Manual command:

```powershell
npm.cmd --workspace @motionreal/desktop run app
```

### Step 9.3 - Rollback And Archive

Scope:

- Docs/git only.

Output:

- Rollback note:
  - which commit(s) to revert if prompt optimization hurts reliability;
  - which safety gates must not be weakened during rollback.
- Archive or delete this temporary working note only after durable docs carry the
  final accepted decisions.

Acceptance:

- Future owner/agent can undo policy/prompt changes quickly.
- Temporary note does not become stale durable contract.
- While this note is active, keep the Phase Status and First Real Execution Step
  as the resume surface. Do not add broad new analysis sections unless they
  replace stale detail or are destined for `docs/current/*`.
- Durable docs synced before archive/delete:
  - `docs/current/maintenance.md` has prompt-change checklist, log/counter
    policy, threshold rationale, canary protocol, and render/cache decisions;
  - `docs/current/architecture.md` reflects any changed authoring/prompt module
    boundaries;
  - `docs/current/authoring-contract.md` reflects any hard contract wording
    changes;
  - `docs/current/content-guide.md` reflects any changed story/visual/motion
    guidance;
  - provider docs are updated only if provider smoke/setup instructions changed.

Verification:

```powershell
git diff --check
git status --short
```

## Phase Status

## Execution Log - 2026-07-07

| Step | Workflow status | Evidence |
| --- | --- | --- |
| Phase 0 Step 0.1 - Confirm Checkpoint | Kiem tra -> docs update -> kiem tra -> xac nhan complete | Latest commit `af68f52`; dirty tree only this working note; `git diff --check` clean. |
| Phase 0 Step 0.2 - Local Gate Before Implementation | Kiem tra -> docs update -> kiem tra -> xac nhan complete | `npm.cmd run typecheck` passed; `npm.cmd test` passed 98 files/986 tests plus 1 heavy lane/14 tests; `npm.cmd run build` passed; `git diff --check` clean. |
| Phase 0 Step 0.3 - Prompt/Authoring Metrics Baseline | Kiem tra -> docs update -> kiem tra -> xac nhan complete | No runtime/provider log files found in repo; baseline is static source/fixture anchors plus current prompt file sizes below. |
| Phase 1 Step 1.1 - Map Prompt Sources | Kiem tra -> docs update -> kiem tra -> xac nhan complete | Prompt/runtime/docs sources mapped by hard output, security, TSX contract, story, narration, visual ambition, motion, image, batch/recovery, and QA/refine categories. |
| Phase 1 Step 1.2 - Define Hard Contract Vs Quality Guidance | Kiem tra -> docs update -> kiem tra -> xac nhan complete | Hard contract, quality guidance, and advisory-only boundaries recorded before runtime prompt edits. |
| Phase 1 Step 1.3 - Add Prompt Change Checklist | Kiem tra -> docs update -> kiem tra -> xac nhan complete | `docs/current/maintenance.md` now requires prompt changes to classify boundary, metric, tests, smoke/canary need, and rollback path. |
| Phase 2 Step 2.1 - Extract Prompt Sections | Kiem tra -> code -> kiem tra -> xac nhan complete | `prompt.ts` is now an orchestrator/re-export surface; extracted message types, content rules, output format, content-plan blocks, batch/recovery, visual-QA, and image-filter modules. `npm.cmd test -- --run apps/desktop/src/main/authoring/prompt.test.ts apps/desktop/src/main/authoring/ninerouter-backend.test.ts` passed 2 files/77 tests; `npm.cmd run typecheck` passed; `git diff --check` has no whitespace errors. |
| Phase 2 Step 2.2 - Lock Section Markers In Tests | Kiem tra -> tests -> kiem tra -> xac nhan complete | Added prompt section-marker order test, batch selected-claim/no-full-context assertions, recovery compactness assertions, and AUTHORING_CONTRACT hard-before-visual-ambition ordering test. `npm.cmd test -- --run apps/desktop/src/main/authoring/prompt.test.ts apps/desktop/src/main/authoring/contract-text.test.ts` passed 2 files/44 tests; `npm.cmd run typecheck` passed. |
| Phase 2 Step 2.3 - Prompt Size Snapshot | Kiem tra -> tests -> kiem tra -> xac nhan complete | Added prompt text-size baselines for main author, TSX batch, missing-TSX recovery, reauthor, and visual-QA prompt builders with a 10% growth guard. `npm.cmd test -- --run apps/desktop/src/main/authoring/prompt.test.ts` passed 1 file/35 tests; `npm.cmd run typecheck` passed. |
| Phase 3 Step 3.0 - Fixed Before/After Canary Set | Kiem tra -> docs update -> kiem tra -> xac nhan complete | Fixed 6-prompt canary set, per-step subset map, and provider result template recorded below. No runtime prompt wording changed. Provider baseline runs are pending because this step is docs/protocol only. |
| Phase 3 Step 3.1 - Put Render-Pass Contract Before Ambition | Kiem tra -> code/tests -> kiem tra -> xac nhan complete | Main and batch author system prompts now put AUTHORING_CONTRACT and output format before content/creative guidance; role opener now names pass/parse/build/render as first priority. Tests lock this ordering. `npm.cmd test -- --run apps/desktop/src/main/authoring/prompt.test.ts apps/desktop/src/main/authoring/ninerouter-backend.test.ts` passed 2 files/79 tests; `npm.cmd run typecheck` passed. Provider canary subset P3-C1/P3-C2/P3-C4 not run in this automated pass and remains pending. |
| Phase 3 Step 3.2 - Replace Vague Creative Pressure With Safe Recipes | Kiem tra -> code/docs/tests -> kiem tra -> xac nhan complete | Runtime content rules and durable content guide now keep bold-first visual anchors while routing to safe recipes: supported numbers only, compare/tradeoff two-column only, structure/process SVG only, statement beats can use strong typography + quick entrance + readable hold. `npm.cmd test -- --run apps/desktop/src/main/authoring/prompt.test.ts apps/desktop/src/main/authoring/contract-text.test.ts` passed 2 files/45 tests; `npm.cmd run typecheck` passed. Provider canary subset P3-C1/P3-C3/P3-C6 not run in this automated pass and remains pending. |
| Phase 3 Step 3.3 - Tighten Motion Guidance Around Safe Defaults | Kiem tra -> code/tests -> kiem tra -> xac nhan complete | Main TSX output example now demonstrates quick entrance + readable hold instead of line-draw/pulse multi-stage motion. Contract tests lock semantic progression only when content truly progresses, bounded living motion, and the `durationInFrames - N` warning. `npm.cmd test -- --run apps/desktop/src/main/authoring/contract-text.test.ts apps/desktop/src/main/authoring/prompt.test.ts packages/pipeline/src/authoring/admission.test.ts` passed 3 files/66 tests; `npm.cmd run typecheck` passed. Provider canary subset P3-C3/P3-C4/P3-C5 not run in this automated pass and remains pending. |
| Phase 3 Step 3.4 - Content-Plan Prompt And Tolerance Boundary | Kiem tra -> code/tests -> kiem tra -> xac nhan complete | Content-plan prompt now tells the model to copy exact schema-critical enum literals without adding a long rubric. No new normalizer was added; tests keep `hookType` and `layoutFamily` drift invalid while existing purpose/motion tolerance remains narrow and diagnostic. `npm.cmd test -- --run apps/desktop/src/main/authoring/content-plan.test.ts apps/desktop/src/main/authoring/ninerouter-backend.test.ts` passed 2 files/74 tests; `npm.cmd run typecheck` passed. Provider canary subset P3-C1/P3-C3/P3-C5 not run in this automated pass and remains pending. |

### Phase 0 Metrics Baseline

This is not a provider health result. It is the initial static baseline for
future log searches and prompt-size comparisons until Phase 4 counters or manual
provider smoke notes add real runtime data.

| Metric anchor | Static hits excluding this plan note |
| --- | ---: |
| `content-plan parse failed` | 1 |
| `content-plan tolerant normalizations applied` | 2 |
| `purpose-normalized` | 5 |
| `motion-defaulted` | 6 |
| `author-reply parse failed` | 2 |
| `authoring batch parse failed` | 1 |
| `authoring will use compact TSX batches` | 1 |
| `author-reply missing TSX recovery` | 3 |
| `admission failed` | 1 |
| `missing-code` | 11 |

| Prompt/codegen file | Size |
| --- | ---: |
| `apps/desktop/src/main/authoring/prompt.ts` | 40,921 bytes |
| `apps/desktop/src/main/authoring/contract-text.ts` | 14,185 bytes |
| `apps/desktop/src/main/authoring/content-plan.ts` | 25,650 bytes |

### Phase 2 Step 2.3 Prompt Builder Size Snapshot

Measured from the runtime prompt builders after Phase 2 extraction. The test
counts text prompt content and excludes image data URLs, because multimodal
image payload size is not prompt wording. The first guard allows Phase 3 to
reduce prompt size, but flags growth over 10% unless the test/doc diff explains
why that growth is intentional.

| Prompt builder | Baseline text chars |
| --- | ---: |
| Main author prompt | 19,539 |
| TSX batch prompt | 19,056 |
| Missing-TSX recovery prompt | 12,201 |
| Reauthor prompt | 12,482 |
| Visual QA prompt | 1,305 |

### Phase 3 Step 3.0 Fixed Canary Set

Purpose: compare Phase 3 prompt behavior changes against the same inputs,
instead of ad-hoc "looks better" smoke attempts. These canaries are stable by
design: most use embedded source notes rather than live URLs, so a future run
does not depend on a news page changing.

Run rules:

- Use the same provider/model family, voice config, format, duration tier, and
  language setting for before/after comparisons.
- Do not edit runtime prompt/code during a canary run.
- Record failures by class: content-plan parse, purpose/motion normalization,
  author reply parse, missing TSX/truncation, batch selection, admission N5/N10,
  still/draft readiness, or unrelated provider/runtime config.
- Quality note is coarse only: `bland`, `acceptable`, `strong`, or `broken`.
- Provider-connected baseline is pending until a manual/provider run is
  available. If prompt behavior changes proceed before provider access is
  available, Phase 3 remains partial until the canary set is run.

Canaries:

| Id | Settings | Fixed input prompt | Covers |
| --- | --- | --- | --- |
| P3-C1-VI-RAG | format `tiktok`, duration tier `2`, language `vi`, no images | `Tao video TikTok tieng Viet giai thich vi sao mot cong ty logistics thu nghiem tro ly AI noi bo cho nhan vien van hanh. Chi dung source notes sau, khong them so lieu ngoai: Source notes: 2026-06-20 bat dau pilot voi 500 nhan vien; muc tieu la giam thoi gian tim SOP; 3 nhom tham gia la kho, dieu phoi, cham soc khach hang; rui ro noi bo duoc neu la tra loi sai quy trinh va lo du lieu khach hang; ket qua chua duoc cong bo.` | RAG/news explainer, Vietnamese, cited facts, schema-sensitive content plan, main author path. |
| P3-C2-EN-CONCEPT | format `tiktok`, duration tier `1`, language `en`, no images | `Create a short English explainer about why teams confuse automation with leverage. No external facts or numbers. Make it concrete for a small operations team, with a clear hook, one tension, and a practical ending question.` | English, no-URL conceptual explainer, narration voice, output-format discipline. |
| P3-C3-VI-NUMERIC | format `tiktok`, duration tier `2`, language `vi`, no images | `Tao video TikTok tieng Viet ve mot case onboarding noi bo. Chi dung cac so lieu nay: truoc day mat 14 ngay de nhan vien moi tu lam duoc viec; sau khi sua checklist con 9 ngay; ticket hoi lai quy trinh giam 23%; nhom thu nghiem co 36 nguoi; chi phi cong cu la 4,8 trieu VND/thang. Giai thich y nghia, khong phong dai thanh loi hua ROI.` | Numeric/evidence-heavy topic, anti-fabrication, visual recipe pressure, admission safety. |
| P3-C4-VI-90S-T2 | format `tiktok`, duration tier `2`, language `vi`, no images | `Lam video TikTok khoang 90 giay tieng Viet ve chu de: nguoi quan ly nho nen dung AI de viet SOP nhu the nao ma khong lam quy trinh tro nen mong manh. Khong can so lieu. Can co hook manh, 3 y chinh, va ket thuc bang cau hoi quyet dinh.` | 90s short-form tier 2, expected 10-12 scene pressure, motion/default readability, normal single authoring path. |
| P3-C5-EN-90S-T3 | format `tiktok`, duration tier `3`, language `en`, no images | `Create a 90-second English TikTok about the hidden cost of "quick AI automation" when no one owns the workflow. No made-up metrics. Use a clear arc: seductive shortcut, first crack, operational consequence, safer habit, final decision question.` | English long short-form tier 3, 13-16 scene pressure if planner chooses it, batch budget boundary, motion-heavy prompts. |
| P3-C6-VI-IMAGE-OPTIONAL | format `tiktok`, duration tier `1`, language `vi`, image-assisted if provider/manual run supports images | `Dung cac anh dinh kem lam ngu canh san pham. Tao video TikTok tieng Viet ngan giai thich 3 diem nguoi dung nen nhin vao khi danh gia man hinh dashboard nay. Khong doan thuong hieu, khong them so lieu ngoai anh.` | Optional image-assisted request, SceneImage/media rules, visual ambition without invented facts. |

Per-step canary subsets:

| Phase 3 step | Required subset before accepting the step |
| --- | --- |
| Step 3.1 render-pass contract before ambition | P3-C1-VI-RAG, P3-C2-EN-CONCEPT, P3-C4-VI-90S-T2 |
| Step 3.2 safe visual/story recipes | P3-C1-VI-RAG, P3-C3-VI-NUMERIC, P3-C6-VI-IMAGE-OPTIONAL if images are available |
| Step 3.3 motion safe defaults | P3-C3-VI-NUMERIC, P3-C4-VI-90S-T2, P3-C5-EN-90S-T3 |
| Step 3.4 content-plan prompt/tolerance boundary | P3-C1-VI-RAG, P3-C3-VI-NUMERIC, P3-C5-EN-90S-T3 |
| Step 3.5 batch prompt budget guard | P3-C4-VI-90S-T2, P3-C5-EN-90S-T3, then full P3-C1..P3-C6 if this is the last Phase 3 prompt/batching change |

Recording template:

| Field | Value |
| --- | --- |
| Run id | `phase3-before-YYYYMMDD-N` or `phase3-after-step3.x-YYYYMMDD-N` |
| Commit | Git hash before the run |
| Provider/model | Provider and model family |
| Canary id | P3-C1..P3-C6 |
| Settings | format, duration tier, language, images yes/no |
| Content-plan parse | pass/fail and failure class |
| Normalizations | purpose-normalized count, motion-defaulted count |
| Scene count/path | scene count, single authoring or compact batch |
| Author reply parse | pass/fail; missing TSX recovery attempted/succeeded/failed |
| Admission | pass/fail; include N5/N10 if present |
| Still/draft readiness | still review ready, draft ready, or stopped earlier |
| Quality note | bland, acceptable, strong, or broken |
| Notes/log anchors | Relevant log anchors only; do not paste raw private/source data |

### Phase 1 Step 1.1 Prompt Source Map

This map is the baseline before Phase 2 extraction. Line numbers must still be
re-checked before editing runtime prompt files.

| Rule category | Runtime prompt/source | Durable docs/tests | Boundary note |
| --- | --- | --- | --- |
| Hard output format | `prompt.ts` `outputFormatContract()` around manifest JSON, one TSX fence per component, `component`/`registerComponent` id match; batch/recovery variants at `authorModuleBatchSystem()` and `missingTsxRecoverySystem()` | `prompt.test.ts` locks manifest/code-fence and batch/recovery behavior | Parser/build/admission enforce this; keep before creative guidance. |
| Import/security contract | `contract-text.ts` `AUTHORING_CONTRACT` import whitelist and forbidden block/theme/host APIs | `AI_CONTRACT.md`; `docs/current/authoring-contract.md`; admission/typecheck-authored tests | Hard blocker. Do not relax for prompt optimization. |
| TSX module contract | `contract-text.ts` module shape, schema/example/default `registerComponent`; `prompt.ts` example structure | `docs/current/authoring-contract.md`; prompt/contract tests | Hard render contract. Extractable as a stable prompt section. |
| Factual/story rules | `content-plan.ts` planner prompt and quality checks; `prompt.ts` `contentRules()` evidence/language/story constraints | `docs/current/content-guide.md`; content-plan tests | Evidence/claim safety is hard; story pacing and arc are guidance unless schema/admission says otherwise. |
| Narration quality | `prompt.ts` `languageBlock()` and `contentRules()` narration voice; content-plan prompt language guidance | `docs/current/content-guide.md` audience/language sections; prompt tests | Quality guidance. Keep strong voice, but do not mix with output-fence contract. |
| Visual ambition | `prompt.ts` `contentRules()` bold-first requirement and `authorSystem()` creative role | `docs/current/content-guide.md` visual guidance; prompt tests around bold-first | Quality guidance. Preserve anti-blandness while reducing vague pressure in Phase 3. |
| Motion recipes | `contract-text.ts` determinism/motion section; `content-plan.ts` `motionProgression` prompt/normalizer; `prompt.ts` content-plan advisory block | `docs/current/authoring-contract.md`; `docs/current/content-guide.md`; contract/content-plan/admission tests | Mixed: deterministic frame logic and valid interpolate ranges are hard; richness/tempo is guidance. |
| Image rules | `prompt.ts` image instruction block; `contract-text.ts` `SceneImage` exception; schema `SceneImage` local-only rules | `AI_CONTRACT.md`; `docs/current/authoring-contract.md`; schema/admission tests | Hard for media safety; layout/placement quality remains advisory unless live code hard-blocks it. |
| Batch/recovery rules | `prompt.ts` `authorModuleBatchSystem()`, `buildAuthorModuleBatchMessages()`, `missingTsxRecoverySystem()` | `docs/current/maintenance.md` authoring output size; ninerouter/reply-parser tests | Stability policy. Keep compact and bounded; no broad retry. |
| Visual QA/refine rules | `prompt.ts` `reauthorSystem()` and `VISUAL_QA_SYSTEM` | `AI_CONTRACT.md` layout advisory rule; maintenance motion-tempo notes; visual QA/refine tests if changed | Advisory unless tied to safety/build/runtime failure. |

### Phase 1 Step 1.2 Hard Contract Vs Quality Guidance

Hard contract:

- Output fences and exact parse shape: one manifest JSON where required, exact
  component ids, one TSX block per requested component, no extra prose.
- Import/security contract: authored scene imports limited to `react`,
  `remotion`, `zod`, and `@motionreal/compositions`; no block/theme, Node,
  browser host APIs, dynamic import, eval, network, filesystem, or remote media.
- TSX module shape: exported `schema`, exported `example`, literal
  `registerComponent` id, default registered component, deterministic frame
  logic, no authored captions.
- Manifest/spec integrity: duplicate ids, unknown components, empty specs,
  invalid locked timing/audio, unsafe media, build/runtime crash, and admission
  blockers stay hard.
- Factual safety: no invented facts, numbers, dates, quotes, prices,
  benchmarks, release claims, or sources; claim/evidence references remain hard
  where content-plan validation marks them hard.
- Provider/voice safety: never silently fall back to `mock`, `none`, or another
  provider when real voice configuration is missing.

Quality guidance:

- Bold-first visual ambition, bespoke SVG/CSS, layout variety, strong visual
  anchors, and anti-title-card guidance.
- Narration voice, hook sharpness, CTA flavor, and topic-specific editorial
  tension.
- Motion richness, semantic progression, continuous living motion, and visual
  tempo when they are not required for safety or valid TSX.
- Prompt-size optimization targets and canary quality notes.

Advisory unless owner approves a hard gate:

- General layout/aesthetic warnings, visual taste, color/style preference,
  "too bland" feedback, motion-tempo feel, and image placement refinements that
  do not violate import/media/build/runtime safety.
- Visual QA/refine findings that improve the draft but are not backed by a
  parser, admission rule, render oracle, or schema validation.

Implementation rule:

- Phase 2 may split prompt sections without changing this boundary. Phase 3 may
  move or rewrite quality wording, but it must not weaken any hard contract above
  and must not turn advisory style checks into hard gates without owner approval.

| Phase | Status | Owner gate | Effort band | Next step |
| --- | --- | --- | --- | --- |
| Phase 0 - Baseline Checkpoint And Re-Entry | done | Engineering executor reports; owner reviews failures only | S | Baseline checkpoint, full local gate, and static metrics baseline recorded. |
| Phase 1 - Prompt Contract Boundary | done | Owner reviews hard/quality/advisory boundary before runtime edits | S | Prompt source map, boundary, and durable checklist recorded. |
| Phase 2 - Prompt Module Split Without Behavior Change | done | Engineering can execute after Phase 1 owner review | M | Prompt modules split, section markers locked, and prompt size guard added without intentional behavior change. |
| Phase 3 - Prompt Fragility Reduction | partial | Owner approval required before and after prompt behavior changes | M-L | Step 3.0 canary set is recorded; run before-baseline canaries if provider access is available, then owner reviews before Step 3.1 runtime prompt ordering changes. |
| Phase 4 - Authoring Observability And Log Hygiene | pending | Engineering can execute; owner reviews raw-log policy | S-M | Gate raw reply snippets and stabilize counters. |
| Phase 5 - Parser, Normalizer, And Recovery Debt | pending | Owner approval required for any new source mutation | S-M | Inventory first, no new regex by default. |
| Phase 6 - Repo Hygiene And Reserved Surfaces | pending | Owner/product decisions for SFX/image defaults | M | Low-risk cleanup after prompt boundary is clear. |
| Phase 7 - Sensitive File Refactors And UI Style Cleanup | pending | Owner approval for sensitive-file extractions | M-L | Behavior-led only, no big-bang rewrite. |
| Phase 8 - Render/Cache Scaling Design | pending | Owner/product plus engineering decision | S for design, XL if implemented | Design before concurrency implementation. |
| Phase 9 - Final Validation And Closeout | pending | Owner accepts final gate/provider smoke/rollback | S-L | Full gate + provider smoke + rollback/archive. |

## Next Real Execution Step

Phase 3 Step 3.0 is recorded. Before editing runtime prompt wording in Step
3.1, run the before-baseline canary subset if provider access is available, then
get owner review/approval for the prompt-ordering change.

```powershell
git log -1 --oneline
git status --short
git diff --check
```

If provider access is not available, record that exception and keep Phase 3 in
partial status until the full canary set can be run.
