import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultSettings } from "../../shared/settings-model.js";
import type { QueueProjectVM } from "../../shared/queue-types.js";
import { ProjectGrid, StableButtonLabel } from "../primitives.js";
import { QueueView } from "./queue.js";
import { SettingsView } from "./settings.js";

const noopAsync = async (): Promise<void> => {};

describe("Settings and Queue accessibility markup", () => {
  it("associates Settings labels with native controls", () => {
    const settings = defaultSettings("C:/out");
    const html = renderToStaticMarkup(React.createElement(SettingsView, {
      gateway: { kind: "ready", baseUrl: "http://localhost:20128/v1" },
      account: { kind: "disconnected" },
      models: [],
      settings,
      onManageAccounts: () => {},
      onSelectModel: () => {},
      onUpdate: () => {},
      onSetApiKey: async () => settings,
      onClearApiKey: async () => settings,
      onTestVoice: async () => ({ ok: false as const, error: "missing", voiceFailure: { provider: "vivibe" as const, code: "not_configured" as const, retryable: false } }),
      tab: "voice",
      onTabChange: () => {},
    }));

    expect(html).toContain('<label for="voice-provider"');
    expect(html).toContain('<select id="voice-provider"');
    expect(html).toContain('for="voice-api-key"');
    expect(html).toContain('id="voice-api-key"');
    expect(html).toContain('for="voice-id"');
    expect(html).toContain('id="voice-id"');

    const buildHtml = renderToStaticMarkup(React.createElement(SettingsView, {
      gateway: { kind: "ready", baseUrl: "http://localhost:20128/v1" },
      account: { kind: "disconnected" },
      models: [],
      settings,
      onManageAccounts: () => {},
      onSelectModel: () => {},
      onUpdate: () => {},
      onSetApiKey: async () => settings,
      onClearApiKey: async () => settings,
      onTestVoice: async () => ({ ok: false as const, error: "missing", voiceFailure: { provider: "vivibe" as const, code: "not_configured" as const, retryable: false } }),
      tab: "build",
      onTabChange: () => {},
    }));
    expect(buildHtml).toContain('role="spinbutton"');
    expect(buildHtml).toContain('aria-label="Số lần sửa lỗi"');
    expect(buildHtml).toContain('aria-valuemin="1" aria-valuemax="10"');
  });

  it("gives the Queue composer and icon buttons keyboard-readable names", () => {
    const queue: QueueProjectVM = {
      id: "queue-a",
      title: "project-1",
      createdAt: "2026-08-09T00:00:00.000Z",
      jobs: [],
    };
    const html = renderToStaticMarkup(React.createElement(QueueView, {
      queues: [queue],
      active: queue,
      load: "ready",
      defaultVoiceProvider: "vivibe",
      onRefresh: () => {},
      onCreateQueue: noopAsync,
      onOpenQueue: () => {},
      onDeleteQueue: () => {},
      onRenameQueue: noopAsync,
      onBackToList: () => {},
      onAddJob: noopAsync,
      onUpdateJob: async () => {},
      onDeleteJob: noopAsync,
      onCancelJob: noopAsync,
      onStartQueue: async () => ({ ok: true as const, mode: "started" as const }),
      onEnableFullAutoAndStart: async () => ({ ok: true as const, mode: "started" as const }),
      onPauseQueue: async () => ({ ok: true as const }),
      onResumeQueue: async () => ({ ok: true as const, mode: "started" as const }),
      onOpenVoiceSettings: () => {},
    }));

    expect(html).toContain('aria-label="Prompt video"');
    expect(html).toContain('role="group" aria-label="Cấu hình"');
    expect(html).toContain('aria-label="Thêm vào list"');
    expect(html).toContain('aria-label="Đổi tên hàng đợi"');
    expect(html).toContain('role="heading" aria-level="1"');
    expect(html).toContain('aria-hidden="true">Tạm dừng toàn bộ');
  });

  it("reserves every candidate label so state changes cannot shrink a button", () => {
    const html = renderToStaticMarkup(React.createElement(StableButtonLabel, {
      reserve: ["Đang kiểm tra…", "Kiểm tra"],
      children: "Kiểm tra",
    }));
    expect(html).toContain('ns-stable-button-label-reserve');
    expect(html).toContain('aria-hidden="true">Đang kiểm tra…');
    expect(html).toContain('ns-stable-button-label-current">Kiểm tra');
  });

  it("loads project thumbnails lazily", () => {
    const html = renderToStaticMarkup(React.createElement(ProjectGrid, {
      cards: [{
        projectId: "p1",
        title: "Project",
        thumbnailPath: "media://thumbnail.png",
        format: "tiktok",
        status: "done",
        createdAtLabel: "09/08/2026",
      }],
      onOpen: () => {},
    }));
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });
});
