import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dismissNotification,
  getNotificationTtlMs,
  notificationRole,
  NotificationViewport,
  scheduleNotificationDismiss,
  stackNotification,
  type NotificationItem,
} from "./notifications.js";

const item = (id: string, variant: NotificationItem["variant"]): NotificationItem => ({
  id,
  variant,
  title: "Title " + id,
  message: "Message " + id,
});

describe("notifications", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps status roles by variant", () => {
    expect(notificationRole("success")).toBe("status");
    expect(notificationRole("info")).toBe("status");
    expect(notificationRole("warning")).toBe("alert");
    expect(notificationRole("error")).toBe("alert");
  });

  it("uses the agreed auto-dismiss timings", () => {
    expect(getNotificationTtlMs("success")).toBe(3000);
    expect(getNotificationTtlMs("info")).toBe(4000);
    expect(getNotificationTtlMs("warning")).toBe(6000);
    expect(getNotificationTtlMs("error")).toBe(8000);
  });

  it("schedules auto-dismiss", () => {
    vi.useFakeTimers();
    const dismissed: string[] = [];
    scheduleNotificationDismiss("n1", "success", (id) => dismissed.push(id));

    vi.advanceTimersByTime(2999);
    expect(dismissed).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(dismissed).toEqual(["n1"]);
  });

  it("dismisses one toast and keeps the rest", () => {
    expect(dismissNotification([item("a", "info"), item("b", "error")], "a").map((n) => n.id)).toEqual(["b"]);
  });

  it("keeps a compact newest-first stack", () => {
    const stacked = ["a", "b", "c", "d", "e", "f"].reduce<NotificationItem[]>(
      (items, id) => stackNotification(items, item(id, "info")),
      [],
    );
    expect(stacked.map((n) => n.id)).toEqual(["f", "e", "d", "c", "b"]);
  });

  it("renders action, details, close, and alert role", () => {
    const html = renderToStaticMarkup(
      React.createElement(NotificationViewport, {
        notifications: [{
          ...item("x", "error"),
          details: "raw failure",
          action: { label: "Thử lại", onClick: () => {} },
        }],
        onDismiss: () => {},
      }),
    );

    expect(html).toContain("role=\"alert\"");
    expect(html).toContain("Title x");
    expect(html).toContain("Message x");
    expect(html).toContain("Chi tiết");
    expect(html).toContain("Thử lại");
    expect(html).toContain("aria-label=\"Đóng\"");
  });
});
