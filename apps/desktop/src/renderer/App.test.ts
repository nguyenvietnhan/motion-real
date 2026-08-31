import { describe, expect, it } from "vitest";
import type { ProjectCardVM } from "../shared/types.js";
import * as appModule from "./App.js";

type GalleryOpenTarget =
  | { kind: "agent-draft"; draftId: string }
  | { kind: "agent-project"; projectId: string }
  | { kind: "workspace"; projectId: string };

type GalleryOpenTargetResolver = (
  projectId: string,
  card: ProjectCardVM | undefined,
) => GalleryOpenTarget;

const resolveTarget = (
  appModule as unknown as { galleryProjectOpenTarget?: GalleryOpenTargetResolver }
).galleryProjectOpenTarget;

const card = (overrides: Partial<ProjectCardVM> = {}): ProjectCardVM => ({
  projectId: "project-1",
  title: "Project 1",
  thumbnailPath: null,
  format: "tiktok",
  status: "done",
  createdAtLabel: "Hôm nay",
  ...overrides,
});

describe("gallery project routing", () => {
  it("opens a Harness card through its durable Agent draft id", () => {
    expect(resolveTarget?.("project-1", card({ creationMode: "harness", agentDraftId: "agent-1" }))).toEqual({
      kind: "agent-draft",
      draftId: "agent-1",
    });
  });

  it("uses project lookup only for legacy Harness cards without a draft id", () => {
    expect(resolveTarget?.("project-1", card({ creationMode: "harness" }))).toEqual({
      kind: "agent-project",
      projectId: "project-1",
    });
  });

  it("keeps Classic and unknown cards in the shared project workspace", () => {
    expect(resolveTarget?.("project-1", card({ creationMode: "classic" }))).toEqual({
      kind: "workspace",
      projectId: "project-1",
    });
    expect(resolveTarget?.("project-1", undefined)).toEqual({
      kind: "workspace",
      projectId: "project-1",
    });
  });
});
