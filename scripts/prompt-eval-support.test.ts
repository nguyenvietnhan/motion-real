import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildEvalReviewRequest,
  contentPlanForReplay,
  forceContentPlanProfile,
  prunePromptEvalRuns,
} from "./prompt-eval-support.js";

describe("prompt eval support", () => {
  it("forces only the presentation profile in a valid planner reply", () => {
    const reply = JSON.stringify({
      title: "Fixture",
      presentationProfile: "editorial-story",
      viewerPromise: "Explain one mechanism clearly.",
      hookType: "question",
      first3SecondsLine: "How does it work?",
      openLoop: "Follow the signal.",
      payoff: "The mechanism becomes visible.",
      claims: [],
      scenes: [{
        sceneId: "scene-01",
        purpose: "hook",
        beat: "Open the mechanism.",
        narration: "A signal enters the system and produces one clear result.",
        onScreenText: "Signal to result",
        visualMetaphor: "A signal moving through connected stages.",
        motionProgression: "Reveal the path and hold the result.",
        temporalMode: "static",
        detailMode: "normal",
        layoutFamily: "diagram",
        evidenceClaimIds: [],
      }],
    });

    const forced = forceContentPlanProfile(reply, "mechanism-explainer");
    const parsed = JSON.parse(forced) as Record<string, unknown>;

    expect(parsed.presentationProfile).toBe("mechanism-explainer");
    expect(parsed.title).toBe("Fixture");
    expect(parsed.scenes).toEqual(JSON.parse(reply).scenes);
  });

  it("does not rewrite an invalid planner reply", () => {
    expect(forceContentPlanProfile("not a content plan", "product-showcase"))
      .toBe("not a content plan");
  });

  it("loads only a schema-valid plan for the requested eval case", () => {
    const valid = JSON.parse(forceContentPlanProfile(JSON.stringify({
      title: "Fixture",
      presentationProfile: "editorial-story",
      viewerPromise: "Understand what happened.",
      hookType: "question",
      first3SecondsLine: "What happened?",
      openLoop: "Follow the event.",
      payoff: "The event is clear.",
      claims: [],
      scenes: [{
        sceneId: "scene-01",
        purpose: "hook",
        beat: "Open the story.",
        narration: "The event begins with one clear change.",
        onScreenText: "The change",
        visualMetaphor: "A timeline marker.",
        motionProgression: "Reveal and hold.",
        temporalMode: "static",
        detailMode: "normal",
        layoutFamily: "timeline",
        evidenceClaimIds: [],
      }],
    }), "editorial-story"));

    expect(contentPlanForReplay({ live: [{ id: "case-a", contentPlan: valid }] }, "case-a"))
      .toEqual(valid);
    expect(contentPlanForReplay({ live: [{ id: "case-a", contentPlan: { title: "broken" } }] }, "case-a"))
      .toBeUndefined();
    expect(contentPlanForReplay({ live: [{ id: "case-b", contentPlan: valid }] }, "case-a"))
      .toBeUndefined();
  });

  it("uses each planned scene's own review intent", () => {
    const request = buildEvalReviewRequest(
      [
        { sceneId: "scene-01", temporalMode: "static", detailMode: "normal" },
        {
          sceneId: "scene-02",
          temporalMode: "continuous",
          detailMode: "fine",
          motionBeats: [
            { id: "command", anchor: "run command", action: "type command" },
            { id: "result", anchor: "show result", action: "reveal result" },
          ],
        },
      ],
      [
        { id: "scene-01" },
        { id: "scene-02", motionBeats: [{ id: "ignored" }, { id: "also-ignored" }] },
      ],
    );

    expect(request.scenes).toEqual([
      { sceneId: "scene-01", temporalMode: "static", detailMode: "normal" },
      {
        sceneId: "scene-02",
        temporalMode: "continuous",
        detailMode: "fine",
        motionBeatIds: ["command", "result"],
      },
    ]);
  });

  it("falls back safely for legacy output without a captured plan", () => {
    const request = buildEvalReviewRequest(undefined, [
      { id: "scene-01" },
      { id: "scene-02", motionProgression: "semantic: reveal two steps" },
    ]);

    expect(request.scenes).toEqual([
      { sceneId: "scene-01", temporalMode: "static", detailMode: "normal" },
      { sceneId: "scene-02", temporalMode: "stepped", detailMode: "normal" },
    ]);
  });

  it("retains only the newest eval runs and their matching artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "mr-prompt-eval-"));
    try {
      for (const [index, label] of ["old", "middle", "new"].entries()) {
        const report = join(root, `${label}.json`);
        await writeFile(report, JSON.stringify({ version: 1, label }), "utf8");
        await mkdir(join(root, `${label}-stills`));
        await writeFile(join(root, `${label}-contact-sheet.html`), label, "utf8");
        const at = new Date(1_000 + index * 1_000);
        await utimes(report, at, at);
      }
      await writeFile(join(root, "notes.json"), JSON.stringify({ owner: "user" }), "utf8");

      await prunePromptEvalRuns(root, 2);

      await expect(stat(join(root, "old.json"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(join(root, "old-stills"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(join(root, "old-contact-sheet.html"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(JSON.parse(await readFile(join(root, "notes.json"), "utf8"))).toEqual({ owner: "user" });
      await expect(stat(join(root, "middle.json"))).resolves.toBeDefined();
      await expect(stat(join(root, "new.json"))).resolves.toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
