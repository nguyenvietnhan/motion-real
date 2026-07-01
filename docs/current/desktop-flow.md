# Desktop Flow

The desktop app is the main user-facing workflow.

## Responsibilities

The Electron app handles:

- create screen and project gallery;
- model connection through the local 9router-compatible gateway;
- settings and encrypted provider keys;
- video language, format, duration tier, and voice provider choices;
- image staging and review;
- hidden stills/refine;
- script review;
- draft review and full render approval;
- BGM selection;
- thumbnail generation/export;
- final MP4 export.

## Runtime AI

The runtime model does not read repository docs directly. The desktop backend
builds prompts from current authoring contract text and sends plain messages
through the selected 9router model.

Development agents read `AI_CONTRACT.md` and `docs/current/*`. Runtime models
receive the contract text assembled by the app.

## Hidden Refine

Before the user sees the first draft, the desktop flow can run:

```text
author blind draft
-> render stills
-> creative bootstrap pass
-> render stills again
-> visual QA/refine passes
-> render draft MP4
```

The rough intermediate stills are hidden from the user. The first MP4 shown to
the user should already be the refined draft.

After draft review, edit flows skip the broad creative bootstrap and use scoped
vision/scene repair.

## Review Gates

- Script can be reviewed/edited before voice render when that gate is enabled.
- Draft MP4 must be reviewed before full render.
- Full render is only after explicit approval.

## Cancellation

The workspace flow supports cancellation between stages and passes. A deliberate
cancel is not treated as project failure.

