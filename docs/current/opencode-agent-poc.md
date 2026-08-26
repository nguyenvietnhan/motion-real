# OpenCode + 9router headless POC (experimental)

This is a Phase-1 verification only. It does not change the desktop UI, Create
Flow, crawler, render path, or the production Remotion/TSX contract.

Run it from the repository root:

```powershell
$env:VIDEO_TOOL_HOME = "V:\Projects\motion-real\.video-tool"
# Optional: select the exact direct 9router model advertised by /v1/models.
$env:MOTIONREAL_9ROUTER_MODEL = "your-direct-model-id"
npm run probe:opencode
```

The runner invokes the upstream `opencode-ai@1.15.11` package by default, checks
the exact version before starting, and records a scrubbed report at
`VIDEO_TOOL_HOME/.video-tool/agent-probes/<run-id>/report.json`. It does not use
the globally installed OpenCode binary unless `MOTIONREAL_OPENCODE_BIN` is set;
that override must also return exactly `1.15.11` for `--version`.

Each run has its own working directory, OpenCode config/home, `AGENTS.md`, two
schema-validated custom probe tools, and a PNG attachment. Before OpenCode
starts, the runner installs the pinned custom-tool package into that run only;
this avoids the unbounded background dependency wait in OpenCode 1.15.11. It
has no route to MotionReal project files. The only approved custom write is
`agent-note.txt` in the run itself. `websearch` is an OpenCode/Exa-hosted
capability when enabled; the POC uses one fixed public query and does not retain
search content.

`report.json` is the sole diagnostic artifact to inspect. A failure may identify
the stage and a suspected layer, but it deliberately does not claim a root cause
without a direct-provider baseline. A `credential-bridge-needed` result means
OpenCode or the gateway rejected the existing app policy of no bearer key; the
POC never mints or stores one.

## Current Phase-1 result

The owned OpenCode fork has a local commit `8966cdc` based on upstream
`v1.15.11` (`d2bd7ea`). It applies OpenCode's existing `Permission.disabled`
logic in `ToolRegistry.tools()`, so fully denied built-ins are absent from both
the model prompt and the experimental catalog. Its targeted registry regression
passes. The fork is not pushed automatically.

The latest native-Windows POC run reaches this boundary successfully: it loads
the two probe tools plus `webfetch`/`websearch`, and verifies that `bash`,
`read`, `write`, `edit`, `patch`, `task`, and `skill` are absent. It then stops
at `provider_request` with `credential-bridge-needed`: the local 9router
gateway responds `401 Missing API key` to OpenCode's `/v1/chat/completions`
request. This is an intentional stop condition. The runner does not mint,
persist, or invent a bearer key.

The next phase requires an explicit credential-bridge design compatible with
the existing app: for example, an ephemeral key handoff to the isolated child
process, with redaction and cleanup. Only after that design is authorized can
the POC verify the model tool loop, session resume, web, vision, and abort.

## OpenCode fork

The owned upstream fork is [nguyenvietnhan/opencode](https://github.com/nguyenvietnhan/opencode),
forked from `anomalyco/opencode`. It is kept outside this repository and is not
vendored. The experimental patched binary used to establish the catalog boundary
was built locally from that fork; the default POC path remains the pinned
upstream release unless `MOTIONREAL_OPENCODE_BIN` explicitly overrides it.
Native Windows is the only supported runtime for this phase. If it fails there,
preserve `report.json` and plan a WSL phase rather than silently switching
environments.
