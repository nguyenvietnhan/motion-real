# Refactor Risk Audit - 2026-07-06

## Muc Dich

Bao cao nay quet lai MotionReal theo huong refactor/don dep: tim nhung diem dang
lam du an kho kiem soat, de vo tinh lam hong pipeline, hoac lam cac lan them tinh
nang moi de bi phinh ra. Day khong phai la ke hoach big-bang rewrite. Pipeline
hien tai dang co contract ro, test kha day, va nhieu guard duoc them co chu dich.

Ket luan ngan: du an khong co dau hieu "vo kien truc", nhung rui ro chinh nam o
mot so file dieu phoi rat lon, noi nhieu vong lap AI/render/safety/UI state dang
song chung. Nhung diem nay nen duoc tach bang cac slice nho, co test, va khong
nen refactor chi vi so dong.

## Pham Vi Va Cach Quet

Nguon doc/contract da doi chieu:

- `AI_CONTRACT.md`
- `README.md`
- `docs/current/architecture.md`
- `docs/current/maintenance.md`
- `docs/current/authoring-contract.md`
- `docs/current/content-guide.md`
- `docs/current/youtube-mode-deferred.md`
- `docs/providers/vivibe.md`
- `docs/providers/elevenlabs.md`

Loai tru khi do metric: `node_modules`, `dist`, `.video-tool`,
`apps/desktop/dist-electron`, `vendor-fonts.generated.ts`.

Lenh metric chinh:

```powershell
rg --files --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/.video-tool/**' --glob '!apps/desktop/dist-electron/**' --glob '!**/vendor-fonts.generated.ts'
```

Snapshot metric:

| Loai | So file | So dong |
| --- | ---: | ---: |
| Source `.ts/.tsx/.css`, khong tinh test | 175 | 28,237 |
| Test `.test.ts/.test.tsx` | 95 | 15,451 |

Top file lon nhat:

| Dong | File |
| ---: | --- |
| 2,223 | `apps/desktop/src/renderer/theme.css` |
| 1,203 | `apps/desktop/src/main/workspace/workspace-controller.test.ts` |
| 1,150 | `apps/desktop/src/main/authoring/ninerouter-backend.ts` |
| 1,014 | `apps/desktop/src/main/authoring/ninerouter-backend.test.ts` |
| 993 | `packages/pipeline/src/safety/render-grid.ts` |
| 982 | `apps/desktop/src/main/workspace/workspace-controller.ts` |
| 945 | `packages/pipeline/src/orchestrator.ts` |
| 809 | `packages/tts/src/index.ts` |
| 763 | `packages/pipeline/src/render/renderer.ts` |
| 542 | `apps/desktop/src/renderer/views/home.tsx` |
| 509 | `packages/pipeline/src/authoring/admission.ts` |
| 502 | `packages/pipeline/src/cli/cli.ts` |
| 493 | `apps/desktop/src/main/authoring/prompt.ts` |
| 484 | `apps/desktop/src/main/index.ts` |

## Contract/Huong Dan Hien Tai

Nhung diem quan trong da duoc docs hien tai phan anh dung:

- `AI_CONTRACT.md:16-18` xac nhan pure AUTHOR mode: moi video dung scene `.tsx`
  moi, khong co template catalog/layout-block toolkit/theme system cho authored
  scenes.
- `AI_CONTRACT.md:99-100` canh bao khong refactor tuy tien `orchestrator.ts`,
  `render-grid.ts`, hoac desktop workspace flow.
- `docs/current/maintenance.md:12-22` liet ke sensitive files: `orchestrator.ts`,
  `render-grid.ts`, `workspace-controller.ts`, `ninerouter-backend.ts`,
  `apps/desktop/src/main/index.ts`.
- `docs/current/maintenance.md:24-35` da co cleanup order: docs truoc, tach
  authoring backend, roi moi quay lai workspace state machine, sau cung moi
  chia render-grid/orchestrator.
- `docs/current/architecture.md:22-48` noi ro `index.ts` la Electron composition
  root, khong nen tao broad handler builder chi de giam line count.
- `docs/current/architecture.md:62-64` noi ro `workspace-controller.ts` van so huu
  orchestration: live stage maps, in-flight jobs, cancellation, retry,
  snapshot/restore, render/refine/publish ordering, events.

Doc sync nhin chung dang dung. Diem drift ro nhat nam trong comment dau file cua
`packages/pipeline/src/orchestrator.ts`, chi tiet o Finding 2.

## Finding 1 - Authoring Backend La Godfile Rui Ro Cao

Muc do: Cao  
File: `apps/desktop/src/main/authoring/ninerouter-backend.ts`  
Metric: 1,150 dong, 20 import, 28 `catch`, test rieng 1,014 dong.

Bang chung:

- `ninerouter-backend.ts:250-404` ham `authorScenes` lam lien tiep nhieu viec:
  chon model, ingest URL, doc file research, doc image thanh data URL, goi content
  planning, parse/repair plan, quyet dinh batching, goi authoring, ghi `.tsx`,
  ghi manifest, chay admission.
- `ninerouter-backend.ts:425-684` tiep tuc nam trong cung file cac path recover:
  repair content plan, author single reply, author batched reply, recover missing
  TSX.
- `ninerouter-backend.ts:705-830` `reauthor` doc manifest, resolve scene file,
  goi AI, parse response, ghi file, chay admission, retry, rollback.
- `ninerouter-backend.ts:919-990` file nay con boc `renderDraft`,
  `renderStills`, `renderFull`, va `getSafetyReport`.
- `ninerouter-backend.ts:1003-1065` con gom AI image filter va crawl image.
- `ninerouter-backend.ts:1075+` con gom visual-QA.

Vi sao kho kiem soat:

- Mot thay doi nho trong authoring co the cham vao gateway, URL ingest, image
  authority, content plan, parse/repair, file IO, manifest, admission, render
  wrapper, va visual-QA.
- Public seam `NineRouterAuthoringBackend` dang dung nhu "bo nao authoring", "bo
  noi voi render tools", va "bo tien xu ly media" cung luc.
- Test nhieu la tot, nhung test lon cung la dau hieu behavior dang bi dong goi
  quanh mot object qua rong.

Huong don dep an toan:

1. Tach truoc cac unit it rui ro, van giu public class hien tai:
   `content-plan-runner`, `author-batch-runner`, `reauthor-runner`,
   `image-filter-runner`, `article-image-crawler`.
2. Uu tien tach code da co input/output ro va dang co test parse/quality rieng.
3. Khong doi prompt/output contract trong cung slice voi tach file.
4. Sau moi slice, chay focused test cua backend truoc khi full gate.

## Finding 2 - Render Orchestrator Qua Nhieu Trach Nhiem Va Co Comment Drift

Muc do: Cao  
File: `packages/pipeline/src/orchestrator.ts`  
Metric: 945 dong, 28 import, 9 `catch`.

Bang chung:

- Comment dau file `orchestrator.ts:92-95` mo ta flow:
  `admit authored scenes -> manifest/spec -> static grid -> TTS -> lock -> build
  gate -> determinism -> render -> render oracles -> review -> clean scratch`.
- Flow thuc te da khac va phong phu hon:
  - `orchestrator.ts:368-452`: admission, manifest/spec, static grid, N10 authored
    typecheck truoc TTS.
  - `orchestrator.ts:462-598`: TTS, lock, build gate, generated authored entry,
    N31 runtime probe, determinism.
  - `orchestrator.ts:670-833`: review artifacts, render oracles, layout measure,
    N15/N17, late safe-area, aggregate report, done/review pending, cleanup.
  - `orchestrator.ts:953-966`: pre-render failure report persistence rieng cho
    N10/static/runtime failures.
- `orchestrator.ts:419-424` noi thang N10 la synchronous CPU-heavy, mat 5-8s va
  block Electron main event loop; trong thoi gian do IPC "Dung render" khong xu
  ly duoc.

Vi sao kho kiem soat:

- Mot ham pipeline dai dang so huu ca cost gates, cancellation, TTS spending,
  generated entry, safety report, render cache path, review state, va cleanup.
- Comment flow da lech voi flow that. Voi file nhay cam nhu orchestrator, drift
  kieu nay lam nguoi sua sau de bo qua N10/N31 hoac dat stage sai thu tu.
- Cancellation da duoc thread vao Remotion render ops, nhung N10 typecheck sync
  van la khoang "khong phan hoi" co chu dich.

Huong don dep an toan:

1. Slice dau tien nen chi sua comment/header cho dung flow hien tai.
2. Sau do moi tach cac stage local, vi du `runAuthoringGates`,
   `runTtsAndLock`, `runPreRenderGates`, `runReviewAndRenderOracles`, neu test
   hien co bao phu du.
3. Dung tach kieu doi data-flow lon. Orchestrator la sensitive file da duoc
   contract canh bao.
4. Can co mot huong xu ly cho N10 sync block: worker thread, child process, hoac
   it nhat UI message "dang typecheck, nut dung se co hieu luc sau buoc nay".

## Finding 3 - WorkspaceController Van La State-Machine Godfile

Muc do: Cao  
File: `apps/desktop/src/main/workspace/workspace-controller.ts`  
Metric: 982 dong, test rieng 1,203 dong.

Bang chung:

- `workspace-controller.ts:114-151` khai bao nhieu state map trong bo nho:
  stages, inputs, pending review, render versions, in-flight jobs, aborters.
- `workspace-controller.ts:266-325` nam flow create/crawl/image-review/script
  handoff.
- `workspace-controller.ts:372-393` nam publish/full render.
- `workspace-controller.ts:406-534` nam user edit -> snapshot -> reauthor ->
  stills-first refine -> draft re-render -> rollback khi loi.
- `workspace-controller.ts:619-759` nam vision pass/refine loop va rollback
  policy.
- `workspace-controller.ts:791-836` nam draft render voi pre-refine va fallback.
- `workspace-controller.ts:917-942` recover stage tu disk sau restart/failure.
- `workspace-controller.ts:961-1017` delete/thumbnail path cung phai don cac map
  in-memory.

Vi sao kho kiem soat:

- Day la mot state machine song trong mot class dai. Tinh nang moi nhu SFX,
  speech-synced visuals, advanced settings, hoac queue/bulk render rat de them
  state map moi roi quen cleanup/recover.
- Cac recovery path co chu dich degrade: vi du retry sau restart co the rehydrate
  text/link tu brief nhung khong giu create-time images. Dieu nay dung hien tai,
  nhung can duoc ton trong khi sua.
- Docs hien tai dung khi noi khong nen tiep tuc extract chi de giam line count;
  phan con lai chu yeu la async orchestration that.

Huong don dep an toan:

1. Khong big-bang tach controller.
2. Neu refactor, tach cac "policy/pure mapper" truoc: stage transition helpers,
   retry eligibility, cleanup list, thumbnail state shaping.
3. Neu cham vao edit/refine/publish, viet test theo workflow truoc, vi do la
   noi co nhieu rollback va cancel nhat.
4. Can mot state transition table nho trong docs hoac test fixture de giam viec
   phai doc ca file moi hieu stage nao di den stage nao.

## Finding 4 - Render Oracle Posture De Gay Hieu Nhau

Muc do: Trung binh/Cao  
File: `packages/pipeline/src/safety/render-grid.ts` va wiring trong
`packages/pipeline/src/orchestrator.ts`.

Bang chung:

- `render-grid.ts:39-51` noi `runRenderGrid` auto-run mot so oracle, trong khi
  N15/N17/N23 can input khac nen khong auto-run tu midpoint still.
- `render-grid.ts:951-974` `RENDER_ORACLES` la registry cho `runRenderGrid`, gom
  ca manual entries `safe-area`, `late-safe-area`, `overlap`, `truncation`,
  `richness`.
- `render-grid.ts:491-548` `checkTruncation` mac dinh severity `"error"` nhung
  `runTruncationForScene` mac dinh `"warning"`.
- `orchestrator.ts:704-749` lai wire N15 overlap va N17 truncation ben ngoai
  `runRenderGrid`, voi posture warning.
- `orchestrator.ts:755-785` wire late safe-area ben ngoai `runRenderGrid`, cung
  la warning va best-effort.
- `render-grid.ts:810-850` N23 richness co implementation, nhung van can
  chronological multi-frame samples.

Vi sao kho kiem soat:

- Mot nguoi doc "registry is single source of truth" co the hieu nham la tat ca
  oracle live deu nam trong `runRenderGrid`, trong khi mot so pass live nam trong
  orchestrator.
- Severity cua cung mot check co the khac nhau tuy caller. Day la dung co chu
  dich, nhung neu khong ro posture thi rat de nang warning thanh error hoac
  nguoc lai o sai layer.
- N14/N15/N17/N23 hien co nhieu trang thai: auto midpoint, live external pass,
  manual/exported, warning/advisory, hard error historical default.

Huong don dep an toan:

1. Tach khai niem thanh 3 nhom ro: `autoMidpointOracles`,
   `externalRenderPasses`, `manualOracleDefinitions`.
2. Hoac giu file nhung them bang posture gan dau file: check nao auto-run, check
   nao orchestrator-run, check nao exported-only, severity mac dinh/effective.
3. Neu thay doi severity, test phai assert effective severity o caller, khong chi
   test helper rieng.

## Finding 5 - N10 Typecheck Co Safety-Hole Co Chu Dich Khi Degrade

Muc do: Trung binh/Cao  
File: `packages/pipeline/src/safety/typecheck-authored.ts`.

Bang chung:

- `typecheck-authored.ts:46-49` noi neu khong resolve duoc MotionReal sources,
  check degrade thanh no-op va chi chay khi co the chay dung.
- `typecheck-authored.ts:117-129` neu thieu `packages/blocks/src/index.ts`,
  code log warning va `return []`.
- `typecheck-authored.ts:120-123` comment goi day la "SILENT SAFETY HOLE" trong
  packaged app: wrong-shape prop co the lot qua den render va crash Chromium.
- `typecheck-authored.ts:145-149` neu setup typecheck fail, code cung warn va
  `return []`.
- `orchestrator.ts:409-417` N10 duoc dat truoc TTS de tranh ton tien khi scene
  sai prop type.

Vi sao kho kiem soat:

- Hanh vi degrade la co chu dich de tranh block render boi false module
  resolution, nhung no cung co nghia la mot packaged layout sai co the mat mot
  guard quan trong ma UI/safety report khong nhin thay, ngoai log.
- Neu nguoi dung gap crash render, bao cao safety co the khong noi "N10 da bi
  skip" vi function tra `[]`.

Huong don dep an toan:

1. Khong bien degrade thanh hard fail ngay lap tuc, vi comment giai thich ly do
   khong block render.
2. Nen surface degrade thanh diagnostic co cau truc: doctor/startup warning,
   settings/debug panel, hoac safety warning non-blocking.
3. Packaged build nen co test/doctor xac minh N10 source map hoac bundled d.ts
   co the resolve.

## Finding 6 - Electron Main Index Van La High Fan-In Root

Muc do: Trung binh  
File: `apps/desktop/src/main/index.ts`  
Metric: 484 dong, 31 import.

Bang chung:

- `index.ts:1-47` import rat nhieu domain: Electron, pipeline, gateway,
  authoring backend, worker, license, workspace, create, settings, staging, BGM,
  export, media protocol, security.
- `index.ts:76-95` construct settings store va legacy settings path.
- `index.ts:99-148` tao tools va authoring backend.
- `index.ts:154-202` construct `WorkspaceController` voi nhieu dependency
  adapters.
- `index.ts:210-250+` construct create controller va asset promotion.
- `index.ts:350-427` dang ky IPC handlers cho license, AI, project, thumbnail,
  script, review, settings, TTS.
- `index.ts:468-519` van giu Electron lifecycle/startup.

Vi sao kho kiem soat:

- File nay khong phai bug hien tai. Docs dung khi noi no la composition root.
  Nhung moi tinh nang moi neu cu them direct import + handler vao day thi root se
  phinh nhanh.
- Da co helper domain nhu `bgm-handlers`, `native-save`, `create-ipc`,
  `startup-sequence`; huong do la tot va nen tiep tuc.

Huong don dep an toan:

1. Khong move Electron lifecycle ra ngoai chi de giam dong.
2. Moi feature moi nen uu tien them handler factory/domain adapter rieng roi
   spread vao `handlers`, giong BGM/export da lam.
3. Settings moi nen di qua `SettingsStore`/shared model, tranh them state global
   moi trong index.

## Finding 7 - CSS Renderer La Monolith Lon Nhat Repo

Muc do: Trung binh  
File: `apps/desktop/src/renderer/theme.css`  
Metric: 2,223 dong.

Bang chung:

- `theme.css:9+` chua token/root theme.
- `theme.css:151+` bat dau layout/component classes.
- `theme.css:300+` buttons, cards, inputs.
- `theme.css:449+` create hero/composer.
- `theme.css:667+` style modal.
- `theme.css:762+` settings tabs/toggles/account UI.
- `theme.css:1058+` project card/thumbnail.
- Sau do tiep tuc workspace/storyboard/BGM/publish/review styles trong cung file.

Vi sao kho kiem soat:

- Day la file lon nhat repo va la global CSS namespace. Thay doi UI cuc bo de
  anh huong ngoai y muon den view khac.
- Khi them setting moi, project card moi, workspace stage moi, kha nang cao la se
  tiep tuc day them selector vao file nay.
- Khong co dau hieu CSS "sai" ngay, nhung day la debt ve maintainability va UI
  regression risk.

Huong don dep an toan:

1. Tach theo layer/view nhung giu mot entry import: `base.css`, `shell.css`,
   `home.css`, `workspace.css`, `settings.css`, `components.css`.
2. Khong doi class names trong slice dau; chi move nguyen khoi section de giam
   rui ro.
3. Sau split, dung screenshot/manual UI check cho Home, Workspace, Settings,
   Storyboard/Review.

## Finding 8 - Renderer Va TTS La Domain Hubs Lon, Nen Tach Sau Cac File Cao Hon

Muc do: Trung binh/Thap  
Files:

- `packages/pipeline/src/render/renderer.ts` - 763 dong.
- `packages/tts/src/index.ts` - 809 dong.

Bang chung renderer:

- `renderer.ts:183-229` render MP4.
- `renderer.ts:260-336` render per-scene stills va late samples.
- `renderer.ts:360-413` strict runtime probe.
- `renderer.ts:451-523` layout measure probe.
- `renderer.ts:535-575` render same frame twice cho determinism.
- `renderer.ts:591-620` bundle-cache comment va assumption render serial.
- `renderer.ts:671-749` prepare composition, ensure browser, bundle/select cache.

Bang chung TTS:

- `tts/index.ts` gom ca type, Vivibe/ElevenLabs config, ElevenLabs alignment to
  SRT, audio duration, mock audio, concat, normalize duration, BGM mix, HTTP
  retry, SRT URL discovery, ffprobe/ffmpeg helpers.
- `tts/index.ts:442-485` alignment/SRT timestamp handling.
- `tts/index.ts:496-631` audio duration/concat/normalize/mix.
- `tts/index.ts:669-740` normalize audio response, download audio/text, SRT URL.
- `tts/index.ts:742-778` retry/backoff.

Vi sao kho kiem soat:

- Renderer co nhieu cache/module-root assumptions. Day la tot cho performance,
  nhung neu sau nay co parallel render, queue, hoac packaged path moi thi can
  doc rat ky.
- TTS dang la diem lien quan truc tiep den future speech-synced visuals/caption
  timing. Neu them word/phoneme timing ma tiep tuc chen vao `index.ts`, file se
  thanh mot godfile thu hai cua media pipeline.

Huong don dep an toan:

1. De sau `ninerouter-backend` va docs/comment drift.
2. Renderer: tach cache/preparation helpers truoc, khong doi render behavior.
3. TTS: tach provider clients (`vivibe-client`, `elevenlabs-client`), audio ops
   (`audio-ops`), caption/SRT helpers (`srt`).
4. Bat buoc giu cache key va output artifact contract khong doi trong slice dau.

## Finding 9 - Repair Budget Clamp Bi Chia Giua Settings Va Engine

Muc do: Thap/Trung binh  
Files:

- `apps/desktop/src/shared/settings-model.ts`
- `apps/desktop/src/main/settings/settings-store.ts`
- `apps/desktop/src/main/agent/repair-loop.ts`

Bang chung:

- `settings-model.ts:103-106` noi `normalizeSettings` da bi remove va production
  path khong clamp `maxRepairAttempts`; clamp cu la divergence.
- `settings-store.ts:185-199` `update` merge patch, clamp `refinePasses`, nhung
  khong clamp `maxRepairAttempts`.
- `settings-store.test.ts:158-171` test co chu dich: "maxRepairAttempts NOT
  clamped".
- `repair-loop.ts:15-23` engine clamp `maxAttempts` vao `[1,10]`, non-finite ve 3.

Vi sao kho kiem soat:

- Hanh vi engine an toan vi repair loop co clamp. Tuy nhien settings persisted
  co the hien/luu mot gia tri khac voi gia tri engine thuc su dung.
- Neu UI sau nay hien "99 attempts" trong khi engine chi dung 10, nguoi dung va
  dev co the debug sai.

Huong don dep an toan:

1. Neu muon giu behavior hien tai, expose "effective repair attempts" trong UI
   hoac helper shared.
2. Neu muon product don gian hon, chuyen clamp vao SettingsStore va update test
   co chu dich. Khong sua ngam vi test hien dang khoa behavior cu.

## Finding 10 - Thumbnail Render Tam Ghi Lock That, Nhung Da Co Guard

Muc do: Thap/Trung binh  
File: `packages/pipeline/src/render/render-thumbnail.ts`.

Bang chung:

- `render-thumbnail.ts:14-18` comment noi `renderProjectStills` ghi temporary
  no-audio lock vao normal lock path, nen wrapper snapshot/restore lock va dua
  vao workspace serialization de khong render khac thay lock tam.
- `render-thumbnail.ts:30-33` public `renderThumbnail` boc bang
  `withProjectRenderLock(projectId, "thumbnail", ...)`.
- `render-thumbnail.ts:52-64` `finally` restore lock cu hoac xoa lock tam.

Vi sao kho kiem soat:

- Mau "tam ghi vao artifact canonical roi restore" la mau nguy hiem neu caller
  nao bypass wrapper hoac neu sau nay co parallel project work khong cung lock.
- Hien tai khong phai bug ro rang vi da co project lock va restore trong
  `finally`.

Huong don dep an toan:

1. Giu `renderThumbnailUnlocked` private.
2. Neu sau nay cham vao stills/thumbnail, can uu tien cho stills path ghi lock
   tam rieng thay vi normal `video-spec.lock.json`.
3. Test nen cover lock restore khi `renderProjectStillsUnlocked` throw.

## Non-Findings / Hit Can Khong Don Nham

Nhung hit sau co ve la legacy/compat co chu dich, khong nen xoa trong dot cleanup
chung:

- `NewsVideo`:
  - `apps/remotion/src/Root.tsx:18`
  - `packages/pipeline/src/authoring/authored-entry.ts:55`
  Day co ve la composition id compatibility alias.
- `news-studio-settings.json`:
  - `apps/desktop/src/main/index.ts:77`
  - `apps/desktop/src/main/settings/settings-store.test.ts`
  Day la legacy settings migration path.
- `youtube`:
  - `AI_CONTRACT.md:12-14` noi YouTube 16:9 plumbing co ton tai, nhung long-form
    workflow chua on dinh.
  - `docs/current/youtube-mode-deferred.md` la roadmap deferred, khong phai active
    scope.
- "template catalog":
  - Hit trong `AI_CONTRACT.md` va `README.md` la prohibition/canonical contract,
    khong phai stale implementation.

## Thu Tu Refactor De Xuat

1. Sua drift comment trong `orchestrator.ts` de flow doc trong code khop voi N10,
   N31, review/oracle order hien tai. Slice nho, rui ro thap.
2. Them diagnostic cho N10 degraded no-op. Muc tieu la nhin thay trong safety
   report/doctor/startup, khong can hard-fail.
3. Tach `ninerouter-backend.ts` theo runner/service nho, giu public class va
   tests. Day la loi ich lon nhat tren rui ro vua phai.
4. Lam ro posture cua `render-grid.ts` va external oracle passes. Co the la doc
   table truoc, code split sau.
5. Chi quay lai `workspace-controller.ts` khi co slice workflow ro, vi phan con
   lai chu yeu la orchestration that.
6. Tiep tuc rut `index.ts` bang feature handler factories khi them tinh nang moi,
   khong move lifecycle root.
7. CSS split co the lam rieng sau, theo move-only section va screenshot check.
8. Renderer/TTS split de sau, nhat la truoc khi lam speech-synced visuals thi nen
   tach TTS provider/audio/SRT helpers de tranh phinh `tts/index.ts`.

## Rui Ro Neu Them Tinh Nang Moi Ngay

Neu tiep tuc lam SFX hoac speech-synced visuals truoc cleanup, nhung diem can
canh giac:

- SFX co kha nang cham `SettingsStore`, renderer spec/lock, composition runtime,
  TTS/audio mix, va workspace stage. Neu khong tach scope, no de chen them vao
  `orchestrator.ts`, `workspace-controller.ts`, `tts/index.ts`.
- Speech-synced visuals co kha nang cham caption timing, lock spec, authored scene
  props, prompt, admission/typecheck, va visual rendering. Day la ly do nen tach
  TTS/SRT helpers va thiet ke scene timing API truoc khi code.
- Moi setting moi nen vao shared settings model + SettingsStore + handler/view,
  tranh them global state trong `index.ts`.

## Trang Thai Docs Sau Audit

- `AI_CONTRACT.md`, `docs/current/architecture.md`, va
  `docs/current/maintenance.md` dang phan anh dung ban chat du an: pure AUTHOR,
  no template catalog, YouTube deferred, sensitive files.
- Drift chinh can sua nam trong comment cua `orchestrator.ts`, khong phai docs
  current.
- Khong thay doc nao dang mo duong sai cho template catalog/theme/block authored
  mode.

## Kiem Tra Can Chay Sau Bao Cao

Bao cao nay la docs-only. Kiem tra toi thieu sau khi tao file:

```powershell
npm.cmd run typecheck
npm.cmd test
git diff --check
```

Neu full test lane flake o heavy N10 test, theo maintenance/memory truoc day nen
rerun focused file roi rerun full suite voi `--maxWorkers=1`.
