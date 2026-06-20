import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type NotificationVariant = "success" | "info" | "warning" | "error";

export type NotificationAction = {
  label: string;
  onClick: () => void;
};

export type NotificationInput = {
  title: string;
  message?: string;
  details?: string;
  action?: NotificationAction;
};

export type NotificationItem = NotificationInput & {
  id: string;
  variant: NotificationVariant;
};

export type NotifyApi = {
  success: (input: NotificationInput) => string;
  info: (input: NotificationInput) => string;
  warning: (input: NotificationInput) => string;
  error: (input: NotificationInput) => string;
  dismiss: (id: string) => void;
};

export const NOTIFICATION_TTL_MS: Record<NotificationVariant, number> = {
  success: 3000,
  info: 4000,
  warning: 6000,
  error: 8000,
};

const MAX_NOTIFICATIONS = 5;

const noopNotify: NotifyApi = {
  success: () => "",
  info: () => "",
  warning: () => "",
  error: () => "",
  dismiss: () => {},
};

const NotificationContext = createContext<NotifyApi>(noopNotify);

export function notificationRole(variant: NotificationVariant): "status" | "alert" {
  return variant === "warning" || variant === "error" ? "alert" : "status";
}

export function notificationAriaLive(variant: NotificationVariant): "polite" | "assertive" {
  return variant === "warning" || variant === "error" ? "assertive" : "polite";
}

export function getNotificationTtlMs(variant: NotificationVariant): number {
  return NOTIFICATION_TTL_MS[variant];
}

export function dismissNotification(items: readonly NotificationItem[], id: string): NotificationItem[] {
  return items.filter((item) => item.id !== id);
}

export function stackNotification(items: readonly NotificationItem[], item: NotificationItem): NotificationItem[] {
  return [item, ...items.filter((existing) => existing.id !== item.id)].slice(0, MAX_NOTIFICATIONS);
}

export function scheduleNotificationDismiss(
  id: string,
  variant: NotificationVariant,
  dismiss: (id: string) => void,
): ReturnType<typeof setTimeout> {
  return setTimeout(() => dismiss(id), getNotificationTtlMs(variant));
}

export function errorDetails(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch (_error) {
    return String(error);
  }
}

export function compactNotificationMessage(details: string, fallback: string): string {
  const clean = details.replace(/\s+/g, " ").trim();
  if (!clean) return fallback;
  if (clean.length > 120) return fallback;
  if (/[{}[\]]|\bat\s+\S+\(|stack/i.test(clean)) return fallback;
  return clean;
}

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const seq = useRef(0);

  const dismiss = useCallback((id: string): void => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((current) => dismissNotification(current, id));
  }, []);

  const push = useCallback((variant: NotificationVariant, input: NotificationInput): string => {
    seq.current += 1;
    const id = `notification-${Date.now()}-${seq.current}`;
    const item: NotificationItem = { ...input, id, variant };
    setItems((current) => stackNotification(current, item));
    timers.current.set(id, scheduleNotificationDismiss(id, variant, dismiss));
    return id;
  }, [dismiss]);

  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      for (const timer of activeTimers.values()) clearTimeout(timer);
      activeTimers.clear();
    };
  }, []);

  const api = useMemo<NotifyApi>(() => ({
    success: (input) => push("success", input),
    info: (input) => push("info", input),
    warning: (input) => push("warning", input),
    error: (input) => push("error", input),
    dismiss,
  }), [dismiss, push]);

  return (
    <NotificationContext.Provider value={api}>
      {children}
      <NotificationViewport notifications={items} onDismiss={dismiss} />
    </NotificationContext.Provider>
  );
};

export function useNotifications(): NotifyApi {
  return useContext(NotificationContext);
}

export const NotificationViewport: React.FC<{
  notifications: readonly NotificationItem[];
  onDismiss: (id: string) => void;
}> = ({ notifications, onDismiss }) => (
  <div className="ns-toast-viewport" aria-label="Thông báo">
    {notifications.map((notification) => (
      <NotificationToast key={notification.id} notification={notification} onDismiss={onDismiss} />
    ))}
  </div>
);

const NotificationToast: React.FC<{
  notification: NotificationItem;
  onDismiss: (id: string) => void;
}> = ({ notification, onDismiss }) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const role = notificationRole(notification.variant);
  const hasDetails = Boolean(notification.details?.trim());

  return (
    <section
      className={`ns-toast is-${notification.variant}`}
      role={role}
      aria-live={notificationAriaLive(notification.variant)}
    >
      <div className="ns-toast-main">
        <div className="ns-toast-copy">
          <h3>{notification.title}</h3>
          {notification.message && <p>{notification.message}</p>}
        </div>
        <button className="ns-toast-close" type="button" onClick={() => onDismiss(notification.id)} aria-label="Đóng">
          ×
        </button>
      </div>
      {(notification.action || hasDetails) && (
        <div className="ns-toast-actions">
          {hasDetails && (
            <button type="button" className="ns-toast-link" onClick={() => setDetailsOpen((open) => !open)}>
              Chi tiết
            </button>
          )}
          {notification.action && (
            <button type="button" className="ns-toast-link" onClick={notification.action.onClick}>
              {notification.action.label}
            </button>
          )}
        </div>
      )}
      {hasDetails && detailsOpen && <pre className="ns-toast-details">{notification.details}</pre>}
    </section>
  );
};
