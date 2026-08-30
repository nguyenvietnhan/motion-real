import type { AgentBriefInput } from "../../shared/types.js";

export type BriefDiscardAction = "back" | "return_to_assets" | "request_changes";
export type AgentBriefBaseline = { key: string; input: AgentBriefInput };

export function agentBriefBaselineKey(draftId: string, revision: number): string {
  return `${draftId}:${revision}`;
}

/** Only a new Agent brief revision may replace an in-progress user edit. */
export function reconcileAgentBriefInput(
  baseline: AgentBriefBaseline | null,
  current: AgentBriefInput | null,
  draftId: string,
  revision: number,
  generated: AgentBriefInput,
): { baseline: AgentBriefBaseline; input: AgentBriefInput; didReset: boolean } {
  const key = agentBriefBaselineKey(draftId, revision);
  if (baseline?.key === key && current) return { baseline, input: current, didReset: false };
  return { baseline: { key, input: generated }, input: generated, didReset: true };
}

export function isAgentBriefInputDirty(baseline: AgentBriefInput | null, current: AgentBriefInput | null): boolean {
  if (!baseline || !current) return false;
  return baseline.title !== current.title
    || baseline.prompt !== current.prompt
    || baseline.durationTier !== current.durationTier
    || baseline.videoLanguage !== current.videoLanguage
    || baseline.voiceProvider !== current.voiceProvider;
}

export function requiresBriefDiscardConfirmation(
  _action: BriefDiscardAction,
  baseline: AgentBriefInput | null,
  current: AgentBriefInput | null,
): boolean {
  return isAgentBriefInputDirty(baseline, current);
}
