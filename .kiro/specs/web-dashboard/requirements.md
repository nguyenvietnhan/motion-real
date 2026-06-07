# Requirements Document

## Introduction

The **Web Dashboard** (codename `web-dashboard`) is a desktop application that
gives non-technical Vietnamese users a graphical surface over the existing
`news_remotion_tool` pipeline, so they can produce 9:16 short-form news videos
without driving an AI through chat or a CLI.

The dashboard is a **thin new surface** over the SAME single-process orchestrator
that already ships (style packs, URL ingest, tracker, doctor, the `@news/mcp`
server with `ingest_url`/`scaffold_project`/`render_draft`/`render_full`/`doctor`/
`list_projects`/`tracker_*`, the bulk loop, CLI verbs, the skill, and buyer docs).
None of that is replaced; the dashboard wraps it.

Two planes exist. The **control plane** (the GUI: settings, project gallery,
progress, draft player, per-scene review) is pure code and needs no AI. The
**authoring plane** (writing scene `.tsx` modules + manifest + narration) needs
AI; that AI runs silently as a background **agent worker** so the user never
chats with it. AI runs on the user's machine via a bundled local model gateway,
voice stays Vivibe, and render runs locally (Electron reuses Chromium for the
Remotion render).

The product is sold **buy-once** with **online license activation** (node-locked,
revocable). There is no cloud render and no cloud "brain" in v1; a future Pro
cloud tier is left open but out of scope.

All hard quality invariants of the underlying engine are preserved unchanged on
this new surface: the full safety grid N1–N30, the evidence gate (N9), draft-first
rendering, determinism, the Vivibe voice rule, workspace hygiene, and the single
single-process orchestrator with one `@news/compositions` registry instance.

### Non-Goals (v1)

- Per-scene mini-clip previews (still images only in v1; mini-clips are a future
  enhancement).
- Draft version history / rollback across draft iterations (future enhancement).
- Automatic upload/publishing to platforms (YouTube/TikTok/Facebook) (future
  enhancement).
- A cloud "brain" or cloud render tier (future Pro tier; explicitly out of scope).
- An in-app chat interface with the AI (deliberately excluded by design).

## Glossary

- **Dashboard**: The desktop application (Electron shell) that provides the GUI
  control plane and hosts the local engine; the system under specification.
- **Orchestrator**: The existing single-process pipeline
  (`scaffoldVideoProject`/`renderProject` and related) that scaffolds, authors,
  TTS-renders, locks, and renders video projects. Reused unchanged.
- **Agent_Worker**: The background process that drives the authoring plane:
  ingest → author scenes → draft → (review) → full, over the Orchestrator and its
  MCP tools.
- **Model_Gateway**: The bundled local model gateway (9Router) run silently on
  localhost inside the Dashboard; provides AI models to the Agent_Worker via an
  OpenAI-compatible endpoint.
- **AI_Account**: A user's connected AI provider account that the Model_Gateway
  authenticates and routes to; more than one AI_Account may be connected at the
  same time.
- **AI_Provider**: An AI model provider offered through the Model_Gateway,
  discovered dynamically from the Model_Gateway at runtime rather than fixed in
  the Dashboard. The set of providers is not hardcoded and may include
  user-defined custom providers. Each AI_Provider uses one of three login flows —
  browser sign-in (OAuth authorization-code), device code (OAuth device-code), or
  API key — surfaced by the Model_Gateway's own login interface.
- **Local_Gateway_Key**: The credential the Model_Gateway requires, auto-generated
  and auto-wired by the Dashboard; never seen or handled by the user.
- **Safety_Grid**: The enumerated quality checks N1–N30 enforced by the engine
  (hard errors block lock/render/done; warnings are advisory).
- **Evidence_Gate**: Safety check N9, which forbids fabricated specifics (sources,
  dates, prices, percentages, benchmarks, quotes).
- **Draft**: A fast low-resolution render (`quality: "draft"`) produced for review
  before any full render.
- **Full_Render**: The final full-quality MP4, only producible after a reviewed
  Draft exists.
- **Manifest**: The project's `VideoSpec`/manifest JSON describing scenes,
  components, props, and narration.
- **Scene**: A single authored video beat with a stable id, component, props, and
  narration.
- **Plain_Text_Edit**: A user edit limited to wording (headline / narration / CTA
  text) that applies directly to the Manifest with NO AI involvement.
- **Visual_Edit**: A user edit changing a Scene's imagery or structure, requiring
  the Agent_Worker to re-author the affected Scene(s).
- **Storyboard**: The per-scene "slide" review surface showing each Scene's
  rendered still plus a per-scene edit box.
- **Preprompt**: The fixed contract-bearing template into which batched user edits
  are merged before being sent to the Agent_Worker.
- **Script_Approval_Gate**: The optional pre-render gate (Stage 2) that shows a
  text outline + narration before the first render; default ON, skippable.
- **License_Service**: The external online license activation/revocation service
  (e.g. Gumroad/Lemon Squeezy/Keygen).
- **Friendly_Status**: A plain-language label shown to the user that maps from an
  internal technical project state.
- **Disclosure_Level**: One of four progressive-disclosure tiers (L1 always
  visible, L2 contextual/collapsed, L3 Settings, L0 never shown to users).
- **POC_Spike**: The early proof-of-concept task evaluating a headless open-source
  agent-runtime as the Agent_Worker implementation, with a fallback to a
  custom agent loop.

## Requirements

### Requirement 1: First-Run Onboarding and License Activation

**User Story:** As a non-technical buyer, I want to activate my license once when
I first open the app, so that I can use the Dashboard and the app can verify my
purchase.

#### Acceptance Criteria

1. WHEN the Dashboard launches and no activated license is stored locally, THE
   Dashboard SHALL display a license activation screen requesting a license key.
2. WHEN the user submits a license key, THE Dashboard SHALL display an in-progress
   indicator and validate the key with the License_Service over the network.
3. IF the License_Service does not respond within 30 seconds, THEN THE Dashboard
   SHALL display a plain-language message indicating activation timed out and
   SHALL allow the user to retry with the same key.
4. WHEN the License_Service confirms the key is valid and available, THE Dashboard
   SHALL activate the license node-locked to the current machine, store the
   activation locally, and grant access to project creation.
5. IF the License_Service reports the key is invalid, already at its activation
   limit, or revoked, THEN THE Dashboard SHALL display a plain-language message
   stating the activation could not be completed, SHALL keep the activation
   screen for re-entry, and SHALL NOT grant access to project creation.
6. IF the License_Service cannot be reached during activation, THEN THE Dashboard
   SHALL display a plain-language message indicating an internet connection is
   required and SHALL allow the user to retry with the same key.
7. WHILE no valid license is active, THE Dashboard SHALL restrict access to
   project creation features.
8. WHEN a license activation node-locked to the current machine is detected at
   launch, THE Dashboard SHALL proceed past activation without requiring the user
   to re-enter the key.
9. WHEN the License_Service reports a previously active license as revoked or
   expired, THE Dashboard SHALL preserve access to already-created videos and
   SHALL prevent creation of new videos.

### Requirement 2: Connect AI Account (Bundled Model Gateway)

**User Story:** As a non-technical user, I want to connect any AI account the
bundled gateway supports without handling provider logins myself, so that the app
can generate videos using a provider and model I choose.

#### Acceptance Criteria

1. WHEN the Dashboard application starts, THE Dashboard SHALL start the
   Model_Gateway as a background service bound to localhost, with no Model_Gateway
   window, console, or notification shown to the user.
2. IF the Model_Gateway fails to start or become reachable on localhost within 30
   seconds of the start attempt, THEN THE Dashboard SHALL display a plain-language
   message indicating the local service could not start, SHALL leave AI authoring
   features disabled, and SHALL retry the start attempt up to 3 times before
   surfacing the failure.
3. WHEN the Model_Gateway becomes reachable on localhost, THE Dashboard SHALL
   generate the Local_Gateway_Key and auto-wire it to the Model_Gateway without
   displaying the key value, and without using the term "API key" to refer to the
   Local_Gateway_Key anywhere in the user-facing interface.
4. THE Dashboard SHALL present the AI_Providers discovered from the Model_Gateway,
   and for each AI_Provider SHALL display its provider name, its count of active
   connections, and a login-type indicator of browser sign-in, device code, or
   API key.
5. THE Dashboard SHALL allow the user to select any AI_Provider in the discovered
   provider list, with no AI_Provider preselected as a forced default.
6. WHEN the user initiates connecting a selected AI_Provider, THE Dashboard SHALL
   delegate the provider-specific login to the Model_Gateway's own login
   interface, and SHALL indicate to the user whether the login appears in an
   external browser or within the Dashboard.
7. WHILE a provider connection is awaiting completion, THE Dashboard SHALL poll
   the Model_Gateway connection state to detect a newly completed connection.
8. WHEN a provider connection completes successfully, THE Dashboard SHALL record
   the connected AI_Account and its AI_Provider and SHALL enable AI authoring
   features.
9. IF a provider connection fails, is cancelled, or does not complete within 120
   seconds of initiation, THEN THE Dashboard SHALL display a plain-language
   message stating that the connection did not complete, SHALL leave AI authoring
   features disabled, and SHALL retain any previously connected AI_Accounts
   unchanged.
10. THE Dashboard SHALL allow multiple AI_Account connections to be active
    simultaneously.
11. THE Dashboard SHALL allow the user to select which model, from the models the
    Model_Gateway reports as available, is used for AI authoring.
12. WHILE no AI_Account is connected, IF the user attempts to start silent draft
    generation, THEN THE Dashboard SHALL block the start, SHALL display a prompt
    directing the user to connect an AI account first, and SHALL leave draft
    generation unstarted.
13. WHILE an AI_Account is connected and no model is selected, IF the user
    attempts to start silent draft generation, THEN THE Dashboard SHALL block the
    start, SHALL display a prompt directing the user to select a model, and SHALL
    leave draft generation unstarted.
14. THE Dashboard SHALL use Vivibe as the default voice provider for narration.

### Requirement 3: Create a Video from a Topic or URL

**User Story:** As a user, I want to enter a topic or paste a link and press one
button, so that the app starts making a video for me.

#### Acceptance Criteria

1. THE Dashboard SHALL provide a single primary input that accepts either a
   free-text Vietnamese topic (1 to 500 characters) or a source URL (1 to 2,048
   characters), plus a "Create draft" action.
2. WHEN the user submits a source URL, THE Agent_Worker SHALL ingest the URL into
   grounded research material, within a 60-second window, before authoring scenes.
3. WHEN the user submits a topic without a URL, THE Agent_Worker SHALL search for
   a relevant source URL and ingest it before authoring scenes.
4. WHERE the user selects a style pack and accent color, THE Dashboard SHALL apply
   the selected style pack and accent color to the created project.
5. WHERE the user does not select a style pack or accent color, THE Dashboard
   SHALL apply the default style pack and accent color.
6. WHEN a video creation is started, THE Orchestrator SHALL scaffold the project
   through the single-process orchestrator using one `@news/compositions`
   registry instance.
7. IF the submitted input is empty or whitespace-only, THEN THE Dashboard SHALL
   display a plain-language message requesting a topic or link, SHALL retain any
   entered text, and SHALL NOT start creation.
8. IF the submitted input exceeds the allowed length or is a malformed URL, THEN
   THE Dashboard SHALL display a plain-language message describing the problem and
   SHALL NOT start creation.
9. IF URL ingestion fails (unreachable, no usable content, or timeout), THEN THE
   Dashboard SHALL display a plain-language message and SHALL NOT start authoring.
10. IF a topic search returns no usable source, THEN THE Dashboard SHALL display a
    plain-language message and SHALL NOT start authoring.

### Requirement 4: Optional Script Approval Gate

**User Story:** As a user, I want to review the outline and narration as text
before the app renders, so that I can fix wording early and save a render round.

#### Acceptance Criteria

1. THE Dashboard SHALL set the Script_Approval_Gate to enabled as its default
   state when no user override is configured.
2. WHILE the Script_Approval_Gate is enabled, THE Dashboard SHALL present the
   complete text outline (the ordered list of all scenes) and the narration text
   for each scene to the user before the first Draft render begins, and THE
   Agent_Worker SHALL NOT begin the first Draft render until the user either
   approves or disables the Script_Approval_Gate.
3. WHEN the user edits the outline or narration text in the Script_Approval_Gate
   and confirms, THE Dashboard SHALL apply every confirmed text edit to the
   corresponding scene fields in the Manifest before the first Draft render
   begins.
4. IF a confirmed edit leaves a scene's narration text empty (zero non-whitespace
   characters), THEN THE Dashboard SHALL reject the confirmation, retain the prior
   text for that scene in the Manifest, and present an indication identifying the
   rejected scene.
5. IF applying confirmed text edits to the Manifest fails, THEN THE Dashboard
   SHALL retain the pre-edit Manifest content unchanged, withhold the first Draft
   render, and present an indication that the edits were not saved.
6. WHEN the user approves the Script_Approval_Gate, THE Agent_Worker SHALL proceed
   to the first Draft render.
7. WHERE the user disables the Script_Approval_Gate, THE Agent_Worker SHALL
   proceed directly to the first Draft render without presenting the text gate.
8. IF the user approves the Script_Approval_Gate before its enabled/disabled state
   has been initialized, THEN THE Agent_Worker SHALL wait until the gate state is
   configured before proceeding to the first Draft render.

### Requirement 5: Silent Draft Generation with Progress

**User Story:** As a user, I want the app to make a draft on its own while showing
me progress, so that I can see a first result without doing technical work.

#### Acceptance Criteria

1. WHEN draft generation starts, THE Agent_Worker SHALL author the scenes and
   produce a Draft without rendering, presenting, or requiring any chat or
   text-input interface for the user.
2. WHILE draft generation is in progress, THE Dashboard SHALL display a progress
   indicator showing a completion percentage between 0 and 100, updated at least
   once every 2 seconds.
3. WHILE draft generation is in progress, THE Dashboard SHALL display each
   Storyboard scene within 2 seconds of that scene being produced by the
   Agent_Worker.
4. WHEN the Draft render completes, THE Dashboard SHALL display the Draft in an
   embedded player and SHALL present the complete Storyboard for review.
5. IF draft generation fails, THEN THE Dashboard SHALL display a message
   describing the problem in non-technical terms, SHALL offer a retry action that
   restarts draft generation, and SHALL retain the user's existing inputs so no
   data is lost.
6. THE Dashboard SHALL produce a reviewable Draft only when draft generation
   starts successfully, and SHALL produce that reviewable Draft before initiating
   any Full_Render (draft-first invariant).

### Requirement 6: Generate-Validate-Repair Authoring Loop

**User Story:** As a user, I want the app to fix its own quality problems before
showing me the draft, so that the result is reliably correct regardless of which
AI model produced it.

#### Acceptance Criteria

1. THE Dashboard SHALL expose Draft rendering and Safety_Grid report retrieval as
   tools available to the Agent_Worker.
2. WHEN the Agent_Worker finishes rendering a Draft, THE Agent_Worker SHALL
   retrieve the Safety_Grid report for that Draft before that Draft is presented
   to the user.
3. IF the Safety_Grid report contains one or more hard errors, THEN THE
   Agent_Worker SHALL repair every flagged Scene and re-run the Safety_Grid on the
   resulting Draft.
4. THE Agent_Worker SHALL repeat the generate-validate-repair cycle until either
   the Safety_Grid reports zero hard errors or the configured maximum number of
   repair attempts (default 3, configurable within the range 1 to 10) is reached,
   whichever occurs first.
5. WHEN the Safety_Grid reports zero hard errors for a Draft, THE Dashboard SHALL
   present that Draft to the user.
6. IF a repair attempt fails to produce a renderable Draft, THEN THE Agent_Worker
   SHALL count that attempt toward the configured maximum number of repair
   attempts and continue the generate-validate-repair cycle.
7. IF the configured maximum number of repair attempts is reached while one or
   more hard errors remain, THEN THE Dashboard SHALL display a plain-language
   message indicating the video could not be completed AND SHALL offer a retry
   action that restarts the generate-validate-repair cycle from a new Draft
   rendering.
8. WHEN the Agent_Worker auto-repairs a hard error reported by the Safety_Grid,
   THE Dashboard SHALL describe the applied fix in plain language AND SHALL NOT
   display the underlying N-check code or check identifier.

### Requirement 7: Headless Agent-Runtime Proof-of-Concept Spike with Fallback

**User Story:** As the product team, I want an early proof-of-concept evaluating a
headless open-source agent-runtime, so that we can decide whether to embed it or
build our own agent loop before committing.

#### Acceptance Criteria

1. THE POC_Spike SHALL evaluate a headless open-source agent-runtime that loads
   `SKILL.md` and `AGENTS.md` and calls the project's MCP tools, using the
   Model_Gateway as the model source.
2. WHILE running, THE POC_Spike SHALL run the agent-runtime in headless mode that
   completes each run without any human input.
3. WHEN the headless agent-runtime produces a passing video (one that clears all
   hard Safety_Grid checks and the review-loop gate) in at least 8 of 10
   consecutive POC_Spike runs, THE Dashboard SHALL adopt the headless
   agent-runtime as the Agent_Worker implementation.
4. IF the headless agent-runtime produces a passing video in fewer than 8 of 10
   consecutive POC_Spike runs, THEN THE Dashboard SHALL use a custom agent loop
   with a Preprompt as the Agent_Worker implementation.
5. THE Agent_Worker SHALL drive the Orchestrator through the same MCP tools and
   single-process orchestrator regardless of which implementation is adopted.
6. IF the agent-runtime fails to load `SKILL.md`/`AGENTS.md` or to invoke an MCP
   tool during a POC_Spike run, THEN THE POC_Spike SHALL record that run as a
   failed attempt and SHALL capture the cause for the adoption decision.

### Requirement 8: Per-Scene Review and Editing

**User Story:** As a user, I want to review each scene as a slide and write what I
want changed, so that I can refine the video without learning the technical
internals.

#### Acceptance Criteria

1. WHILE a Storyboard is loaded, THE Dashboard SHALL display the Storyboard as a
   per-Scene list in Scene order where each Scene shows its rendered still and an
   editable per-scene edit box that accepts up to 2,000 characters of plain text.
2. THE Dashboard SHALL provide one global notes box for cross-scene requests that
   accepts up to 4,000 characters of plain text.
3. THE Dashboard SHALL provide per-Scene actions to regenerate, add, remove, and
   reorder Scenes.
4. THE Dashboard SHALL provide actions to change the style pack and accent color.
5. WHEN the user submits edits, THE Dashboard SHALL batch the per-scene edits and
   global notes into a single submission.
6. WHEN a submitted edit is a Plain_Text_Edit, THE Dashboard SHALL apply the edit
   directly to the Manifest with no AI involvement and without re-authoring the
   Scene.
7. WHEN a submitted edit is a Visual_Edit, THE Agent_Worker SHALL re-author only
   the affected Scene(s) by merging the batched edits into the Preprompt.
8. WHEN re-rendering after edits, THE Orchestrator SHALL re-render only the changed
   Scenes and SHALL keep unchanged Scenes byte-identical via the render cache.
9. IF a Visual_Edit requests a specific figure that has no supporting source, THEN
   THE Agent_Worker SHALL NOT fabricate the figure, SHALL leave the affected
   Scene's existing figure unchanged, and SHALL surface an Evidence_Gate warning
   identifying the unsupported figure.
10. WHEN the user submits edits, THE Dashboard SHALL produce an updated Draft for
    further review, and SHALL allow the review-and-edit cycle to repeat until the
    user approves.
11. IF the user submits with no per-scene edit text and no global notes entered,
    THEN THE Dashboard SHALL reject the submission, SHALL surface an indication
    that no changes were specified, and SHALL leave the current Draft unchanged.
12. IF re-rendering a changed Scene fails, THEN THE Orchestrator SHALL retain that
    Scene's previously rendered still, SHALL preserve the submitted edits, and
    SHALL surface an error indication identifying the failed Scene.
13. IF the user requests removal of the last remaining Scene, THEN THE Dashboard
    SHALL reject the removal and SHALL surface an indication that the Storyboard
    must contain at least one Scene.
14. WHEN a Plain_Text_Edit is applied to the Manifest, THE Dashboard SHALL first
    run the engine's content validation/normalization (including the Vietnamese
    number and phonetics rules) and SHALL write the normalized text.

### Requirement 9: Approve and Full Render

**User Story:** As a user, I want to approve the draft and get the finished video,
so that I can use it.

#### Acceptance Criteria

1. WHILE a reviewed Draft exists for the open project, THE Dashboard SHALL display
   the Approve action enabled on the Draft review surface.
2. WHILE no reviewed Draft exists for the open project, THE Dashboard SHALL keep
   the Approve action disabled.
3. WHEN the user approves a Draft, THE Orchestrator SHALL begin the Full_Render
   within 2 seconds.
4. IF a Full_Render is requested before a reviewed Draft exists, THEN THE
   Orchestrator SHALL refuse the Full_Render, SHALL leave the Draft and project
   unchanged, and SHALL surface a plain-language indication that a reviewed draft
   is required first (draft-first invariant).
5. WHILE the Full_Render is in progress, THE Dashboard SHALL display a progress
   indicator showing a completion percentage (0 to 100) or the current pipeline
   stage, updated at least once every 5 seconds.
6. WHEN the Full_Render completes, THE Dashboard SHALL display the finished video
   in the embedded player and SHALL provide access to the output file.
7. IF the Full_Render fails, THEN THE Dashboard SHALL stop the progress indicator,
   display a plain-language message, retain the existing Draft, and offer a retry
   action that re-initiates the Full_Render.

### Requirement 10: Project Gallery and Friendly Status

**User Story:** As a user, I want a gallery of my videos with clear status, so
that I can manage multiple projects without confusion.

#### Acceptance Criteria

1. WHEN the user opens the "My videos" gallery, THE Dashboard SHALL display each
   project as a card showing a thumbnail, a title, a Friendly_Status badge, and a
   creation date formatted as `ngày D tháng M năm YYYY`, ordered by creation date
   with the most recent project first.
2. THE Dashboard SHALL map each internal technical state to a Friendly_Status
   using these mappings: scaffolded, tts, locking, or rendering to "Đang dựng…";
   reviewing or draft-ready to "Nháp sẵn sàng để duyệt"; done to "Hoàn tất";
   failed to "Gặp lỗi — thử lại".
3. IF a project's internal technical state does not match any mapping defined in
   criterion 2, THEN THE Dashboard SHALL display the Friendly_Status "Đang dựng…"
   and SHALL NOT display the unmapped state name.
4. THE Dashboard SHALL NOT display internal technical state names in the gallery.
5. WHEN a project's internal technical state changes, THE Dashboard SHALL update
   that project's Friendly_Status badge to the mapped value within 5 seconds
   without requiring a manual page reload.
6. IF a project has no thumbnail available, THEN THE Dashboard SHALL display a
   placeholder thumbnail in the project card.
7. WHEN the user selects a project card, THE Dashboard SHALL open that project's
   Storyboard/review surface for the selected project within 2 seconds.
8. WHILE the gallery has finished loading and the user has zero projects, THE
   Dashboard SHALL display an empty-state message indicating that no videos exist
   and SHALL NOT display any project cards; WHILE the gallery is still loading,
   THE Dashboard SHALL NOT display the empty-state message.
9. WHERE the user opens the Advanced/Batch view, THE Dashboard SHALL display the
   bulk tracker and its run and resume controls.

### Requirement 11: Settings and Progressive Disclosure

**User Story:** As a non-technical user, I want only the controls I need at each
step and advanced settings tucked away, so that the app does not overwhelm me.

#### Acceptance Criteria

1. WHILE the main creation/review flow is shown, THE Dashboard SHALL display the
   L1 controls (Disclosure_Level L1): the topic/URL input, the create action, the
   Draft player, the per-scene edit boxes, and the Approve action.
2. WHILE the review surface is shown, THE Dashboard SHALL keep the L2 controls
   (Disclosure_Level L2: style pack, accent color, regenerate scene, scene
   add/remove/reorder) collapsed by default.
3. WHEN the user activates the L2 expand affordance, THE Dashboard SHALL reveal
   the L2 controls; WHEN the user deactivates it, THE Dashboard SHALL collapse
   them again.
4. THE Dashboard SHALL place the L3 controls (Disclosure_Level L3: AI account,
   voice, output location, advanced render options) in a separate Settings screen
   outside the main flow.
5. THE Dashboard SHALL NOT display L0 internals (Disclosure_Level L0: the
   Safety_Grid checks N1–N30 and their identifiers, determinism details, Manifest
   JSON, `.tsx` source, MCP, stack traces) anywhere in the user-facing interface.
6. WHEN an engine problem occurs, THE Dashboard SHALL surface a plain-language
   message stating what happened and the next action, SHALL retain the user's
   inputs/progress, and SHALL NOT display N-check codes, Safety_Grid identifiers,
   Manifest JSON, source, or stack traces.
7. THE Dashboard SHALL pre-populate each L3 setting with a default value so the
   user can complete the full creation flow without configuring any L3 control.
8. WHEN the user leaves the Settings screen back to the main flow, THE Dashboard
   SHALL preserve the in-progress project state.

### Requirement 12: Preserved Engine Invariants

**User Story:** As the product owner, I want every hard quality invariant of the
engine preserved on the Dashboard surface, so that the dashboard never weakens the
quality bar that is the product's moat.

#### Acceptance Criteria

1. THE Dashboard SHALL run the full Safety_Grid (the same check count and
   hard-error/warning classification as the engine, N1–N30) through the
   Orchestrator on every render, unchanged.
2. IF the Safety_Grid reports a hard error, THEN THE Orchestrator SHALL block the
   specific lock/render/done operation that triggered it (not unrelated
   operations), SHALL allow operations to continue when only soft warnings are
   present, and SHALL surface the failing check id(s) to the Agent_Worker / logs
   (not to the end user).
3. THE Dashboard SHALL enforce the Evidence_Gate (N9) so that no fabricated
   specifics are presented as fact.
4. IF the Evidence_Gate detects a fabricated specific, THEN THE Orchestrator SHALL
   block the render and SHALL indicate the offending content.
5. THE Dashboard SHALL enforce draft-first rendering, and IF a Full_Render is
   requested with no reviewed Draft and no explicit force-full override, THEN THE
   Orchestrator SHALL refuse the Full_Render.
6. THE Dashboard SHALL enforce determinism so that authored scene visuals remain
   pure functions of the frame (byte-identical output for identical frame
   inputs); IF a determinism violation is detected, THEN THE Orchestrator SHALL
   block the render and SHALL indicate the violating non-deterministic source.
7. THE Dashboard SHALL use the configured Vivibe voice and SHALL NOT substitute a
   mock, absent, or other voice unless the user explicitly requests no voice.
8. IF the voice configuration is incomplete, THEN THE Dashboard SHALL display a
   plain-language message naming the specific missing setting (key, endpoint, or
   voice id) and SHALL NOT substitute a lower-quality voice.
9. THE Dashboard SHALL write generated artifacts only under the `.video-tool/`
   home (projects, caches) and `planning/`, and SHALL NOT write scratch artifacts
   to the repository root (workspace hygiene).
10. THE Dashboard SHALL drive all operations through the single-process
    Orchestrator using one `@news/compositions` registry instance, and SHALL NOT
    create a second registry instance.
