# Video Agent Preview — runtime verification (experimental)

The desktop **Agent** tab is a deliberately restricted Developer Preview. It is
not a replacement for Home, Create Flow, WorkspaceController, the crawler, or
the production Remotion/TSX workflow.

Its exact catalog is only:

- `websearch` for hosted discovery through OpenCode/Exa;
- `motionreal_submit_proposal` for a bounded, user-reviewed proposal.

It cannot fetch arbitrary URLs, download assets, crawl, access files or shell,
render, apply edits directly, receive image uploads, or assess video motion.
Source/image URLs are presented to the user as references with unverified usage
rights. An approved create proposal only fills the Home composer; an approved
edit proposal only calls the existing `WorkspaceController.submitEdits` path.

## Runtime gate

The preview is enabled only when all of these agree:

- Native Windows, OpenCode `1.15.11`, 9router `0.5.55`, and model
  `ag/gemini-3.7-flash-high`.
- 9router is actually listening only on `127.0.0.1` or `::1`.
- the internal credential is available to Electron Main and `/v1/models`
  advertises the pinned model;
- the OpenCode plugin cache is valid against the committed
  `apps/desktop/runtime/opencode-plugin/package-lock.json`;
- a fresh, successful `verify:agent-preview` report exactly matches the
  runtime versions, model, plugin-cache fingerprint and protocol revision.

The historical upstream reference is OpenCode `v1.15.11` / `d2bd7ea`. The
runtime gate checks the binary version and the live catalog, not a claimed SHA.
The owned fork and its catalog patch remain POC ownership evidence outside this
repository; the live catalog check is the actual safety boundary.

Each sidecar has a random password held only in Electron Main memory. A
candidate sidecar is not considered active until health, `/doc`, config
isolation, exact catalog and OpenCode session creation all pass. Failed starts
are disposed. The sidecar is loopback-only and is recreated when it exits.

## Verifier

Run this only after 9router is running on loopback and use a short-lived local
credential in the current PowerShell process. The script cannot read Electron
Main's in-memory credential and never saves this value.

```powershell
$env:VIDEO_TOOL_HOME = "V:\Projects\motion-real\.video-tool"
$env:MOTIONREAL_OPENCODE_BIN = "C:\path\to\verified\opencode.exe"
$env:MOTIONREAL_9ROUTER_API_KEY = "your-local-9router-key"
npm.cmd run verify:agent-preview
```

It starts a real sidecar, verifies the exact catalog, requires the pinned model
to use `websearch`, then requires a schema-valid `create` proposal and an
assistant completion. It writes only a scrubbed report to
`VIDEO_TOOL_HOME/.video-tool/agent-runtime/preview-verification.json`: runtime
fingerprint, assertions, timestamp, safe failure stage and safe error text. It
does not write raw prompts, SSE, web results, sidecar stderr, credentials or
provider response bodies.

The plugin dependency is bootstrapped once with `npm ci --ignore-scripts` into
`VIDEO_TOOL_HOME/.video-tool/agent-runtime/`; session homes use Windows
junctions to that cache. A valid cache does not invoke npm. If the cache or a
junction is invalid, the Agent remains blocked rather than doing a per-session
`npm install` fallback.

## Sessions and privacy

**Ý tưởng mới** always creates a new UUID session. Project sessions resume the
latest compatible session for that project and refresh the title, scene/stage
and still context before the next sidecar starts. Sessions created before the
current protocol revision are marked **Phiên cũ không tương thích — chỉ xem
hoặc xóa**; they can never send another prompt.

OpenCode's local history may include messages, tool results and web-search
excerpts. **Xóa lịch sử** removes only the Agent sandbox/session record; it
never deletes a MotionReal project, assets or video. Project context sent to the
model is a normalized title, storyboard scene IDs/narration, stage and existing
still status—not arbitrary project files. The preview is text-only.

The older `npm run probe:opencode` remains an isolated Phase-1 POC and does not
replace this runtime verifier.
