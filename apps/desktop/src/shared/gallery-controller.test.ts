import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { ProjectBrief, ProjectState, ProjectSummary } from "@news/pipeline";
import { formatShortDate, galleryLoadState, toCards } from "./gallery-controller.js";
import { FRIENDLY_STATUSES } from "./friendly-status.js";

/**
 * Feature: web-dashboard, Property 11: Gallery cards are complete and ordered
 * newest-first. For any ProjectSummary[], toCards produces one card per project
 * with a title, a thumbnail path or placeholder, a friendly status, and a
 * `ngày D tháng M năm YYYY` date, ordered most-recent-first. (Req 10.1, 10.6)
 */

const STATES: ProjectState[] = [
  "planning",
  "planned",
  "scaffolded",
  "tts",
  "locking",
  "rendering",
  "reviewing",
  "done",
  "failed",
];

function brief(createdAt: string, prompt: string, state: ProjectState): ProjectBrief {
  return {
    projectId: "p",
    prompt,
    duration: 60,
    styleId: "clean-luxury-tech",
    ratio: "9:16",
    language: "vi",
    aiProvider: "mock",
    tts: { provider: "vivibe", speed: 1 },
    state,
    currentStep: "",
    error: null,
    createdAt,
    updatedAt: createdAt,
  };
}

const summaryArb: fc.Arbitrary<ProjectSummary> = fc
  .record({
    projectId: fc.string({ minLength: 1, maxLength: 10 }).map((s) => `proj-${s.replace(/\s/g, "_")}`),
    createdAt: fc
      .date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") })
      .map((d) => d.toISOString()),
    prompt: fc.string({ maxLength: 40 }),
    state: fc.constantFrom(...STATES),
    hasRender: fc.boolean(),
  })
  .map(({ projectId, createdAt, prompt, state, hasRender }) => ({
    projectId,
    root: `/projects/${projectId}`,
    brief: brief(createdAt, prompt, state),
    hasRender,
  }));

describe("Property 11: gallery cards complete and ordered newest-first", () => {
  it("one complete card per project, sorted by createdAt descending", () => {
    fc.assert(
      fc.property(fc.uniqueArray(summaryArb, { maxLength: 12, selector: (s) => s.projectId }), (summaries) => {
        const cards = toCards(summaries);
        expect(cards).toHaveLength(summaries.length);

        for (const card of cards) {
          expect(card.title.length).toBeGreaterThan(0);
          expect(FRIENDLY_STATUSES).toContain(card.status);
          expect(card.createdAtLabel).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
          // thumbnail is either a path or the null placeholder.
          expect(card.thumbnailPath === null || typeof card.thumbnailPath === "string").toBe(true);
        }

        // Newest-first: each card's source createdAt is >= the next.
        const dates = cards.map(
          (c) => summaries.find((s) => s.projectId === c.projectId)!.brief!.createdAt,
        );
        for (let i = 1; i < dates.length; i++) {
          expect(dates[i - 1]!.localeCompare(dates[i]!)).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("hasRender drives the thumbnail vs placeholder", () => {
    const [withRender] = toCards([
      { projectId: "a", root: "/p/a", brief: brief("2026-01-02T00:00:00Z", "t", "done"), hasRender: true },
    ]);
    expect(withRender!.thumbnailPath).toBe("/p/a/review/scene-01.png");
    const [noRender] = toCards([
      { projectId: "b", root: "/p/b", brief: brief("2026-01-02T00:00:00Z", "t", "scaffolded"), hasRender: false },
    ]);
    expect(noRender!.thumbnailPath).toBeNull();
  });
});

describe("galleryLoadState", () => {
  it("reports empty only after load completes", () => {
    expect(galleryLoadState(false, 0)).toBe("loading");
    expect(galleryLoadState(false, 5)).toBe("loading");
    expect(galleryLoadState(true, 0)).toBe("empty");
    expect(galleryLoadState(true, 3)).toBe("populated");
  });

  it("formatShortDate is empty for missing/invalid input", () => {
    expect(formatShortDate(undefined)).toBe("");
    expect(formatShortDate("not-a-date")).toBe("");
    expect(formatShortDate("2026-06-05T00:00:00Z")).toBe("05/06/2026");
  });
});
