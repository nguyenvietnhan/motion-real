import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentChatMarkdown } from "./agent-chat-markdown.js";

describe("AgentChatMarkdown", () => {
  it("renders the common Harness markdown subset without accepting raw HTML", () => {
    const text = [
      "### Tóm tắt",
      "Nội dung **quan trọng** và `asset.json`.",
      "",
      "- Mục một",
      "- [Nguồn](https://example.com/news)",
      "",
      "```json",
      "{\"ok\":true}",
      "```",
      "<script>alert(1)</script>",
    ].join("\n");
    const html = renderToStaticMarkup(React.createElement(AgentChatMarkdown, { text }));
    expect(html).toContain("<h3>Tóm tắt</h3>");
    expect(html).toContain("<strong>quan trọng</strong>");
    expect(html).toContain("<ul>");
    expect(html).toContain('title="https://example.com/news"');
    expect(html).not.toContain("href=");
    expect(html).toContain("<pre><code>{&quot;ok&quot;:true}</code></pre>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });
});
