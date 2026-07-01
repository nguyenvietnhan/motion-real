# Safety Grid

The safety grid is the project's quality and integrity boundary. It is not just
prompt guidance.

## Principle

Repeated AI-output defects should be handled at the strongest practical layer:

1. schema validation;
2. normalizer;
3. admission gate;
4. render oracle;
5. prompt rule only as a last resort.

New checks should have non-vacuous tests: a known-bad fixture proving the check
fires.

## Hard Blockers

Current hard blockers are admission/security and render-integrity classes:

- disallowed authored imports;
- forbidden authored APIs;
- unknown component ids;
- unsafe or remote media;
- crash-class authored type/build errors;
- Remotion bundle failure;
- invalid locked timing or audio;
- determinism failure;
- duplicate scene ids;
- empty specs.

These block lock/render/done because they can make the video unsafe, missing, or
non-reproducible.

## Advisory Warnings

Layout, aesthetic, density, contrast, pacing, and content-quality checks are
generally advisory warnings unless live code marks a specific class as a hard
render-integrity failure.

Warnings still matter. They feed hidden refine, reports, and review, but they
should not become hard look/style constraints without owner approval.

## Important Checks

- N4: authored import whitelist.
- N5: forbidden APIs.
- N9: evidence/media gate.
- N10: authored typecheck; crash/fallback-prone diagnostics can block.
- N11: bundle integrity.
- N12/N13: locked timing and scene audio.
- N16: determinism.
- N14/N15/N17/N18/N20/N30: visual/layout/readability/density classes that are
  primarily advisory in the freeform posture.

## Do Not Regress

Do not reintroduce hard aesthetic gates. Do not force a fixed visual style,
theme, style pack, or layout toolkit through the safety grid.

