import { describe, expect, it } from "vitest";
import type { AgentBriefInput } from "../../shared/types.js";
import {
  agentBriefBaselineKey,
  reconcileAgentBriefInput,
  isAgentBriefInputDirty,
  requiresBriefDiscardConfirmation,
} from "./agent-brief-state.js";

const baseline: AgentBriefInput = {
  title: "Tiêu đề",
  prompt: "Nội dung brief đủ dài để duyệt.",
  durationTier: 2,
  videoLanguage: "vi",
  voiceProvider: "vieneu",
};

describe("Agent brief edit state", () => {
  it("uses the draft id and brief revision as the only baseline identity", () => {
    expect(agentBriefBaselineKey("agent-1", 3)).toBe("agent-1:3");
    expect(agentBriefBaselineKey("agent-1", 4)).not.toBe(agentBriefBaselineKey("agent-1", 3));
  });

  it("marks every user-editable brief field dirty", () => {
    expect(isAgentBriefInputDirty(baseline, { ...baseline, title: "Tên mới" })).toBe(true);
    expect(isAgentBriefInputDirty(baseline, { ...baseline, prompt: "Nội dung mới" })).toBe(true);
    expect(isAgentBriefInputDirty(baseline, { ...baseline, durationTier: 3 })).toBe(true);
    expect(isAgentBriefInputDirty(baseline, { ...baseline, videoLanguage: "en" })).toBe(true);
    expect(isAgentBriefInputDirty(baseline, { ...baseline, voiceProvider: "vivibe" })).toBe(true);
    expect(isAgentBriefInputDirty(baseline, { ...baseline })).toBe(false);
  });

  it("keeps dirty input when settings defaults change, but resets on a new brief revision", () => {
    const dirty = { ...baseline, title: "Tên đang sửa" };
    const sameRevision = reconcileAgentBriefInput(
      { key: agentBriefBaselineKey("agent-1", 3), input: baseline },
      dirty,
      "agent-1",
      3,
      { ...baseline, durationTier: 1, voiceProvider: "vivibe" },
    );
    expect(sameRevision.didReset).toBe(false);
    expect(sameRevision.input).toEqual(dirty);

    const newerRevision = reconcileAgentBriefInput(
      sameRevision.baseline,
      sameRevision.input,
      "agent-1",
      4,
      { ...baseline, title: "Agent đã sửa" },
    );
    expect(newerRevision.didReset).toBe(true);
    expect(newerRevision.input).toMatchObject({ title: "Agent đã sửa" });
  });

  it("requires confirmation only when an edited brief would be discarded", () => {
    const edited = { ...baseline, title: "Chưa lưu" };
    expect(requiresBriefDiscardConfirmation("back", baseline, edited)).toBe(true);
    expect(requiresBriefDiscardConfirmation("return_to_assets", baseline, edited)).toBe(true);
    expect(requiresBriefDiscardConfirmation("request_changes", baseline, edited)).toBe(true);
    expect(requiresBriefDiscardConfirmation("back", baseline, baseline)).toBe(false);
  });
});
