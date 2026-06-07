# Requirements Document

## Introduction

Đây là một **refactor bảo toàn hành vi** (behavior-preserving) cho ứng dụng Electron `apps/desktop` trong monorepo `news_remotion_tool`.

Trong quá trình triển khai spec `web-dashboard` theo hướng test-first, một tập các controller thuần (pure) ở control-plane đã được tạo dưới `apps/desktop/src/main/` (và một số helper ở renderer), kèm khoảng 200 test. Tuy nhiên, entry thật của Electron — `apps/desktop/src/main/index.ts` (~360 dòng) — sau đó được viết trong một phiên làm việc trực tiếp như một bản hiện thực **nội tuyến (inline) riêng biệt**, đi vòng qua hầu hết các controller đó. Hệ quả: đường thực thi production nằm trong `index.ts` (một "God module" gom IPC wiring + lưu settings + điều phối nghiệp vụ + logic license + state stage theo từng project), trong khi ~200 test lại kiểm chứng các controller **không được chạy trong production**. Đây là rủi ro cốt lõi: test xanh tạo cảm giác an toàn giả vì chúng không bao phủ đường code thực sự được ship.

Mục tiêu của refactor (Option 1 mà người dùng đã chọn): **hợp nhất (reconcile)** để chỉ còn MỘT bản hiện thực có test trên ĐƯỜNG THỰC. `index.ts` trở thành một **composition root mỏng** (chỉ wiring); logic nghiệp vụ sống trong các controller đã có test.

Sắc thái quan trọng người dùng nhấn mạnh: đây **KHÔNG phải "khôi phục code cũ"** — đây là **RECONCILE**. Trong phiên làm việc trực tiếp, hành vi đã phân kỳ (diverge), và **hành vi HIỆN TẠI trong `index.ts` là chuẩn (authoritative) và phải được bảo toàn**. Khi một controller (và test của nó) không khớp với hành vi hiện tại, **controller và test của nó được sửa để khớp hành vi hiện tại**, KHÔNG sửa ngược lại hành vi production cho khớp controller cũ.

Phạm vi đóng (out of scope): không thêm tính năng mới, không đổi giao diện người dùng, không đổi hợp đồng IPC quan sát được, không đổi định dạng dữ liệu lưu trữ. Đặc biệt, **Review_Edit_Loop (vòng duyệt/chỉnh-sửa-cảnh sau draft) hiện là stub chưa hiện thực và được giữ nguyên là stub** — refactor này KHÔNG hiện thực nó (hiện thực vòng đó là một tính năng riêng, thuộc spec khác).

## Glossary

- **Composition_Root**: File `apps/desktop/src/main/index.ts` sau khi refactor — chỉ thực hiện wiring (khởi tạo phụ thuộc, đăng ký handler, vòng đời cửa sổ), không chứa logic nghiệp vụ.
- **Current_Behavior**: Hành vi quan sát được của ứng dụng như `index.ts` đang hiện thực TẠI THỜI ĐIỂM bắt đầu refactor. Đây là chuẩn tham chiếu (authoritative) cho mọi bất biến.
- **Controller**: Một module control-plane thuần dưới `apps/desktop/src/main/` hoặc helper renderer dưới `apps/desktop/src/renderer/`, ví dụ: `CreateController`, `ApproveController`, `Approve_Gate`, `Progress_Forwarder`, `BatchSubmitController`/`Storyboard`, `Edit_Router`, `ScriptApprovalGate`, `Script_Edit_Applier` (`script-gate-apply.ts`), `LicenseManager`, `License_Service`, `Disclosure_Map` (`renderer/settings/disclosure.ts`).
- **Dead_Controller**: Một Controller có test nhưng KHÔNG được wiring vào đường thực thi production.
- **IPC_Router**: `apps/desktop/src/main/ipc-router.ts` — đăng ký các invoke channel lên `ipcMain`.
- **IPC_Channel_Allowlist**: `apps/desktop/src/shared/channels.ts` — danh sách `INVOKE_CHANNELS` và `EVENT_CHANNELS` cho phép.
- **Preload_Bridge**: `apps/desktop/src/preload/index.ts` + `client.ts`, phơi bày `window.dashboard` theo hợp đồng `DashboardApi` trong `apps/desktop/src/shared/ipc-contract.ts`.
- **IPC_Handler**: Một entry trong `InvokeHandlers` được đăng ký qua `registerIpcRouter` (ví dụ `projects:create`, `script:approve`, `settings:update`).
- **Staged_Workspace**: Luồng làm việc theo trạng thái theo từng project, dùng `ProjectStage` với các kind: `writing`, `script`, `rendering` (kèm `percent`), `ready` (kèm `scenes`), `error` (kèm `message`).
- **Agent_Worker**: `CustomLoopAgentWorker` (`apps/desktop/src/main/agent/custom-loop-worker.ts`) — adapter điều phối author / re-author / vòng generate-validate-repair, phát các hook `onProgress`/`onSceneProduced` mà Composition_Root lắng nghe.
- **Media_Scheme**: Scheme `media://` đăng ký qua `registerMediaScheme()` + `handleMediaProtocol()` (`apps/desktop/src/main/media-protocol.ts`), cho phép renderer nạp stills/MP4 cục bộ; mọi đường dẫn media trả về renderer đều bọc qua `mediaUrl()`.
- **Event_Target**: Đích phát sự kiện streaming (`events:progress`/`scene`/`status`/`friendlyError`), gắn bằng `setEventTarget(win.webContents)` khi mở cửa sổ và `setEventTarget(null)` khi đóng (`apps/desktop/src/main/event-bus.ts`).
- **Review_Edit_Loop**: Vòng duyệt/chỉnh-sửa-cảnh SAU khi có draft (các handler `review:submitEdits`, `review:approveDraft`). Ở Current_Behavior đây là **stub chưa hiện thực** (`submitEdits` luôn trả `{ ok: true, revision: 1 }`; `approveDraft` luôn trả `{ ok: false, reason: "draft-first" }`). Refactor này coi Review_Edit_Loop là **tính năng hoãn có chủ đích (intentionally deferred)**, KHÔNG hiện thực trong phạm vi refactor.
- **Script_Gate**: Cổng phê duyệt kịch bản; bật/tắt qua `settings.scriptGateEnabled`.
- **Dev_License**: Cơ chế license chế độ dev; mã `"123"` kích hoạt trạng thái `active`, mọi giá trị khác trả về `error` với `reason: "invalid"`.
- **Settings_Store**: File `news-studio-settings.json` dưới `videoToolHome()`, lưu `SettingsModel` (loại trừ `aiAccount`).
- **Voice_Config**: Cấu hình TTS Vivibe: `voiceApiKey`/`voiceId` từ Settings, fallback sang `vivibeApiKey()`/`defaultVivibeVoiceId()` (đọc từ `.env`).
- **Single_Registry**: Một thực thể `createTools` (`@news/mcp`) duy nhất → một registry `@news/compositions` duy nhất.
- **Test_Suite**: Bộ test desktop chạy qua `npm test` ở gốc monorepo (script `tsx scripts/test.ts`, một wrapper Windows bọc `vitest run`).
- **Typecheck**: `npm run typecheck` (`tsc -p tsconfig.json --noEmit`) ở gốc monorepo.
- **Electron_Bundle**: Bản build Electron của desktop app qua `build:renderer` (vite) và `build:main` (`build-electron.mjs`).
- **Incremental_Step**: Một bước refactor độc lập, tự đứng vững (self-contained), được commit/đánh dấu riêng.

## Requirements

### Requirement 1: Bảo toàn hành vi quan sát được của mọi IPC handler

**User Story:** Là người bảo trì desktop app, tôi muốn mọi IPC handler giữ nguyên hành vi quan sát được trước và sau refactor, để việc hợp nhất không gây hồi quy (regression) trên đường production.

#### Acceptance Criteria

1. THE Composition_Root SHALL đăng ký đúng tập IPC_Handler có trong Current_Behavior: `license:get`, `license:activate`, `ai:gatewayState`, `ai:listProviders`, `ai:connectedAccounts`, `ai:beginConnect`, `ai:listModels`, `ai:selectModel`, `ai:selectedModel`, `projects:list`, `projects:create`, `projects:stage`, `projects:open`, `projects:delete`, `projects:reveal`, `script:get`, `script:applyEdits`, `script:approve`, `script:setEnabled`, `review:submitEdits`, `review:approveDraft`, `settings:get`, `settings:update`.
2. WHEN một IPC_Handler được gọi với cùng đầu vào và cùng trạng thái trước, THE Composition_Root SHALL trả về kết quả quan sát được tương đương với Current_Behavior.
3. WHEN `projects:create` nhận một `raw` không hợp lệ theo `validateCreateInput`, THE Composition_Root SHALL ném lỗi mang `reason` của kết quả validate (giữ nguyên Current_Behavior) và SHALL KHÔNG scaffold project.
4. WHEN `script:applyEdits` nhận một edit làm narration của một scene chỉ còn ký tự trắng, THE Composition_Root SHALL trả về `{ ok: false, reason: "empty-narration", sceneId }` và SHALL KHÔNG ghi manifest.
5. WHEN `review:approveDraft` được gọi mà chưa có draft đã review, THE Composition_Root SHALL trả về `{ ok: false, reason: "draft-first" }`.
6. WHEN `review:submitEdits` được gọi trong Current_Behavior, THE Composition_Root SHALL trả về `{ ok: true, revision: 1 }`.
7. IF một IPC_Handler gặp lỗi đọc/ghi nội bộ mà Current_Behavior xử lý bằng giá trị fallback (ví dụ `projects:list` trả mảng rỗng, `projects:open` trả storyboard rỗng, `script:get` trả `scenes: []`), THEN THE Composition_Root SHALL trả về đúng giá trị fallback đó thay vì để lỗi lan ra renderer.

### Requirement 2: Bảo toàn thứ tự và trạng thái của Staged_Workspace

**User Story:** Là người dùng tạo video, tôi muốn luồng staged (writing → script gate → rendering với % tiến độ → ready với stills thật) giữ nguyên hành vi, để trải nghiệm tạo video không thay đổi sau refactor.

#### Acceptance Criteria

1. WHEN `projects:create` thành công scaffold, THE Composition_Root SHALL đặt stage `writing` cho project trước khi bắt đầu viết kịch bản.
2. WHILE Script_Gate đang bật, WHEN bản author hoàn tất, THE Composition_Root SHALL chuyển stage sang `script` kèm danh sách `ScriptLine` của project và SHALL KHÔNG bắt đầu render.
3. WHERE Script_Gate đang tắt, WHEN bản author hoàn tất, THE Composition_Root SHALL bắt đầu render ngay mà không qua stage `script`.
4. WHEN `script:approve` được gọi, THE Composition_Root SHALL chuyển sang giai đoạn render (voice + draft).
5. WHILE đang render, WHEN nhận `onProgress(ratio)` từ Agent_Worker, THE Composition_Root SHALL đặt stage `rendering` với `percent` bằng `Math.round(ratio * 100)` và phát sự kiện `events:progress` mang `phase: "draft"`.
6. WHEN render hoàn tất ở trạng thái `passed`, THE Composition_Root SHALL đặt stage `ready` kèm các `SceneCard` storyboard trỏ tới stills thật tại `review/<sceneId>.png` (đã bọc qua `mediaUrl`).
7. IF việc viết kịch bản hoặc render ném lỗi hoặc trả về kết quả không thành công, THEN THE Composition_Root SHALL đặt stage `error` kèm `message` và phát `events:friendlyError` với `retry` đúng (`create` cho giai đoạn viết, `draft` cho giai đoạn render).
8. WHEN `projects:stage` được gọi cho một project không còn stage trong bộ nhớ, THE Composition_Root SHALL phục hồi stage từ trạng thái trên đĩa theo đúng quy tắc Current_Behavior (không có scene ⇒ `writing`; có stills ⇒ `ready`; còn lại ⇒ `script`).
9. WHEN một sự kiện tiến độ render được phát, THE Composition_Root SHALL gắn đúng `projectId` của project đang render (giữ nguyên việc thread `projectId` đã được sửa trước đó).

### Requirement 3: Bảo toàn hành vi License, Settings và Voice

**User Story:** Là người dùng và người bảo trì, tôi muốn logic Dev_License, lưu Settings và cấu hình Voice giữ nguyên hành vi, để việc kích hoạt, lưu cấu hình và giọng đọc không bị thay đổi.

#### Acceptance Criteria

1. WHEN ứng dụng khởi động và chưa có license được kích hoạt trước đó, THE Composition_Root SHALL đặt license ở trạng thái `{ kind: "unactivated" }` để màn hình kích hoạt hiển thị.
2. WHEN `license:activate` nhận giá trị mà sau khi loại bỏ khoảng trắng đầu/cuối (trim) bằng đúng chuỗi `"123"`, THE Composition_Root SHALL đặt license sang `{ kind: "active", machineLocked: true, lastVerifiedAt: <chuỗi ISO 8601 UTC biểu thị thời điểm xử lý lời gọi> }`.
3. IF `license:activate` nhận giá trị mà sau khi trim khác chuỗi `"123"` (bao gồm cả chuỗi rỗng), THEN THE Composition_Root SHALL đặt license sang `{ kind: "error", reason: "invalid" }` và không thay đổi sang trạng thái `active`.
4. WHEN ứng dụng khởi động và file Settings_Store tồn tại, THE Composition_Root SHALL nạp Settings đã lưu, hợp nhất (merge) chồng lên `defaultSettings(videoToolHome())` với giá trị đã lưu được ưu tiên, sau đó ép `voiceProvider` bằng đúng `"vivibe"` và ép `aiAccount` bằng giá trị `aiAccount` từ default.
5. IF việc đọc hoặc phân giải (parse) Settings_Store thất bại, THEN THE Composition_Root SHALL dùng `defaultSettings(videoToolHome())` làm Settings và SHALL hoàn tất quá trình khởi động mà không ném lỗi ra ngoài (không làm dừng tiến trình khởi động).
6. WHEN Settings được lưu, THE Composition_Root SHALL ghi `SettingsModel` đã loại trừ trường `aiAccount` ra Settings_Store dưới dạng văn bản JSON.
7. WHEN cấu hình TTS được phân giải, THE Composition_Root SHALL dùng `settings.voiceApiKey` và `settings.voiceId` sau khi trim nếu giá trị tương ứng khác rỗng sau khi trim; ngược lại (rỗng hoặc không tồn tại) SHALL fallback sang `vivibeApiKey()` cho khóa và `defaultVivibeVoiceId()` cho voice id từ Voice_Config.
8. WHEN `settings:update` được gọi với một patch, THE Composition_Root SHALL hợp nhất patch chồng lên Settings hiện tại với giá trị trong patch được ưu tiên, ép `voiceProvider` bằng đúng `"vivibe"`, ghi Settings sau hợp nhất xuống Settings_Store, và trả về Settings sau cập nhật.
9. WHEN `script:setEnabled` được gọi với một giá trị, THE Composition_Root SHALL đặt `scriptGateEnabled` bằng giá trị boolean ép kiểu từ tham số (`Boolean(enabled)`) và ghi Settings xuống Settings_Store.

### Requirement 4: Đường production được hậu thuẫn bởi các Controller đã có test

**User Story:** Là người bảo trì, tôi muốn các IPC_Handler trên đường production gọi vào các Controller đã có test, để test xanh thực sự bao phủ đường code được ship.

#### Acceptance Criteria

1. THE Composition_Root SHALL ủy quyền toàn bộ (100%) logic nghiệp vụ của mỗi IPC_Handler cho Controller tương ứng, và SHALL KHÔNG chứa bất kỳ hiện thực nội tuyến nào lặp lại logic nghiệp vụ đó.
2. THE Composition_Root SHALL chỉ chứa các thành phần wiring sau và không gì khác: khởi tạo phụ thuộc, lắp ráp Controller, đăng ký handler qua IPC_Router, và quản lý vòng đời cửa sổ/gateway.
3. IF Composition_Root chứa logic nghiệp vụ, nhánh điều kiện nghiệp vụ, hoặc biến đổi dữ liệu nằm ngoài bốn loại wiring nêu ở tiêu chí 2, THEN THE refactor SHALL di chuyển phần đó vào Controller tương ứng.
4. WHERE một Controller có thiết kế không còn khớp Current_Behavior (hành vi production hiện đang được ship tại thời điểm refactor), THE refactor SHALL cập nhật Controller đó và các test của nó để khớp Current_Behavior, và SHALL KHÔNG đổi hành vi production cho khớp Controller cũ.
5. WHEN một Controller được wiring vào production, THE refactor SHALL bảo đảm chính thực thể Controller đó được gọi trên đường thực thi mà IPC_Handler đi qua (không tồn tại một hiện thực song song hay bản sao logic nào khác phục vụ cùng IPC_Handler đó).
6. THE refactor SHALL bảo đảm mọi truy cập tới `@news/mcp` đi qua đúng một (1) Single_Registry — một thực thể `createTools` duy nhất — và SHALL KHÔNG khởi tạo thực thể `createTools` thứ hai.
7. WHEN một Controller được cập nhật để khớp Current_Behavior, THE refactor SHALL cập nhật test của Controller đó để khẳng định hành vi hiện tại, và toàn bộ các test đó SHALL pass (0 test thất bại).

### Requirement 5: Không còn Dead_Controller

**User Story:** Là người bảo trì, tôi muốn không còn controller "chết nhưng có test", để codebase chỉ còn một bản hiện thực rõ ràng.

#### Acceptance Criteria

1. THE refactor SHALL bảo đảm mọi Controller (gồm `CreateController`, `ApproveController`/`Approve_Gate`, `Progress_Forwarder`, `BatchSubmitController`/`Storyboard`, `Edit_Router`, `ScriptApprovalGate`, `Script_Edit_Applier`, `LicenseManager`, `License_Service`, `Disclosure_Map`) hoặc được wiring vào production, hoặc bị gỡ bỏ một cách có chủ đích.
2. WHERE một Controller bị gỡ bỏ, THE refactor SHALL gỡ luôn cả các test chỉ phục vụ Controller đó để không còn test mồ côi (orphan).
3. WHEN refactor hoàn tất, THE codebase SHALL không còn module control-plane nào vừa có test vừa không nằm trên đường thực thi production hoặc trên một đường được dùng có chủ đích khác.
4. WHERE một Controller được giữ lại nhưng không wiring trực tiếp vào IPC, THE design SHALL ghi rõ lý do giữ lại và nơi nó được sử dụng có chủ đích.
5. BECAUSE Review_Edit_Loop là tính năng hoãn có chủ đích (giữ nguyên stub theo R1.5/R1.6), THE refactor SHALL **gỡ bỏ** các Controller chỉ phục vụ Review_Edit_Loop — gồm `ApproveController`/`Approve_Gate`, `BatchSubmitController`, `Edit_Router`, và `Progress_Forwarder` nếu chỉ được vòng này dùng — cùng test của chúng, thay vì wiring chúng vào production (vì wiring sẽ làm `review:submitEdits`/`review:approveDraft` hoạt động thật, vi phạm bảo toàn hành vi).
6. WHERE một module bị gỡ bỏ ở tiêu chí 5 còn export thứ vẫn được dùng ở nơi khác (ví dụ `Storyboard`/`buildStoryboard` được dùng để dựng storyboard stage `ready`), THE refactor SHALL chỉ gỡ phần chết và giữ lại phần đang sống, hoặc di chuyển phần đang sống sang vị trí phù hợp.
7. THE refactor SHALL ghi nhận rằng với `CreateController`, chỉ **class `CreateController`** thuộc diện wire-hoặc-gỡ; hàm `validateCreateInput` đã được tách sang `apps/desktop/src/shared/create-validation.ts` và đang được cả production lẫn renderer dùng, nên KHÔNG bị gỡ.

### Requirement 6: Verify sau mỗi Incremental_Step

**User Story:** Là người bảo trì, tôi muốn typecheck, test và build Electron đều xanh sau mỗi bước, để refactor luôn ở trạng thái an toàn và có thể dừng/khôi phục bất kỳ lúc nào.

#### Acceptance Criteria

1. WHEN một Incremental_Step hoàn tất, THE refactor SHALL bảo đảm Typecheck pass.
2. WHEN một Incremental_Step hoàn tất, THE refactor SHALL bảo đảm toàn bộ Test_Suite của desktop app pass.
3. WHEN một Incremental_Step hoàn tất, THE refactor SHALL bảo đảm Electron_Bundle vẫn build được (`build:renderer` và `build:main`).
4. IF Typecheck, Test_Suite, hoặc Electron_Bundle thất bại sau một Incremental_Step, THEN THE refactor SHALL sửa lỗi trước khi bắt đầu Incremental_Step tiếp theo.
5. THE refactor SHALL được chia thành các Incremental_Step mà sau mỗi bước hành vi quan sát được của ứng dụng vẫn không đổi.

### Requirement 7: Giữ nguyên IPC_Channel_Allowlist và hợp đồng Preload_Bridge

**User Story:** Là người bảo trì lo về bảo mật và ổn định hợp đồng, tôi muốn allow-list kênh IPC và hợp đồng preload bridge không đổi trừ khi có lý do được nêu rõ, để biên giới renderer↔main giữ nguyên bề mặt.

#### Acceptance Criteria

1. THE refactor SHALL giữ nguyên `INVOKE_CHANNELS` và `EVENT_CHANNELS` trong IPC_Channel_Allowlist.
2. THE refactor SHALL giữ nguyên hợp đồng `DashboardApi` mà Preload_Bridge phơi bày qua `window.dashboard`.
3. THE refactor SHALL giữ nguyên hành vi của Preload_Bridge: chỉ phơi bày `window.dashboard`, không phơi bày `ipcRenderer` hay Node.
4. IF cần thay đổi IPC_Channel_Allowlist hoặc hợp đồng Preload_Bridge, THEN THE refactor SHALL nêu rõ lý do (justification) trong design trước khi thay đổi.
5. THE IPC_Router SHALL tiếp tục chỉ đăng ký các kênh thuộc IPC_Channel_Allowlist và ném "No handler registered" cho kênh chưa có handler.
6. THE Composition_Root SHALL giữ nguyên việc đăng ký Media_Scheme (`registerMediaScheme()` trước khi app ready, `handleMediaProtocol()` khi app ready) để renderer nạp được stills/MP4 cục bộ; mọi đường dẫn media trả về renderer SHALL tiếp tục được bọc qua `mediaUrl()`.
7. THE Composition_Root SHALL giữ nguyên việc gắn Event_Target: `setEventTarget(win.webContents)` khi cửa sổ được tạo và `setEventTarget(null)` khi cửa sổ đóng, để các sự kiện streaming (`events:progress`/`scene`/`status`/`friendlyError`) tiếp tục tới được renderer.

### Requirement 8: Bảo toàn các bất biến engine và đường Single_Registry

**User Story:** Là người bảo trì engine, tôi muốn các bất biến engine (draft-first, voice guard, no-downgrade) và đường single-registry vẫn được giữ ở biên giới dashboard, để hợp nhất không làm suy yếu các đảm bảo cốt lõi.

#### Acceptance Criteria

1. THE Composition_Root SHALL dẫn động các MCP tool qua một thực thể `createTools` duy nhất (Single_Registry).
2. THE đường production dashboard hiện KHÔNG phơi bày handler full-render (luồng staged chỉ render draft); DO NOT hiện thực hay wiring một full-render handler trong phạm vi refactor này.
3. WHERE engine được gọi để full-render (qua MCP tool, ngoài luồng dashboard hiện tại), THE engine SHALL giữ nguyên gate draft-first: từ chối với `draft-first` khi chưa có draft đã review và không có force-full, và SHALL KHÔNG dựng video. (Bất biến engine này nằm trong `@news/pipeline`, không phải thứ refactor desktop được phép làm suy yếu.)
4. IF Voice_Config thiếu cấu hình (ví dụ thiếu voice id) khi engine synth giọng, THEN THE engine SHALL báo đúng cấu hình còn thiếu và SHALL KHÔNG hạ cấp (downgrade) giọng đọc. (Bất biến engine; refactor desktop chỉ cần chuyển đúng `Voice_Config` xuống tools, không được tự ý fallback sang mock/none.)
5. WHEN một lỗi engine cấp thấp được hiển thị lên UI, THE đường production SHALL hiển thị thông điệp thân thiện đã được redact, không lộ chi tiết nội bộ (ví dụ giá trị `VOICE_ID`, khóa cấu hình, đường dẫn hệ thống, hay stack trace).
