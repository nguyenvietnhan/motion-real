# Design Document

## Overview

Spec này đưa `apps/desktop` từ **scene-kit (PICK-mode trá hình)** về **pure
AUTHOR mode** và bổ sung **vòng agent tự-sửa (self-repair)** thật. Thiết kế bám
nguyên các seam đã có (đã đọc trực tiếp từ source) để thay đổi là **khu trú**:

- `AuthoringBackend` (interface ở `agent/custom-loop-worker.ts`) **không đổi chữ
  ký** — chỉ phần hiện thực `NineRouterAuthoringBackend` được viết lại từ
  "chọn kit + điền props" sang "nhận `.tsx` AI viết → ghi file → admit".
- `AgentWorker`/`CustomLoopAgentWorker`/`repair-loop.ts` giữ orchestration; chỉ
  bổ sung định tuyến lỗi (Error_Classifier) và làm `reauthor` thành thật.
- `WorkspaceController` giữ máy trạng thái staged; thêm một hành động
  `fixWithAi` + cờ `fixable` trên stage `error`.
- Engine (`@news/pipeline`) chỉ thêm **một seam tối thiểu**:
  `unregisterComponent(id)` ở `@news/compositions` để reauthor re-admit đúng mã
  mới (registry hiện ném lỗi khi trùng id — đã xác minh ở `registry.ts`).

Hai trục bám hai sự thật đã xác minh trong code:

1. **Render đọc CODE từ đĩa, không từ registry Node.** `renderProject` bundle
   các `authored/*.tsx` qua webpack (entry `_entry.tsx`); registry Node chỉ phục
   vụ admission/validation. ⇒ Ghi đè file `.tsx` rồi render lại là cách
   self-repair hợp lệ. (Điều kiện: re-admit phải thấy mã mới — xử lý bằng
   `unregisterComponent`.)
2. **Loader `.tsx` đã có** (`tsx-loader.ts` + `setAuthoredLoader` process-wide ở
   `index.ts`), nên admission trong Electron đã chạy được. Pure-author chỉ là
   "đổi nguồn `.tsx`": thay vì lấy từ `SCENE_KIT`, lấy từ reply của AI.

### Nguyên tắc thiết kế

- **Không fallback template** (R1.6): mọi thất bại author/admission → stage
  `error` có đường phục hồi, KHÔNG âm thầm dựng kit.
- **Redact chỉ ở biên UI** (R5.5): agent (model) nhận được thông tin kỹ thuật
  đầy đủ (N-code, message, mã `.tsx`, ảnh still) vì nó cần để sửa; chỉ thông
  điệp tới renderer/IPC mới qua `stripL0Tokens`.
- **Thuần & test được**: parser reply, prompt builder, Error_Classifier,
  resolve sceneId→file là hàm thuần → property/unit test không cần model thật.

---

## Architecture

### Luồng author (pure-author)

```
CreateController.create(raw)
  → WorkspaceController.beginScript(id, input)   [stage: writing]
    → worker.author(job)
      → NineRouterAuthoringBackend.authorScenes(job)
         1. (URL) ingest_url → research text
         2. buildAuthorMessages(input, research)   ← prompt = Authoring_Contract + AI_Output_Contract
         3. client.chat(model, messages)            ← MỘT reply
         4. parseAuthorReply(reply)                 ← manifest JSON + N khối .tsx, khớp theo id
         5. ghi authored/<id>.tsx cho từng module + manifest.json (id mở)
         6. admitProjectScenes(id, { load: loadAuthoredTsx })   ← N4/N5 + handshake
            - fail → { scenes: [], message }  (KHÔNG kit fallback)
      → (scriptGate) stage: script  |  else → runRender
```

### Luồng render + repair (generate-validate-repair)

```
WorkspaceController.runRender(id)                  [stage: rendering %]
  → worker.generateValidateRepair(id, {maxAttempts})
     loop ≤ maxAttempts:
       renderDraft(id)            (render_draft, concurrency 2)
       getSafetyReport(id)        (hard errors trừ N24/N25)
       ok? → passed
       else:
         classify mỗi hard error  → Error_Classifier
         Infra_Error có mặt?      → dừng loop, trả 'infra' (không phí lượt reauthor)
         Content_Error            → reauthor(flaggedSceneIds) → render lại
  passed  → stage: ready (storyboard)
  infra   → stage: error (fixable:false) — "Thử lại"
  exhausted→ stage: error (fixable:true)  — "Thử lại" + "Sửa bằng AI"
```

### Luồng "Sửa bằng AI" (AI_Fix_Action)

```
Renderer (stage error, fixable:true) → bấm "Sửa bằng AI"
  → IPC "projects:fixWithAi"(projectId)            ← kênh mới trong allow-list
  → WorkspaceController.fixWithAi(projectId)        [stage: rendering %]
     - worker.generateValidateRepair(id, {maxAttempts})   ← TÁI DÙNG đúng vòng repair
       (vòng này tự render draft → đọc report → reauthor cảnh content → render lại)
  → ready | error theo kết quả
```

> fixWithAi KHÔNG tự đọc `safety-report.json`: `generateValidateRepair` đã render
> lại để lấy report tươi rồi reauthor. UI không bao giờ cầm sceneId/N-code.

### Bản đồ thay đổi theo package

| File | Thay đổi |
| --- | --- |
| `authoring/manifest-schema.ts` | Bỏ `KIT_COMPONENT_IDS` enum → `component` id mở; tách parser reply (manifest + code blocks). |
| `authoring/reply-parser.ts` (mới) | `parseAuthorReply` / `parseReauthorReply`: trích manifest JSON + nhiều khối `.tsx`, khớp theo id. |
| `authoring/prompt.ts` | `buildAuthorMessages` nhúng Authoring_Contract + AI_Output_Contract; thêm `buildReauthorMessages`. |
| `authoring/contract-text.ts` (mới) | Hằng chuỗi contract (export/import-whitelist/banned/blocks/zones/design/captions/determinism) — nguồn cho prompt. |
| `authoring/ninerouter-backend.ts` | `authorScenes` pure-author; `reauthor` thật (resolve file → prompt → ghi đè → re-admit); `renderDraft`/`getSafetyReport` giữ. |
| `authoring/scene-files.ts` (mới) | `sceneFileName(id)`, `resolveSceneFile(projectId, sceneId)` (manifest → component id → path). |
| `agent/error-classifier.ts` (mới) | `classifyIssue(SafetyIssue)`, `classifyError(SerializedPipelineError)` → `"infra" \| "content"`. |
| `agent/repair-loop.ts` | Phân loại hard errors; gặp Infra_Error → trả `infra`; chỉ reauthor scene Content_Error. |
| `agent/agent-worker.ts` | `RepairOutcome` thêm nhánh `infra`; `reauthor` mang `issues` (loại lỗi + still). |
| `gateway/ninerouter-client.ts` | `chat` nhận `content` đa phần (text + image_url) cho vision-guided repair; degrade text-only. |
| `workspace/workspace-controller.ts` | `fixWithAi(projectId)`; stage `error` mang `fixable`. |
| `shared/types.ts` | `ProjectStage.error` + `FriendlyError` thêm `fixable?: boolean`. |
| `shared/channels.ts` | thêm `"projects:fixWithAi"`. |
| `main/index.ts` + `preload` | đăng ký handler + bridge kênh mới. |
| `renderer` (views) | nút "Sửa bằng AI" khi `fixable`. |
| `@news/compositions/registry.ts` | thêm `unregisterComponent(id)` (seam tối thiểu cho re-admit). |
| `authoring/starter-kit.ts` | gỡ khỏi đường production (xem §Disposition). |

---

## Components and Interfaces

### 1. AI_Output_Contract + ReplyParser (R1.7)

**Vấn đề:** nhúng `.tsx` (nhiều dòng, dấu nháy) vào JSON string rất dễ hỏng
escape. **Quyết định:** tách *metadata* (JSON, dễ máy đọc) khỏi *code* (code
fence, không escape). AI trả về MỘT reply gồm:

1. Đúng một khối ```json — **manifest** (không chứa code):
   ```json
   {
     "title": "…",
     "theme": { "dominant": "#RRGGBB", "mood": "…" },
     "scenes": [
       { "component": "hook-eye", "eyebrow": "…", "headline": "…",
         "narration": "…", "props": { … }, "transitionToNext": "slide" }
     ]
   }
   ```
2. Mỗi **component id duy nhất** một khối ```tsx, dòng đầu là marker
   `// component: <id>`, thân là module `.tsx` đầy đủ theo Authoring_Contract.

**Parser** (`reply-parser.ts`, thuần):

```ts
export type AuthoredModule = { id: string; code: string };
export type ParsedAuthorReply =
  | { ok: true; manifest: AuthorManifest; modules: AuthoredModule[] }
  | { ok: false; reason: ParseReason; detail: string };
export type ParseReason =
  | "no-manifest" | "manifest-invalid" | "no-code"
  | "missing-code"   // có scene tham chiếu id chưa có khối code
  | "id-mismatch";   // marker ≠ id literal trong registerComponent

export function parseAuthorReply(text: string): ParsedAuthorReply;
```

Thuật toán:
- Trích manifest JSON bằng `extractJsonObject` (đã có) trên khối ```json đầu;
  validate qua `authorManifestSchema` (đã sửa, §2).
- Trích **mọi** khối ```tsx (regex fence toàn cục). Với mỗi khối: đọc id từ
  marker `// component:`; đối chiếu với id literal trong
  `registerComponent({ id: "…" })` (regex `id\s*:\s*"([^"]+)"`). Lệch → `id-mismatch`.
- Tập id code phải **phủ** tập `manifest.scenes[].component` (unique). Thiếu →
  `missing-code`. Cho phép code dư (bỏ qua, log).
- Trùng id giữa các scene là HỢP LỆ (một visual dùng lại nhiều beat) → vẫn ghi
  một file.

`parseReauthorReply(text, expectId)` dùng lại lõi: yêu cầu đúng một khối ```tsx,
id literal phải `=== expectId`.

### 2. manifest-schema: id mở (R1.8)

```ts
// BỎ KIT_COMPONENT_IDS enum.
const componentId = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/,
  "component id: chữ thường, số, gạch ngang");
export const authorSceneSchema = z.object({
  component: componentId,
  eyebrow: z.string().min(1).max(24),
  headline: z.string().min(1).max(120),
  narration: z.string().min(1).max(600),
  props: z.record(z.string(), z.unknown()).default({}),
  transitionToNext: transition.optional(),
  body: z.string().max(200).optional(),
});
export const authorManifestSchema = z.object({
  title: z.string().min(1).max(160),
  theme: z.object({ dominant: z.string().min(1), mood: z.string().min(1) }),
  scenes: z.array(authorSceneSchema).min(3).max(14),
});
```

`extractJsonObject`/`parseAuthorManifest` cũ được giữ nhưng chuyển vai trò: chỉ
còn validate **manifest** (không kèm code); việc tách code thuộc `reply-parser`.

### 3. Prompt builder (R1.5, R7.5)

`contract-text.ts` export `AUTHORING_CONTRACT` — hằng chuỗi cô đọng nhưng **đầy
đủ** từ `authoring-contract.md` (inline để không đọc fs trong main đã bundle, và
để deterministic):
- export bắt buộc (`default`=registerComponent, `schema`, `example` phải khớp schema);
- import whitelist: chỉ `react`, `remotion`, `@news/design`, `@news/blocks`,
  `@news/compositions`, `zod`;
- banned APIs (N5): `Math.random`/`Date`/`fetch`/`eval`/`require`/`import()`/
  `fs`/`process`/`window.location`/`dangerouslySetInnerHTML` — dùng
  `useCurrentFrame`+`interpolate`/`spring`, `random(seed)`;
- compose `@news/blocks` (`Frame`,`Story`,`Content`,`TitleBlock`,`Panel`,
  `KeyPoints`,`StatBlock`,`Callout`,`CountUp`…); KHÔNG tự render caption;
- layout zones (content-zone trên, chừa caption band + UI reserve; không tràn
  qua đường kẻ đen — N14 hard);
- design language: cream/ink, vuông (radius 0), viền 4px, accent theo
  `useTheme()`;
- captions sinh trung tâm từ `narration` — không để text phụ đề trong props;
- determinism + motion (entrance settle, không dao động vĩnh viễn);
- visualize diversely: mỗi cảnh một form, bespoke SVG/CSS cho beat chữ ký, không
  lặp một block.

`buildAuthorMessages(input, research)`:
- system = vai biên tập + QUY TẮC NỘI DUNG (digits, không bịa, hook, CTA) +
  `AUTHORING_CONTRACT` + đặc tả AI_Output_Contract (manifest JSON + khối ```tsx
  marker) + ví dụ rút gọn một module hợp lệ.
- user = nguồn (URL+research / topic) + "viết kịch bản + code từng cảnh".

`buildReauthorMessages({ sceneId, componentId, currentCode, issues, stillDataUrl? })`:
- system = `AUTHORING_CONTRACT` (rút gọn) + "bạn đang SỬA một cảnh".
- user (đa phần khi có ảnh):
  - text: liệt kê issue kỹ thuật (check + message, ví dụ "N14 @scene-03: content
    overflows caption clearance"), kèm mã `.tsx` hiện tại; yêu cầu trả về DUY
    NHẤT một khối ```tsx (cùng id), giữ ý/nội dung, sửa lỗi bố cục/tương phản.
  - image_url (nếu `stillDataUrl`): ảnh still cảnh lỗi (R3.7).

**Chi phí (R7.5):** prompt author lớn (toàn contract). Reauthor chỉ gửi 1 cảnh →
chặn chi phí; tài liệu hoá trong README/Settings tooltip "một lượt sửa gửi lại
toàn bộ hướng dẫn nên có thể mất ~chục giây".

### 4. NineRouterAuthoringBackend (R1.1–R1.4, R1.6, R3)

`authorScenes(job)` (viết lại):
```
model? → guard
research (URL)
reply = client.chat(model, buildAuthorMessages(...))
parsed = parseAuthorReply(reply)
  !ok → log raw + return { scenes:[], message: "AI trả về chưa hợp lệ (reason)" }
for m in parsed.modules:
  unregisterComponent(m.id)                          // tránh đụng id còn sót trong registry process-wide (xem §Cross-project ids)
  writeAuthoredScene(id, sceneFileName(m.id), m.code)
engineManifest = toEngineManifest(parsed.manifest)   // id mở, clamp theme/title
writeJson(manifestPath, engineManifest)
admitted = admitProjectScenes(id, { load: loadAuthoredTsx })
  !ok → log violations + return { scenes:[], message:"Một số cảnh chưa hợp lệ." }
return { scenes: engineManifest.scenes.map(stillPath) }
```
- `toEngineManifest` giữ nguyên (đã clamp mood≤40/title≤140/hex); chỉ khác:
  `component` lấy thẳng id AI đặt (không map kit).
- KHÔNG còn `SCENE_KIT`/`used`/`known` — bỏ nhánh ghi kit.

`reauthor(projectId, targets)` (thật, R3.1–R3.6, R3.8) — `targets: ReauthorTarget[]`,
`ReauthorTarget = { sceneId; issues?: SafetyIssue[]; intent?: string }`:
```
for t in targets:
  resolved = resolveSceneFile(projectId, t.sceneId)   // manifest → component id → authored/<id>.tsx
    !resolved → log + continue (lần thử tính fail, R3.8)
  { componentId, path } = resolved
  originalCode = read(path)                            // GIỮ để rollback (atomicity)
  still = needsVision(t.issues) ? toDataUrl(review/<t.sceneId>.png) : undefined   // N14/N18
  reply = client.chat(model, buildReauthorMessages({ sceneId, componentId, currentCode: originalCode, issues: t.issues, intent: t.intent, still }))
  parsed = parseReauthorReply(reply, componentId)
    !ok → log + continue
  write(path, parsed.code)            // ghi đè CHỈ cảnh này (R3.3)
  unregisterComponent(componentId)    // để re-admit thấy mã mới (registry ném khi trùng)
  re = admitAndRegisterAuthored(path, { load: loadAuthoredTsx })
    !re.ok →                          // R3.5: KHÔNG crash, ROLLBACK cảnh để project vẫn dựng được
      write(path, originalCode); unregisterComponent(componentId);
      admitAndRegisterAuthored(path, { load: loadAuthoredTsx })   // khôi phục registry về bản cũ
      log violations + continue
return { scenes: reauthoredOk.map(stillPath) }
```
- **Atomicity (R3.5):** một lần reauthor hỏng admission **không** làm hỏng cảnh
  đang chạy — file + registry được khôi phục về bản trước đó, project vẫn render
  được ở lượt sau; lần thử đó tính fail theo budget.
- **Chữ ký `AuthoringBackend.reauthor` đổi** từ `(projectId, sceneIds, preprompt)`
  sang `(projectId, targets: ReauthorTarget[])`. `repair-loop` gom hard errors
  theo sceneId → `targets` (kèm `issues`). Đường **manual visual-edit** (Req 8.7
  web-dashboard, `reauthorScenes`) hiện **chưa wire trong desktop** (review:submitEdits
  là stub) ⇒ NGOÀI phạm vi spec này; nếu cần sau, nó truyền `intent` thay cho
  `issues`. `PrepromptPayload` di sản giữ lại nhưng không dùng cho path-X.

`needsVision(issues)` = có check ∈ {N14, N18} (R3.7). Còn lại text-only.

### 5. scene-files.ts (R3.8)

```ts
export function sceneFileName(componentId: string): string {
  return `${componentId.replace(/[^a-z0-9-]/gi, "-")}.tsx`; // không bắt đầu "_"
}
export async function resolveSceneFile(projectId, sceneId, loadManifest):
  Promise<{ componentId: string; path: string } | null> {
  const m = await loadManifest(projectId);
  const scene = m.scenes.find(s => s.id === sceneId);
  if (!scene) return null;
  const path = join(projectPaths(projectId).authoredDir, sceneFileName(scene.component));
  return existsSync(path) ? { componentId: scene.component, path } : null;
}
```
Thuần (inject loadManifest) → test được; `sceneId`→`component`→file rõ ràng,
không nhầm cảnh khác.

### 6. Error_Classifier (R4.1–R4.3, R4.5)

```ts
export type ErrorClass = "infra" | "content";

const CONTENT_CHECKS = new Set(["N3","N4","N5","N10","N14","N17","N18","N19","N20","N21","N22","N30"]);
const CONTENT_STAGES = new Set<PipelineStage>(["admission","static-grid","build-gate","determinism","render-oracle"]);

export function classifyIssue(issue: SafetyIssue): ErrorClass {
  return CONTENT_CHECKS.has(issue.check) ? "content" : "infra";
}
export function classifyError(e: SerializedPipelineError): ErrorClass {
  // 1) Infra rõ ràng: thiếu cấu hình/giọng, gateway/network, Chromium target-closed.
  if (e.stage === "config" || e.stage === "tts") return "infra";
  if (/target closed|ECONN|ENOTFOUND|gateway|fetch failed/i.test(e.cause)) return "infra";
  // 2) Content theo check.
  if (e.check && CONTENT_CHECKS.has(e.check)) return "content";
  // 3) Render-stage vỡ bundle do mã AI (esbuild/webpack) → content.
  if (e.stage === "render" && /transform failed|could not resolve|unexpected|syntaxerror|authored[\\/]/i.test(e.cause))
    return "content";
  if (CONTENT_STAGES.has(e.stage)) return "content";
  return "infra"; // mặc định an toàn: không phí lượt agent
}
```
- `render` stage là nhập nhằng: Chromium "Target closed" = infra; lỗi do mã
  cảnh thì đã bị bắt SỚM hơn ở admission (xem dưới) hoặc nổi lên ở render-oracle
  → content. Vì vậy `render` KHÔNG nằm trong CONTENT_STAGES (mặc định infra trừ
  khi `check` là content), NHƯNG cause của render-stage chứa chữ ký lỗi
  bundle/biên dịch (`Transform failed`, `Could not resolve`, `Unexpected`,
  `SyntaxError`, đường dẫn `authored/`) ⇒ phân là **content** (mã AI vỡ bundle).

**N10 / lỗi kiểu của mã AI (R4.5) — chính xác hoá:** `renderProject` **không**
chạy typecheck N10 (build gate chỉ N12/N13 + lint N5 — đã xác minh ở
`orchestrator.ts`). Thực tế:
- Lỗi **cú pháp / import sai / không resolve** của mã AI bị bắt **ở admission**:
  `loadAuthoredTsx` dùng esbuild bundle TỪNG module trong handshake, vỡ → admission
  trả vi phạm **N4** ("failed to load during the registration handshake") ⇒
  CONTENT ⇒ reauthor. Đây là cách R4.5 được thoả mãn trên thực tế (không phải
  một crash bundle khó hiểu ở stage render).
- Lỗi **type thuần** (không vỡ bundle, vì esbuild chỉ strip type) KHÔNG bị N4
  bắt và KHÔNG được thêm tsc vào hot-path render (nặng + runtime đã bundle không
  chắc có `tsc`). Phần lớn hệ quả thật của chúng vẫn bị render-oracle (N14/N18…)
  hoặc admission (props/example N3) chặn. Đây là **giới hạn có chủ đích**, ghi rõ
  ở đây; N10 vẫn nằm trong CONTENT_CHECKS để khi một caller (vd `npm run typecheck`
  ngoài app) báo N10 thì vẫn phân loại đúng là content.

Self-test (non-vacuous): fixture mỗi nhánh (một N14 issue→content, một
"Target closed" cause→infra, một config stage→infra, một N10→content).

### 7. repair-loop.ts (R3.4, R4.2, R7.3)

`RepairLoopDeps.reauthor` đổi chữ ký: `(flagged: {sceneId, issues}[]) => Promise<void>`.
`RepairOutcome` thêm nhánh:
```ts
export type RepairOutcome =
  | { kind: "passed"; attempts: number }
  | { kind: "exhausted"; attempts: number; remainingHardErrors: number }
  | { kind: "infra"; attempts: number };   // mới
```
Vòng lặp:
```
report = getSafetyReport()
ok? → passed
classes = report.hardErrors.map(classifyIssue)
if classes.includes("infra") → return { kind: "infra", attempts }   // không phí reauthor
content = hardErrors.filter(content)
onRepair(friendly) cho từng content
if attempts < max → reauthor(group content by sceneId) ; else exhausted
```
- Giữ ngữ nghĩa Property 5 (dừng ở report sạch trong budget).
- `infra` để WorkspaceController báo "Thử lại" (không hiện "Sửa bằng AI").

### 8. Vision client (R3.7)

Mở rộng `NineRouterClient.chat` để `content` của một message có thể là mảng
phần theo chuẩn OpenAI:
```ts
type Part = { type: "text"; text: string }
          | { type: "image_url"; image_url: { url: string } }; // url = data:image/png;base64,…
type ChatMessage = { role; content: string | Part[] };
async chat(model, messages, opts): Promise<string>   // body giữ {model, messages, stream:false}
```
- `image_url.url` là **data URL** đọc từ `review/<sceneId>.png` (cục bộ, không
  upload ngoài).
- **Degrade (R3.7):** nếu gọi có ảnh trả HTTP lỗi (model không nhận ảnh), bắt
  lỗi → log cảnh báo → gọi lại **text-only** (loại các phần image). Không crash.
- Path text-only hiện tại không đổi hành vi (content vẫn là string).

### 9. IPC: kênh "projects:fixWithAi" (R5.6)

- `shared/channels.ts`: thêm `"projects:fixWithAi"` vào `INVOKE_CHANNELS`.
- `preload`: đã expose theo allow-list (bridge generic theo `INVOKE_CHANNELS`),
  nên chỉ cần thêm vào mảng — kiểm chứng bằng client-channel-coverage test (R8.4).
- `index.ts` handler: `"projects:fixWithAi": (projectId) => { workspace.fixWithAi(String(projectId)); return undefined; }`.

### 10. WorkspaceController.fixWithAi + cờ fixable (R5.1–R5.4, R7.1)

- `ProjectStage` nhánh `error` thêm `fixable: boolean`:
  ```ts
  | { kind: "error"; message: string; fixable: boolean }
  ```
  `stageToFriendlyStatus` không đổi (vẫn "error").
- `runRender` đặt `fixable` theo outcome:
  - `exhausted` → `fixable: true` (Content_Error còn lại, agent thử được).
  - `infra` → `fixable: false`, message gợi ý tự xử lý (kiểm tra key/khởi động lại).
  - catch (exception) → phân loại qua `classifyError(serializeError(e))`:
    content→true, infra→false.
- `fixWithAi(projectId)`:
  ```
  setStage(rendering 0)
  outcome = worker.generateValidateRepair(projectId, {maxAttempts})  // tái dùng vòng repair
  passed → ready ; infra/exhausted → error(fixable theo loại)
  ```
  (Reauthor bên trong tự đọc safety-report đã lưu để biết cảnh/lỗi; không cần
  truyền payload lỗi từ renderer — tránh để UI cầm N-code.)
- `FriendlyError` (event) thêm `fixable?: boolean` để renderer render đúng nút.
- Chống bấm trùng (R5.4): khi đang `rendering`, nút bị disable; `fixWithAi` bỏ
  qua nếu stage hiện tại không phải `error`.

### 11. Renderer — nút "Sửa bằng AI" (R5.1–R5.4)

Màn workspace stage `error`:
- luôn có "Thử lại" (`projects:retry`) + "Quay lại".
- nếu `stage.fixable` → thêm nút **"Sửa bằng AI"** gọi `projects:fixWithAi`.
- khi chuyển sang `rendering` → hiện percent, ẩn/disable các nút.
- Mọi message đã redact ở main; renderer chỉ hiển thị.

### 12. Seam pipeline: unregisterComponent (R3.2)

`@news/compositions/registry.ts`:
```ts
export function unregisterComponent(id: string): void { registry.delete(id); }
```
Export ở `index.ts` + `@news/pipeline` re-export. Reauthor gọi trước re-admit để
mã mới (schema/example) được đăng ký lại đúng (registry hiện `throw` khi trùng
id — đã xác minh). Không ảnh hưởng đường `npx tsx` (R2.4): build script không
gọi reauthor.

### 13. Cross-project component ids (rủi ro pure-author)

Registry `@news/compositions` là **process-wide**. Kit cũ dùng id cố định
(`ns-stat`…) trùng nhau giữa mọi project nhưng vô hại vì mã đồng nhất.
Pure-author để AI tự đặt id → hai project khác nhau có thể cùng id `"hook"` với
mã KHÁC nhau. Vì `admitAndRegisterAuthored` **bỏ qua** đăng ký khi
`getComponent(id)` đã có, project sau sẽ validate manifest/props của mình trên
**schema của project trước** (sai).

- **Tác động giới hạn:** RENDER luôn đúng — `renderProject` bundle `_entry.tsx`
  của ĐÚNG project (webpack instance riêng), không đọc registry Node. Va chạm id
  chỉ ảnh hưởng VALIDATION phía Node (N3/example), không tạo video sai.
- **Khắc phục:** `authorScenes` gọi `unregisterComponent(id)` cho từng id manifest
  TRƯỚC `admitProjectScenes` (đã ghi trong §4) ⇒ registry luôn mang mã của
  project đang xử lý; vì desktop xử lý tuần tự từng project, validation luôn tươi
  ở thời điểm render của project đó.

---

## Verified facts (đã đọc source để chốt thiết kế)

- `orchestrator.ts` `renderProject`: (0) `admitProjectScenes(projectId)` (dùng
  loader process-wide đã set ở `index.ts`), (3) build gate = `runBuildGridStatic`
  (N12/N13) + `lintSceneSources` (N5) — **KHÔNG có N10/tsc**; sinh `_entry.tsx`
  qua `generateAuthoredEntry(authoredFiles)` rồi render bundle CÁC file đó ⇒
  ghi đè `.tsx` + render lại là self-repair hợp lệ.
- Bước (6) `buildReview` → `renderSceneStills` ghi `review/<sceneId>.png` (midpoint)
  và (7) `runRenderGrid({ framesDir: paths.reviewDir })` chạy N14/N18… trên các
  still đó ⇒ ảnh still cho vision repair có sẵn sau mỗi draft.
- `registry.ts`: `registerComponent` **ném** khi trùng id; `getComponent` đọc map
  ⇒ cần `unregisterComponent` cho reauthor/cross-project.
- `tsx-loader.ts` + `setAuthoredLoader(loadAuthoredTsx)` (index.ts) ⇒ admission
  trong Electron nạp được `.tsx`.
- `ninerouter-client.ts` `chat` hiện chỉ gửi `content: string` ⇒ cần mở rộng cho
  vision.

---

## Data Models

```ts
// reply-parser.ts
type AuthoredModule = { id: string; code: string };
type ParsedAuthorReply =
  | { ok: true; manifest: AuthorManifest; modules: AuthoredModule[] }
  | { ok: false; reason: ParseReason; detail: string };

// error-classifier.ts
type ErrorClass = "infra" | "content";

// agent-worker.ts
type RepairOutcome =
  | { kind: "passed"; attempts }
  | { kind: "exhausted"; attempts; remainingHardErrors }
  | { kind: "infra"; attempts };

// shared/types.ts
type ProjectStage = … | { kind: "error"; message: string; fixable: boolean };
type FriendlyError = { projectId?; message; retry?; fixable?: boolean };
```

`AuthoringBackend.reauthor` (đổi chữ ký):
```ts
type ReauthorTarget = { sceneId: string; issues?: SafetyIssue[]; intent?: string };
reauthor(projectId: string, targets: ReauthorTarget[]): Promise<{ scenes: AuthoredScene[] }>;
```

---

## Error Handling

| Tình huống | Phân loại | Hành vi |
| --- | --- | --- |
| Thiếu Vivibe key/voice (config/tts) | Infra | stage error, fixable:false, "kiểm tra Cài đặt giọng". |
| Gateway/network/HTTP, model lỗi | Infra | error, fixable:false, "Thử lại". |
| Chromium "Target closed" | Infra | error, fixable:false, "Thử lại" (giảm concurrency đã có). |
| Admission N4/N5 (mã AI: cú pháp/import/banned) | Content | reauthor scene lỗi (text). |
| Render-stage vỡ bundle (esbuild/webpack mã AI) | Content | reauthor scene lỗi (text). |
| Lỗi type thuần (không vỡ bundle) | — | KHÔNG auto-bắt (giới hạn có chủ đích); hệ quả thật thường bị oracle/N3 chặn. |
| Oracle N14/N18 | Content | reauthor scene lỗi (vision: kèm still). |
| Oracle N17/N19–N22/N30 | Content | reauthor scene lỗi (text). |
| Parser reply fail | Content (author) | stage error, fixable:false (chưa có cảnh để sửa) → "Thử lại". |
| reauthor vẫn fail sau N lượt | — | exhausted → error fixable:true, "đã thử N lần". |

- Log terminal (main) giữ chi tiết kỹ thuật (đã có `[authoring]`/`[render]`); UI
  chỉ thấy bản redact (R7.2).
- `stripL0Tokens` quét N-code/`.tsx`/MCP/stack/`{}` (đã có) — mọi message tới
  IPC đi qua nó.

---

## Disposition: Scene_Kit (R1.9)

`SCENE_KIT`/`KIT_COMPONENT_IDS` **gỡ khỏi đường production**:
- `ninerouter-backend.ts`, `prompt.ts`, `manifest-schema.ts` bỏ import
  `starter-kit`/enum.
- `starter-kit.ts`: **xoá** (không để code chết mơ hồ — bài học reconcile R5).
  Các build script `scripts/build-*.ts` là ví dụ pure-author tham khảo thật rồi;
  không cần kit. Test nào phụ thuộc kit sẽ được viết lại quanh
  `parseAuthorReply` + module mẫu nội bộ test.

> Quyết định: **xoá** thay vì giữ-kèm-ghi-chú, vì giữ kit dễ bị "lén" dùng lại
> và mâu thuẫn mục tiêu. Nếu sau cần "ví dụ khởi tạo", build script đã đóng vai
> đó.

---

## Correctness Properties

*Một property là hành vi phải đúng với MỌI input.* Mỗi property được kiểm bằng
một property-based test (≥100 run) kèm self-test non-vacuous.

### Property 1: Author-reply parse roundtrip

*For any* reply ghép từ một manifest hợp lệ + đủ khối ```tsx (marker khớp id
literal), `parseAuthorReply` trả `ok` và tập `modules` phủ đúng
`manifest.scenes[].component`; thiếu code một cảnh → `missing-code`; marker ≠ id
literal → `id-mismatch`. Không bao giờ trả `ok` mà thiếu module cho một scene.

**Validates: Requirements 1.7, 1.3**

### Property 2: Reauthor single-module

*For any* văn bản, `parseReauthorReply(text, id)` chỉ `ok` khi chứa đúng một
khối ```tsx có id literal `=== id`; mọi trường hợp khác → `!ok` (không nhận nhầm
module của cảnh khác).

**Validates: Requirements 3.2, 3.3**

### Property 3: Error classification is total and stable

*For any* `SafetyIssue`/`SerializedPipelineError`, `classifyIssue`/
`classifyError` luôn trả đúng một trong `{"infra","content"}`; mọi check ∈
CONTENT_CHECKS → "content"; mọi cause chứa token hạ-tầng (target closed/ECONN/
HTTP nnn/gateway) → "infra". Hàm thuần, idempotent.

**Validates: Requirements 4.1, 4.2, 4.3, 4.5**

### Property 4: Repair budget and routing

*For any* `maxAttempts` (clamp 1–10) và mọi chuỗi report, `generateValidateRepair`
luôn dừng trong budget; trả `passed` ngay report sạch đầu tiên; nếu report có
Infra_Error → trả `infra` và KHÔNG gọi `reauthor`; chỉ truyền cảnh Content_Error
cho `reauthor`.

**Validates: Requirements 3.4, 4.2, 7.3**

### Property 5: Localized scene-file resolution

*For any* `(projectId, sceneId)`, `resolveSceneFile` chỉ trả path khi sceneId
tồn tại trong manifest VÀ file tồn tại; ngược lại `null` — không bao giờ trỏ
nhầm sang component của cảnh khác.

**Validates: Requirements 3.3, 3.8**

### Property 6: Redaction holds for the new paths

*For any* engine error/safety issue đi qua biên IPC (kể cả lỗi fixWithAi/
exhausted/infra), thông điệp không chứa N-code/`.tsx`/MCP/stack/JSON braces.

**Validates: Requirements 5.5, 7.2**

## Testing Strategy

Pure logic → unit/property test (không model/render thật):

- **P-author-parse (property):** mọi reply ghép từ {manifest hợp lệ + N khối
  ```tsx có marker đúng id} → `parseAuthorReply.ok` và `modules` phủ
  `scenes[].component`. Biến thể thiếu một code → `missing-code`; marker lệch →
  `id-mismatch`. (Feature: desktop-author-mode, Property 1: author-reply parse roundtrip.)
- **P-reauthor-parse:** `parseReauthorReply(text, id)` chỉ ok khi đúng một khối
  cùng id. (Property 2.)
- **P-classify (property):** ∀ SafetyIssue có check ∈ CONTENT_CHECKS →
  "content"; ∀ cause chứa token infra → "infra". Non-vacuous self-test cho mỗi
  nhánh. (Property 3.)
- **repair-loop:** gặp Infra_Error → outcome `infra`, KHÔNG gọi reauthor; chỉ
  reauthor scene Content_Error; dừng ở report sạch trong budget (giữ Property 5
  cũ). (Property 4.)
- **resolveSceneFile:** sceneId không có trong manifest / file thiếu → null;
  khớp đúng component id→path. 
- **fixWithAi (controller):** stage error fixable:true → bấm chạy repair → ready
  khi passed; vẫn error(fixable) khi exhausted; bỏ qua khi stage≠error.
- **client-channel-coverage:** `"projects:fixWithAi"` có trong allow-list +
  preload bridge (R8.4).
- **preserved-invariants:** vẫn 1 `createTools`, draft-first, voice no-downgrade.
- Vision: test `chat` build đúng body đa-phần; degrade text-only khi ảnh lỗi
  (fake fetch).

`Verify_Grid` mỗi bước: `npm run typecheck`, `npx tsx scripts/test.ts apps/desktop`,
`build:renderer` + `build:main`. P1–P10 reconcile tiếp tục pass (R8.4).

---

## Requirements Traceability

| Req | Giải quyết bởi |
| --- | --- |
| R1.1–R1.4 | `authorScenes` pure-author + `parseAuthorReply` + `admitProjectScenes`. |
| R1.5 | `contract-text.ts` + `buildAuthorMessages`. |
| R1.6 | bỏ nhánh kit; fail → error có recovery. |
| R1.7 | AI_Output_Contract + `reply-parser.ts`. |
| R1.8 | `manifest-schema` id mở. |
| R1.9 | xoá `starter-kit.ts` + import. |
| R2.1–R2.4 | admission gate + `loadAuthoredTsx` + `setAuthoredLoader` (đã có); engine path không đổi. |
| R3.1–R3.6 | `reauthor` thật (resolve→prompt→ghi đè→re-admit), giới hạn budget. |
| R3.7 | vision client + `needsVision` (N14/N18) + degrade. |
| R3.8 | `resolveSceneFile` (sceneId→component→file). |
| R4.1–R4.4 | `error-classifier` + định tuyến repair/UI. |
| R4.5 | N10 ∈ CONTENT_CHECKS, chạy ở build gate. |
| R5.1–R5.6 | `fixWithAi` + kênh IPC + cờ `fixable` + nút renderer + redact. |
| R6.* | giữ 1 registry/draft-first/voice/captions/staged; N24/N25 đã loại khỏi gate draft. |
| R7.1–R7.4 | stage error luôn có recovery; log kỹ thuật; budget hữu hạn; báo "đã thử N lần". |
| R7.5 | reauthor chỉ gửi cảnh lỗi; tài liệu hoá chi phí. |
| R8.* | Verify_Grid + test thuần + giữ invariants. |
