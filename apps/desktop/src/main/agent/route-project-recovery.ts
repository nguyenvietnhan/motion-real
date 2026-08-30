import type { AgentProductionState, ProjectStage } from "../../shared/types.js";

type RecoveryAction = "retry" | "fix" | "approve";
type Deps = {
  ownerOf: (id: string) => Promise<"classic" | "harness">;
  draftForProject: (id: string) => Promise<{ productionState: AgentProductionState } | null>;
  stage: (id: string) => Promise<ProjectStage>;
  resumeHarnessRender: (id: string) => Promise<void>;
  editHarness: (id: string, notes: string) => Promise<void>;
  publish: (id: string) => void;
  classic: (id: string, action: RecoveryAction) => void;
};

/** Retry buttons must preserve the persisted scene owner, including after restart. */
export async function routeProjectRecovery(id: string, action: RecoveryAction, deps: Deps): Promise<void> {
  if (await deps.ownerOf(id) === "classic") {
    deps.classic(id, action);
    return;
  }
  const draft = await deps.draftForProject(id);
  if (!draft) {
    throw new Error("Project Agent không tìm thấy phiên Agent để tiếp tục. Hãy khôi phục hoặc tạo lại từ Agent.");
  }
  const stage = await deps.stage(id);
  if (stage.kind === "rendering" || stage.kind === "writing" || stage.kind === "published") return;
  if (draft.productionState !== "scene_review") {
    throw new Error("Hãy mở Agent và hoàn tất review ảnh trong phiên Harness trước khi tiếp tục render.");
  }
  if (stage.kind === "error" && stage.fixable) {
    await deps.editHarness(id, `Sửa lỗi render sau đây bằng scene trong project; giữ nguyên nội dung đã duyệt: ${stage.message}`);
    return;
  }
  if (stage.kind === "error" && stage.retry === "full") {
    deps.publish(id);
    return;
  }
  if (stage.kind === "error" || (action === "approve" && stage.kind === "script")) {
    await deps.resumeHarnessRender(id);
  }
}
