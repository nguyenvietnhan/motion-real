import type { AgentProductionState } from "../../shared/types.js";

export const AGENT_WORKFLOW_VERSION = 1 as const;

export type AgentWorkflowRecord = {
  workflowVersion: typeof AGENT_WORKFLOW_VERSION;
  workflowRevision: number;
  productionState: AgentProductionState;
  activeJobId?: string;
  lastError?: string;
};

export type AgentWorkflowTransition = {
  expectedRevision: number;
  to: AgentProductionState;
  jobId?: string;
  error?: string;
};

const STATES = new Set<AgentProductionState>([
  "discovery",
  "collecting_assets",
  "asset_review",
  "brief_review",
  "queued_create",
  "authoring",
  "still_review",
  "draft_render",
  "draft_review",
  "final_render",
  "completed",
  "error",
]);

const NEXT: Record<AgentProductionState, readonly AgentProductionState[]> = {
  discovery: ["collecting_assets"],
  collecting_assets: ["asset_review", "error"],
  asset_review: ["collecting_assets", "brief_review", "error"],
  brief_review: ["asset_review", "queued_create", "error"],
  queued_create: ["authoring", "error"],
  authoring: ["still_review", "draft_render", "error"],
  still_review: ["authoring", "draft_render", "error"],
  draft_render: ["draft_review", "error"],
  draft_review: ["authoring", "final_render", "error"],
  final_render: ["completed", "error"],
  completed: [],
  error: ["discovery"],
};

export function initialAgentWorkflow(): AgentWorkflowRecord {
  return {
    workflowVersion: AGENT_WORKFLOW_VERSION,
    workflowRevision: 0,
    productionState: "discovery",
  };
}

/** Missing workflow fields are a legacy record; explicit malformed fields fail closed. */
export function parseAgentWorkflow(value: Record<string, unknown>): AgentWorkflowRecord | null {
  if (value.workflowVersion === undefined
    && value.workflowRevision === undefined
    && value.productionState === undefined) {
    return initialAgentWorkflow();
  }
  if (value.workflowVersion !== AGENT_WORKFLOW_VERSION
    || !Number.isSafeInteger(value.workflowRevision)
    || Number(value.workflowRevision) < 0
    || typeof value.productionState !== "string"
    || !STATES.has(value.productionState as AgentProductionState)) {
    return null;
  }
  const productionState = value.productionState as AgentProductionState;
  const activeJobId = validJobId(value.activeJobId) ? value.activeJobId : undefined;
  if (productionState === "discovery" && activeJobId !== undefined) return null;
  if (productionState !== "discovery" && activeJobId === undefined) return null;
  if (value.lastError !== undefined && typeof value.lastError !== "string") return null;
  const lastError = typeof value.lastError === "string" ? value.lastError.trim().slice(0, 500) : undefined;
  if (productionState === "error" && !lastError) return null;
  if (productionState !== "error" && lastError) return null;
  return {
    workflowVersion: AGENT_WORKFLOW_VERSION,
    workflowRevision: Number(value.workflowRevision),
    productionState,
    ...(activeJobId ? { activeJobId } : {}),
    ...(lastError ? { lastError } : {}),
  };
}

export function transitionAgentWorkflow(
  current: AgentWorkflowRecord,
  request: AgentWorkflowTransition,
): AgentWorkflowRecord {
  if (request.expectedRevision !== current.workflowRevision) {
    throw new Error("Trạng thái Video Agent đã thay đổi; hãy tải lại trước khi tiếp tục.");
  }
  if (!NEXT[current.productionState].includes(request.to)) {
    throw new Error(`Không thể chuyển Video Agent từ ${current.productionState} sang ${request.to}.`);
  }

  if (current.productionState === "discovery") {
    if (!validJobId(request.jobId)) throw new Error("Thiếu job id hợp lệ để bắt đầu chuẩn bị video.");
    return {
      workflowVersion: AGENT_WORKFLOW_VERSION,
      workflowRevision: current.workflowRevision + 1,
      productionState: request.to,
      activeJobId: request.jobId,
    };
  }

  if (request.jobId !== current.activeJobId) {
    throw new Error("Job Video Agent không khớp với workflow hiện tại.");
  }
  if (request.to === "discovery") {
    return {
      workflowVersion: AGENT_WORKFLOW_VERSION,
      workflowRevision: current.workflowRevision + 1,
      productionState: "discovery",
    };
  }
  const error = request.to === "error" ? request.error?.trim().slice(0, 500) : undefined;
  if (request.to === "error" && !error) throw new Error("Thiếu mô tả lỗi Video Agent.");
  return {
    workflowVersion: AGENT_WORKFLOW_VERSION,
    workflowRevision: current.workflowRevision + 1,
    productionState: request.to,
    activeJobId: current.activeJobId,
    ...(error ? { lastError: error } : {}),
  };
}

function validJobId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}
