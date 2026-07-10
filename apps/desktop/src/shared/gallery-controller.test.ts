import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { ProjectBrief, ProjectState, ProjectSummary } from "@motionreal/pipeline";
import { formatShortDate, galleryLoadState, paginate, PROJECTS_PER_PAGE, toCards } from "./gallery-controller.js";
import { FRIENDLY_STATUSES } from "./friendly-status.js";

/**
 * Property 11: Gallery cards are complete and ordered
 * newest-first. For any ProjectSummary[], toCards produces one card per project
 * with a title, a thumbnail path or placeholder, a friendly status, and a
 * `ngày D tháng M năm YYYY` date, ordered most-recent-first.
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
          expect(["tiktok", "tiktok"]).toContain(card.format);
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

  it("prefers the AI-authored manifest title over the raw prompt, falling back to prompt then id", () => {
    // Authored project: the manifest title wins so the card reads the nice title,
    // not the long link/prompt the user typed.
    const [authored] = toCards([
      {
        projectId: "a",
        root: "/p/a",
        brief: brief("2026-01-02T00:00:00Z", "https://example.com/some/very/long/link", "done"),
        title: "Gemma 3 chạy trên máy nhà",
        hasRender: true,
      },
    ]);
    expect(authored!.title).toBe("Gemma 3 chạy trên máy nhà");

    // Scaffolded-but-unauthored: no manifest title yet ⇒ fall back to the prompt.
    const [unauthored] = toCards([
      { projectId: "b", root: "/p/b", brief: brief("2026-01-02T00:00:00Z", "tin kinh tế", "planning"), hasRender: false },
    ]);
    expect(unauthored!.title).toBe("tin kinh tế");

    // Neither title nor prompt ⇒ the id, so a card is never blank.
    const [blank] = toCards([
      { projectId: "c-00000003", root: "/p/c", brief: brief("2026-01-02T00:00:00Z", "", "planning"), hasRender: false },
    ]);
    expect(blank!.title).toBe("c-00000003");
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

  it("derives the gallery media ratio from the project brief", () => {
    const vertical = brief("2026-01-02T00:00:00Z", "dọc", "done");
    const landscape = { ...brief("2026-01-03T00:00:00Z", "ngang", "done"), ratio: "9:16" } as unknown as ProjectBrief;
    const cards = toCards([
      { projectId: "vertical", root: "/p/vertical", brief: vertical, hasRender: true },
      { projectId: "landscape", root: "/p/landscape", brief: landscape, hasRender: true },
    ]);
    expect(cards.find((card) => card.projectId === "vertical")?.format).toBe("tiktok");
    expect(cards.find((card) => card.projectId === "landscape")?.format).toBe("tiktok");
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
  });

  it("formatShortDate renders the viewer's LOCAL calendar day, not UTC", () => {
    // Build an ISO instant, then assert it formats to that instant's LOCAL
    // wall-clock day — so the test is timezone-independent (it derives the
    // expected day from the same Date the formatter sees). The bug this guards:
    // a project authored at 03:33 on the 13th in UTC+7 is the 12th in UTC, and a
    // UTC format showed the user the wrong day.
    const d = new Date("2026-06-12T20:33:00Z"); // 13th, 03:33 in UTC+7
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    expect(formatShortDate("2026-06-12T20:33:00Z")).toBe(`${dd}/${mm}/${d.getFullYear()}`);
  });
});

describe("paginate (projects gallery, I1/O3)", () => {
  const nums = (n: number) => Array.from({ length: n }, (_, i) => i);

  it("defaults to 12 per page (a 3×4 grid)", () => {
    expect(PROJECTS_PER_PAGE).toBe(12);
  });

  it("13 items split into 2 pages: 12 then 1", () => {
    const all = nums(13);
    const p1 = paginate(all, 1);
    expect(p1.items).toHaveLength(12);
    expect(p1.items[0]).toBe(0);
    expect(p1.totalPages).toBe(2);
    expect(p1.total).toBe(13);
    const p2 = paginate(all, 2);
    expect(p2.items).toEqual([12]);
    expect(p2.page).toBe(2);
  });

  it("clamps an out-of-range page into [1, totalPages] (a delete that empties the last page)", () => {
    const all = nums(13);
    // Asking for page 5 of a 2-page list shows the last page, not blank.
    const over = paginate(all, 5);
    expect(over.page).toBe(2);
    expect(over.items).toEqual([12]);
    // Page 0 / negative / NaN all fall back to page 1.
    expect(paginate(all, 0).page).toBe(1);
    expect(paginate(all, -3).page).toBe(1);
    expect(paginate(all, Number.NaN).page).toBe(1);
  });

  it("an empty list is one page that reads 1/1 (footer never shows 1/0)", () => {
    const p = paginate([], 1);
    expect(p.items).toEqual([]);
    expect(p.page).toBe(1);
    expect(p.totalPages).toBe(1);
    expect(p.total).toBe(0);
  });

  it("an exact multiple of the page size doesn't add a trailing empty page", () => {
    expect(paginate(nums(24), 1).totalPages).toBe(2);
    expect(paginate(nums(24), 2).items).toHaveLength(12);
  });

  it("a custom page size slices accordingly", () => {
    const p = paginate(nums(10), 2, 4);
    expect(p.items).toEqual([4, 5, 6, 7]);
    expect(p.totalPages).toBe(3);
  });
});
