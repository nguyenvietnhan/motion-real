import React from "react";

/** Small, safe subset for Agent replies; raw HTML is deliberately never parsed. */
export const AgentChatMarkdown: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.trim().startsWith("```")) code.push(lines[index++]!);
      if (index < lines.length) index += 1;
      blocks.push(<pre key={`code-${index}`}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (heading) {
      blocks.push(<h3 key={`heading-${index}`}>{inlineMarkdown(heading[2]!)}</h3>);
      index += 1;
      continue;
    }
    if (/^[-*_]{3,}$/.test(line.trim())) {
      blocks.push(<hr key={`rule-${index}`} />);
      index += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index]!)) {
        items.push(lines[index++]!.replace(/^\s*[-*]\s+/, ""));
      }
      blocks.push(<ul key={`list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</ul>);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index]!)) {
        items.push(lines[index++]!.replace(/^\s*\d+\.\s+/, ""));
      }
      blocks.push(<ol key={`ordered-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</ol>);
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index]!.trim()
      && !/^(#{1,6})\s+|^\s*[-*]\s+|^\s*\d+\.\s+|^```|^[-*_]{3,}$/.test(lines[index]!.trim())) {
      paragraph.push(lines[index++]!.trim());
    }
    blocks.push(<p key={`paragraph-${index}`}>{inlineMarkdown(paragraph.join(" "))}</p>);
  }
  return <div className="ns-agent-markdown">{blocks}</div>;
};

function inlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\))/g);
  return parts.filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(part);
    if (link) return <span key={index} className="ns-agent-chat-link" title={link[2]}>{link[1]}</span>;
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}
