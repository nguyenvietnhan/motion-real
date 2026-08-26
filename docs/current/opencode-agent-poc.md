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

The runner invokes the upstream `opencode-ai@1.15.11` package, checks the exact
version before starting, and records a scrubbed report at
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

## Current Phase-1 boundary finding

On native Windows, upstream OpenCode `1.15.11` can start with the isolated
9router provider and load the custom tools after dependency preflight. However,
its experimental tool-catalog endpoint returns the raw registry before
permission filtering. That means denied built-ins such as `bash`, `read`, and
`write` still appear in the catalog even though `motionreal-video`'s effective
permission is `deny`. The POC deliberately fails in this condition: the Phase-1
requirement is absence from the exposed tool catalog, not merely a prompt rule.
Do not proceed to UI integration from this result. Resolving it requires a
separate decision to patch the owned OpenCode fork or change the runtime
boundary; Phase 1 itself does not patch upstream.

## OpenCode fork

The owned upstream fork is [nguyenvietnhan/opencode](https://github.com/nguyenvietnhan/opencode),
forked from `anomalyco/opencode`. It is not cloned, patched, built, or vendored
by this repository. Fork ownership is separate from runtime evidence: this POC
always tests the unmodified, pinned upstream release `v1.15.11` (`d2bd7ea`).
Native Windows is the only supported runtime for this phase. If it fails there,
preserve `report.json` and plan a WSL phase rather than silently switching
environments.
