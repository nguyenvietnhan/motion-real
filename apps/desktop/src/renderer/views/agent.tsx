import React, { useState } from "react";
import { Icon } from "../icons.js";

/**
 * The Harness owns the chat, event timeline, tool cards, and history. Keeping
 * its web UI intact avoids rebuilding a partial copy in the desktop renderer.
 */
export const HARNESS_URL = "http://127.0.0.1:3080/";

export const AgentView: React.FC = () => {
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <section className="ns-agent-view" aria-label="Video Agent">
      <header className="ns-agent-chrome">
        <div>
          <h1 className="ns-agent-title">Video Agent</h1>
          <p className="ns-agent-subtitle">DeepSeek Harness — chat, tiến trình suy luận và hoạt động tool được hiển thị nguyên bản.</p>
        </div>
        <button
          type="button"
          className="ns-btn ns-agent-reload"
          onClick={() => setReloadKey((current) => current + 1)}
          title="Tải lại DeepSeek Harness"
        >
          {Icon.refresh({ size: 16 })}
          Tải lại
        </button>
      </header>
      <iframe
        key={reloadKey}
        className="ns-agent-frame"
        src={HARNESS_URL}
        title="DeepSeek Harness Video Agent"
        allow="clipboard-read; clipboard-write"
        referrerPolicy="no-referrer"
      />
    </section>
  );
};
