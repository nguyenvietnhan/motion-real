import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectCardVM } from "../../shared/types.js";
import { ProjectGrid } from "../primitives.js";
import "../theme.css";

const project: ProjectCardVM = {
  projectId: "project-1",
  title: "Video đã hoàn tất",
  thumbnailPath: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
  format: "tiktok",
  status: "done",
  createdAtLabel: "Hôm nay",
  creationMode: "harness",
  agentDraftId: "agent-1",
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(node: React.ReactNode): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(node));
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("project gallery browser behavior", () => {
  it("uses the visible cover and title as the project-open button", async () => {
    const opened: string[] = [];
    await mount(<ProjectGrid cards={[project]} onOpen={(id) => opened.push(id)} />);

    const title = document.querySelector<HTMLElement>(".ns-project-title");
    const cover = document.querySelector<HTMLElement>(".ns-project-media");
    const openButton = document.querySelector<HTMLButtonElement>(".ns-project-open");

    expect(title?.closest("button")).toBe(openButton);
    expect(cover?.closest("button")).toBe(openButton);

    await act(async () => title?.click());
    await act(async () => cover?.click());
    expect(opened).toEqual(["project-1", "project-1"]);
  });
});
