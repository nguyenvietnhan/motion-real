# Temporary Task - Prompt Improvement Plan

Status: planning note revised after second review verification. No prompt code
changes have been made in this slice.

This is a temporary working note for improving MotionReal's runtime AI prompts.
It is not project contract. Current contract remains `AI_CONTRACT.md` plus
`docs/current/`.

Delete this file after the prompt migration is implemented, current docs/tests
are synced, checks pass, and the owner approves cleanup of this temporary note.

## Goal

Improve the quality and reliability of AI-authored video content, especially:

- stronger first-hook and viewer promise;
- sharper narration and title writing;
- better scene-by-scene story progression;
- less generic "title card plus text panel" output;
- fewer hallucinated facts or unsupported numbers;
- more reliable output shape without overloading one prompt.

Do not change prompt code until the owner approves the proposed implementation
slice.

## Review Verification

Review feedback was checked against current source and external sources on
2026-07-03.

Verified source facts:

- OpenAI prompt engineering and Structured Outputs docs are live and relevant:
  https://developers.openai.com/api/docs/guides/prompt-engineering and
  https://developers.openai.com/api/docs/guides/structured-outputs.
- Anthropic prompt engineering docs are live on `platform.claude.com` and cover
  clarity, examples, XML/section structure, and prompt chaining:
  https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices.
- Gemini prompt design strategies are live and relevant:
  https://ai.google.dev/gemini-api/docs/prompting-strategies.
- TikTok's own creative guidance emphasizes early content proposition / hook:
  https://ads.tiktok.com/help/article/creative-best-practices.
- YouTube's creator guidance emphasizes grabbing attention, making the topic
  clear early, and teasing the rest of the video:
  https://blog.youtube/news-and-events/this-is-first-of-series-of-posts/.
- YouTube Help's audience-retention docs are live and relevant as a measurement
  rationale: the intro metric tracks how many viewers remain after the first 30
  seconds, and YouTube ties a high intro percentage to the opening matching
  title/thumbnail expectations and keeping interest:
  https://support.google.com/youtube/answer/9314415.

Verified source/code feedback:

- `IMAGE_FILTER_SYSTEM` still says "video tin tức ngắn" in
  `apps/desktop/src/main/authoring/prompt.ts`. The current source audit did not
  find the English phrase "news short video" in active code, so PROMPT-1 must
  target the Vietnamese literal rather than the stale English paraphrase.
- `CREATIVE_BOOTSTRAP_INTENT` and `combineIntent(...)` are real prompt inputs:
  they feed `reauthorScenes(...)`, so they must be included in the prompt cleanup
  plan instead of only listed as surfaces.
- the first draft mixed an "omit if unsure" action with source labels. The
  revised plan separates source, confidence, and action.
- A baseline step must run before any prompt text changes. The revised next step
  is therefore PROMPT-0, not PROMPT-1.
- PROMPT-1 and PROMPT-5 below are behavior-bearing because they change text sent
  to live LLM/vision calls, even if output schemas and call counts stay the same.

## Current Prompt Surfaces

Main LLM and vision calls:

- `apps/desktop/src/main/authoring/prompt.ts`
  - `buildAuthorMessages(...)`
  - `buildReauthorMessages(...)`
  - `buildVisualQaMessages(...)`
  - `buildImageFilterMessages(...)`
- `apps/desktop/src/main/authoring/contract-text.ts`
  - `AUTHORING_CONTRACT`
- `apps/desktop/src/main/workspace/workspace-render-flow.ts`
  - `CREATIVE_BOOTSTRAP_INTENT`
  - `visionRepairIntent(...)`
- `apps/desktop/src/main/workspace/workspace-helpers.ts`
  - `combineIntent(...)`
- `apps/desktop/src/main/gateway/ninerouter-client.ts`
  - continuation prompt when `finish_reason` is `length`
  - final dispatch to `/v1/chat/completions`

Current flow:

```text
desktop/user input
-> authoring or edit worker
-> prompt builder or intent builder
-> NineRouterClient.chat(...)
-> /v1/chat/completions
```

TTS calls send narration text to voice providers. They are not LLM prompts and
are out of scope for this plan.

## External Basis

Useful principles from verified sources:

- write clear, specific instructions;
- separate role, task, context, examples, and output format;
- use examples for desired style and format;
- use prompt chaining for complex tasks;
- use structured outputs when exact JSON matters;
- introduce the content proposition in the first seconds;
- make the first hook immediately clear and attention-grabbing;
- tease the rest of the video early;
- align intro content with title/thumbnail/viewer expectation.

## Diagnosis

The current prompts are strong on technical safety:

- import whitelist and banned APIs are explicit;
- output fences and code markers are explicit;
- repair prompts preserve scene identity;
- visual QA is narrowly scoped;
- image refs are constrained.

The main weakness is overload in `buildAuthorMessages(...)`:

```text
one call must choose story angle
-> write title and narration
-> plan visual metaphors
-> satisfy source/fact constraints
-> satisfy output manifest contract
-> write all TSX scene modules
```

This makes content quality compete with code generation. The model can satisfy
syntax and format while producing flat story beats.

Other issues to address:

- the content rules are mostly imperative, with few positive examples of a
  complete good beat;
- words like "bold" and "creative" help, but are not a measurable story rubric;
- factual grounding is a negative rule ("do not invent") rather than a positive
  claim ledger;
- the code skeleton is useful for structure but can dominate the model's visual
  imagination;
- `IMAGE_FILTER_SYSTEM` still says "video tin tức ngắn", while the product now
  supports any topic;
- `CREATIVE_BOOTSTRAP_INTENT` and user edit intents (`combineIntent(...)`) are
  live prompt inputs and need explicit cleanup/test coverage;
- prompt steps that change live LLM text should run broad checks, even if the
  output schema does not change.

## Proposed Direction

Split prompt responsibility into a content-first chain:

```text
Call A: Content Plan
  input: user brief, readable source material, chosen format, tier, language,
         approved image refs
  output: strict JSON storyboard and evidence/claim ledger

Call B: Code Authoring
  input: validated content plan plus authoring contract
  output: manifest JSON plus TSX scene modules
```

This lets the first model pass focus on viewer experience and the second pass
focus on valid Remotion code.

Fallback policy must be explicit before PROMPT-4 starts:

- target behavior: two-step authoring is the default for all fresh authoring once
  enabled;
- do not silently fall back to the old one-step authoring path when Content Plan
  fails, because that bypasses the claim ledger and weakens the hallucination
  goal;
- acceptable failure behavior: fail cleanly with a retryable message, or retry
  Content Plan with stricter feedback;
- any temporary one-step fallback must be owner-approved, visible in code/tests,
  and must not be the default production path.

If an extra API call is considered too expensive, pause before PROMPT-4 and make
an owner decision. Do not implement a hidden cost-saving branch that keeps old
fact-grounding risk alive.

## Proposed Content Plan Shape

Target JSON fields:

```json
{
  "title": "...",
  "viewerPromise": "...",
  "hookType": "surprise|number|contradiction|question|visual-shock|stakes",
  "first3SecondsLine": "...",
  "openLoop": "...",
  "payoff": "...",
  "claims": [
    {
      "id": "claim-01",
      "text": "...",
      "support": "user_brief|source_material|common_knowledge",
      "confidence": "supported|uncertain",
      "action": "use|omit"
    }
  ],
  "scenes": [
    {
      "sceneId": "scene-01",
      "purpose": "hook|context|turn|proof|contrast|payoff|cta",
      "beat": "...",
      "narration": "...",
      "onScreenText": "...",
      "visualMetaphor": "...",
      "layoutFamily": "big-number|two-column|timeline|diagram|list|signature-visual|statement",
      "evidenceClaimIds": ["claim-01"]
    }
  ]
}
```

Why:

- `viewerPromise` keeps the title/opening aligned with the payoff.
- `first3SecondsLine` follows TikTok's early content proposition rule.
- `openLoop` and `payoff` force the video to create and resolve curiosity.
- `purpose` prevents scenes from becoming interchangeable.
- `layoutFamily` preserves variety without telling the model to use a fixed kit.
- `claims` make fact risk explicit before narration/code generation.
- `confidence` and `action` avoid mixing source labels with action labels.

Claim-ledger enforcement:

- `action: "omit"` claims must not be available to Call B as usable facts.
- scenes must reference only `use` claims, or no claim when the beat is opinion,
  synthesis, or visual framing.
- tests must cover that omitted/uncertain claims do not appear in the code-author
  prompt input.
- if no reliable claim supports a number/date/price, the planner must rewrite
  the beat without that unsupported detail.

## Positive Beat Examples

The content-plan prompt should include a few short examples. They should be
examples of story beats, not TSX/code style, so they do not create visual clone
pressure.

Example pattern:

```text
Weak:
  beat: "Explain why AI chips are expensive."
  narration: "AI chips are becoming more expensive and important."
  visual: "A card with text."

Strong:
  viewerPromise: "By the end, the viewer understands the one bottleneck making
  AI hardware feel impossibly expensive."
  hook: "The chip is not expensive because it is small. It is expensive because
  almost nobody can make it."
  beat: "Reveal scarcity before specs."
  visualMetaphor: "A tiny glowing chip behind a huge locked factory gate."
```

Tests should assert that examples teach:

- hook / promise / payoff;
- specific over generic;
- visual metaphor over text card;
- claim support for concrete numbers.

## Proposed Prompt Rubric Changes

Replace broad creative pressure with measurable checks:

- Every scene must advance exactly one viewer-facing idea.
- Scene 1 must make a concrete promise or tension in the first line.
- No scene should be only "headline plus body text" unless it is a deliberate
  statement beat.
- On-screen text should be short enough to scan quickly.
- Narration should add information that is not already duplicated verbatim on
  screen.
- Any number/date/price/source claim must appear in the claim ledger or be
  omitted.
- The final scene must resolve the open loop or leave a deliberate question.

Keep:

- format geometry rules;
- word budget from selected duration tier and language;
- language rules;
- import whitelist and TSX contract;
- image ref constraints;
- vision fallback.

Reduce or move:

- long creative-writing pressure inside the same prompt as TSX code;
- repeated "be bold" language where a concrete story rubric can replace it;
- code skeleton dominance in the content-planning phase.

## Proposed Implementation Slices

### PROMPT-0: Baseline And Snapshot

No behavior change. Must run before PROMPT-1.

Actions:

- snapshot current prompt surfaces;
- add or update tests that capture important current invariants;
- record current prompt lengths and call counts;
- confirm current live prompt call sites.

Checks:

```bash
git status --short
npm.cmd test -- apps/desktop/src/main/authoring/prompt.test.ts
npm.cmd test -- apps/desktop/src/main/authoring/ninerouter-backend.test.ts
npm.cmd test -- apps/desktop/src/main/workspace/workspace-render-flow.test.ts
npm.cmd test -- apps/desktop/src/main/workspace/workspace-helpers.test.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Commit suggestion:

```text
test: snapshot current prompt behavior
```

### PROMPT-1: Remove Current Prompt Noise

Narrow behavior-bearing prompt text cleanup.

Actions:

- replace remaining "video tin tức ngắn" wording in `IMAGE_FILTER_SYSTEM`;
- treat "news short video" as a stale English paraphrase to audit, not as the
  primary source literal for this prompt;
- update comments that describe the old prompt role inaccurately;
- do not change output structure or call count.

Checks:

```bash
npm.cmd test -- apps/desktop/src/main/authoring/prompt.test.ts
npm.cmd test -- apps/desktop/src/main/authoring/ninerouter-backend.test.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Commit suggestion:

```text
chore: remove stale prompt wording
```

### PROMPT-2: Add Content Plan Schema And Builder

No live gateway behavior yet.

Actions:

- add `apps/desktop/src/main/authoring/content-plan.ts`;
- add `apps/desktop/src/main/authoring/content-plan.test.ts`;
- add a content plan schema/parser;
- add a prompt builder for content planning;
- add fixtures for TikTok Vietnamese, YouTube English, with-source, no-source,
  and with-images cases;
- include source/confidence/action claim ledger rules;
- include positive good-beat examples.

Do not put the new content-plan schema tests in `manifest-schema.test.ts`; that
name belongs to the existing authored manifest concept and would blur two
different contracts.

Checks:

```bash
npm.cmd test -- apps/desktop/src/main/authoring/content-plan.test.ts
npm.cmd test -- apps/desktop/src/main/authoring/prompt.test.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Commit suggestion:

```text
feat: add content plan prompt contract
```

### PROMPT-3: Add Content Quality Eval Fixtures

No live gateway behavior yet.

Actions:

- add deterministic local tests for prompt text and parsed plan examples;
- test that hook, viewer promise, payoff, claim ledger, and layout diversity are
  required;
- test that `action: "omit"` claims are filtered before code-authoring input;
- do not rely on live model calls in unit tests.

Checks:

```bash
npm.cmd test -- apps/desktop/src/main/authoring/content-plan.test.ts
npm.cmd test -- apps/desktop/src/main/authoring/prompt.test.ts
npm.cmd run typecheck
```

Commit suggestion:

```text
test: add content prompt quality fixtures
```

### PROMPT-4: Wire Two-Step Authoring

Behavior change. Requires owner approval for the extra API call and failure
policy before starting.

Actions:

- call content-plan prompt before TSX authoring;
- validate/filter the plan before code authoring;
- feed only usable claims and scene plan data into the code-authoring prompt;
- fail cleanly or retry Content Plan on planning failure;
- do not silently fall back to legacy one-step authoring by default;
- preserve image and source safeguards.

Checks:

```bash
npm.cmd test -- apps/desktop/src/main/authoring/content-plan.test.ts
npm.cmd test -- apps/desktop/src/main/authoring/ninerouter-backend.test.ts
npm.cmd test -- apps/desktop/src/main/authoring/prompt.test.ts
npm.cmd test -- apps/desktop/src/main/authoring/reply-parser.test.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Commit suggestion:

```text
feat: plan content before authoring scenes
```

### PROMPT-5: Tighten Reauthor, User Edit, Bootstrap, And Visual QA Prompts

Behavior-bearing prompt text cleanup.

Actions:

- add a small preserve-patch-verify repair rubric;
- keep repair local and scene-id stable;
- review `combineIntent(...)` so video-wide and per-scene user edits are framed
  clearly without weakening scene scope;
- review `CREATIVE_BOOTSTRAP_INTENT` so "bold" maps to concrete story/visual
  improvement rather than vague aesthetic pressure;
- keep visual QA limited to clear layout defects;
- avoid turning taste/aesthetic preferences into hard defects.

Checks:

```bash
npm.cmd test -- apps/desktop/src/main/authoring/prompt.test.ts
npm.cmd test -- apps/desktop/src/main/workspace/workspace-render-flow.test.ts
npm.cmd test -- apps/desktop/src/main/workspace/workspace-helpers.test.ts
npm.cmd test -- apps/desktop/src/main/authoring/ninerouter-backend.test.ts
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Commit suggestion:

```text
refactor: tighten prompt repair intents
```

### PROMPT-6: Final Prompt Audit

Actions:

- audit all prompt text for stale product wording;
- audit that all current LLM/vision prompt surfaces are intentionally covered;
- ensure docs/current only describe implemented behavior;
- remove this temporary note only after owner approval.

Checks:

```bash
rg -n "news short video|video tin tức|style pack|stylePack|block library|PICK mode|legacy" apps docs README.md AI_CONTRACT.md
git status --short
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Commit suggestion:

```text
chore: finish prompt cleanup audit
```

## Guardrails

- Do not weaken authored-scene admission.
- Do not reintroduce style packs, block authoring, or theme-token leashes.
- Do not let the model choose format, duration tier, language, provider, or
  image refs.
- Do not add live-model tests to the default test lane.
- Do not change TTS behavior in the prompt cleanup slice.
- Do not silently fall back to unsupported facts or invented numbers.
- Do not silently bypass the content-plan claim ledger after PROMPT-4.
- Keep prompt changes covered by focused tests before broad checks.
- Treat any change to text sent to an LLM or vision model as behavior-bearing,
  even when schemas and call counts stay the same.

## Recommended Next Step

Start with PROMPT-0.

Reason:

- it creates the baseline the review correctly identified as missing before
  prompt text changes;
- it captures current prompt invariants and call surfaces;
- it gives PROMPT-1 and later behavior-bearing prompt edits a clean comparison
  point.

Do not start PROMPT-4 until the owner approves the extra API-call behavior and
the no-silent-one-step-fallback policy.
