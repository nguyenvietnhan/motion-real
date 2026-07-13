## Summary

<!-- What does this PR change and why? -->

## Type of change

- [ ] Bug fix
- [ ] Feature
- [ ] Docs / open-source hygiene
- [ ] Refactor (no intended behavior change)
- [ ] Tests only

## Checklist

- [ ] I read `AI_CONTRACT.md` (and `CONTRIBUTING.md` for product boundaries)
- [ ] Diff is scoped; no unrelated refactors
- [ ] No secrets, `.env`, or `.video-tool/` project trees committed
- [ ] If I touched pipeline / blocks / compositions / desktop authoring:
  - [ ] `npm run typecheck`
  - [ ] `npm test`
  - [ ] `npm run build`
- [ ] If I changed a behavior contract, I updated `docs/current/` (or README) accordingly
- [ ] I avoided casual edits to sensitive areas (`orchestrator.ts`, `render-grid.ts`, workspace / authoring facades) unless the PR is focused there with tests

## Test plan

<!-- How did you verify? Commands, screenshots (redacted), manual paths. -->
