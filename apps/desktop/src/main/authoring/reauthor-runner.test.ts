import { describe, expect, it, vi } from "vitest";
import { runReauthor, type ReauthorRunnerArgs } from "./reauthor-runner.js";

describe("runReauthor", () => {
  it("extracts theme.dominant from manifest and passes it to the reauthor prompt", async () => {
    let capturedSystemPrompt = "";
    const mockChat = vi.fn(async (_model: string, messages: any[]) => {
      capturedSystemPrompt = messages[0].content;
      return `\`\`\`tsx
// component: scene-01
import React from "react";
import { z } from "zod";
import { registerComponent } from "@motionreal/compositions";
export const schema = z.object({});
type Props = z.infer<typeof schema>;
const Scene: React.FC = () => <div>Repaired</div>;
export const example: Props = {};
export default registerComponent({ id: "scene-01", displayName: "Repaired", schema, Component: Scene, example });
\`\`\``;
    });

    const mockAdmit = vi.fn(async () => ({ ok: true, id: "scene-01" } as any));
    const mockReadText = vi.fn(async () => "// original code");
    const mockWriteText = vi.fn(async () => {});

    const args: ReauthorRunnerArgs = {
      model: "mock-model",
      projectId: "proj-1",
      targets: [{ sceneId: "scene-01", componentId: "scene-01", issues: [] }],
      reviewDir: "review",
      loadManifest: async () => ({
        theme: { dominant: "#10B981" },
        scenes: [{ id: "scene-01", component: "scene-01" }],
      }),
      resolveSceneFile: async () => ({ componentId: "scene-01", path: "/mock/scene-01.tsx" }),
      readText: mockReadText,
      writeText: mockWriteText,
      readStillDataUrl: () => undefined,
      chat: mockChat,
      admitOne: mockAdmit,
      unregisterComponent: () => {},
      logger: {
        debug: () => {},
        warn: () => {},
        error: () => {},
      },
    };

    const result = await runReauthor(args);
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0].sceneId).toBe("scene-01");
    // System prompt must contain the custom dominant color from manifest
    expect(capturedSystemPrompt).toContain("#10B981");
    expect(capturedSystemPrompt).toContain('ACCENT_PRIMARY: "#10B981"');
  });

  it("handles unreadable manifest safely by falling back to default dominant color", async () => {
    let capturedSystemPrompt = "";
    const mockChat = vi.fn(async (_model: string, messages: any[]) => {
      capturedSystemPrompt = messages[0].content;
      return `\`\`\`tsx
// component: scene-01
import React from "react";
import { z } from "zod";
import { registerComponent } from "@motionreal/compositions";
export const schema = z.object({});
type Props = z.infer<typeof schema>;
const Scene: React.FC = () => <div>Repaired</div>;
export const example: Props = {};
export default registerComponent({ id: "scene-01", displayName: "Repaired", schema, Component: Scene, example });
\`\`\``;
    });

    const args: ReauthorRunnerArgs = {
      model: "mock-model",
      projectId: "proj-1",
      targets: [{ sceneId: "scene-01", componentId: "scene-01", issues: [] }],
      reviewDir: "review",
      loadManifest: async () => {
        throw new Error("Disk error");
      },
      resolveSceneFile: async () => ({ componentId: "scene-01", path: "/mock/scene-01.tsx" }),
      readText: async () => "// original code",
      writeText: async () => {},
      readStillDataUrl: () => undefined,
      chat: mockChat,
      admitOne: async () => ({ ok: true, id: "scene-01" } as any),
      unregisterComponent: () => {},
      logger: {
        debug: () => {},
        warn: () => {},
        error: () => {},
      },
    };

    const result = await runReauthor(args);
    expect(result.scenes).toHaveLength(1);
    // Should fall back to default #38BDF8
    expect(capturedSystemPrompt).toContain("#38BDF8");
  });
});
