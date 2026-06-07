import React from "react";

/**
 * Renderer root (web-dashboard Task 1.1 placeholder). Real views — Onboarding,
 * Create, Storyboard, Gallery, Settings — are wired in Task 11 over the typed
 * IPC bridge. This shell only proves the React renderer mounts.
 */
export const App: React.FC = () => {
  return (
    <main style={{ fontFamily: "Inter, system-ui, sans-serif", padding: 32 }}>
      <h1 style={{ margin: 0 }}>News Studio</h1>
      <p style={{ color: "#6E6757" }}>Đang khởi tạo…</p>
    </main>
  );
};
