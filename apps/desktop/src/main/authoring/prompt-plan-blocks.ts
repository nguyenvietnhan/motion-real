import type { AuthorInput } from "../agent/agent-worker.js";
import type { ContentPlan, ContentPlanQualityIssue } from "./content-plan.js";

export function contentPlanBlock(plan?: ContentPlan): string {
  if (!plan) return "";
  return `

CONTENT PLAN ĐÃ DUYỆT (bắt buộc bám theo):
${JSON.stringify(plan, null, 2)}

LUẬT DÙNG CONTENT PLAN:
- Giữ đúng title, viewerPromise, hook/openLoop/payoff và thứ tự sceneId/purpose/beat trừ khi cần sửa rất nhỏ để hợp TSX.
- Narration, claims, thứ tự cảnh và motionBeats là authoritative. visualMetaphor và layoutFamily chỉ là gợi ý khởi đầu; PHẢI thay chúng khi xung đột với presentation profile hoặc làm cảnh rơi về card/list/dashboard chung chung.
- Dùng đúng presentation profile đã chọn để tự thiết kế focal object, composition và trạng thái nhìn thấy; không thay cơ chế/evidence/workflow bằng card, list hoặc dashboard chung chung.
- Giữ object identity và quan hệ không gian xuyên suốt các motionBeats; dựng trạng thái theo đúng beatId rồi giữ final state đủ lâu để đọc.
- Đọc motionProgression như motion intent, nhưng motionBeats (nếu có) là contract semantic có thẩm quyền:
  quick entrance/reveal/pop vào nhanh tự nhiên (thường settle 0.2–0.8 giây bằng frame/spring);
  với mỗi motionBeat (cả beat đầu), PHẢI đọc literal motionCueFrames?.["beat-id"] ?? fallback-frame và đổi trạng thái: list lần lượt, terminal command→result, path/chart tiến dần, ảnh crop/highlight. Trước khi trả lời, kiểm mọi beat id có literal lookup; không hiện beat mặc định/tương lai, dùng một entrance chung hoặc chỉ đổi glow;
  continuous living motion dùng phase/period deterministic cho wave/pulse/signal/walking sau khi entrance đã settle.
  MotionReal tự cấp cue theo narration; không tự bịa timestamp. Final hold sau beat cuối là bắt buộc đọc được; quick entrance + readable final hold luôn hợp lệ cho statement beat không có motionBeats.
- Chỉ dùng các claims còn xuất hiện trong JSON trên. Nếu một claim không có ở đây, coi như đã bị loại vì thiếu căn cứ và KHÔNG được đưa vào narration, text, props hoặc code.
- Không thêm số liệu/ngày/giá/phần trăm mới ngoài claim ledger đã duyệt; thiếu căn cứ thì viết lại theo hướng không cần chi tiết đó.
- Vẫn phải tuân thủ toàn bộ AUTHORING_CONTRACT và AI_Output_Contract bên dưới.`;
}

export function contentPlanAdvisoryBlock(advisories?: readonly ContentPlanQualityIssue[]): string {
  if (!advisories || advisories.length === 0) return "";
  const lines = advisories.map((issue) => {
    const scene = issue.sceneId ? ` @${issue.sceneId}` : "";
    return `- ${issue.check}${scene}: ${issue.message}`;
  });
  return `

CONTENT PLAN ADVISORIES TO RESOLVE IN TSX:
${lines.join("\n")}

LUẬT DÙNG ADVISORY:
- Đây là hướng sửa mềm cho authoring, không phải lý do xoá ý tưởng hoặc thay video bằng title-card an toàn.
- Giải quyết bằng lựa chọn visual/motion cụ thể trong TSX: bố cục, hierarchy, quick entrance đúng nhịp, semantic progression, continuous living motion, SVG/CSS bespoke, hoặc deliberate static hold khi hợp nội dung.`;
}

/**
 * Code-authoring brief only. Never include raw article bodies — approved
 * content plan / claim ledger carry validated facts.
 */
export function sourceBlock(input: AuthorInput, _research?: string): string {
  const links = input.urls.length > 0 ? `\n\nLink trong yêu cầu: ${input.urls.join(", ")}` : "";
  const grounding =
    input.urls.length > 0
      ? "\n\n(Chỉ bám CONTENT PLAN + claim ledger đã duyệt. Không dùng lại toàn bộ bài báo. KHÔNG bịa số liệu ngoài claim.)"
      : "";
  return `Yêu cầu của người dùng:\n${input.text}${links}${grounding}`;
}

export function batchBriefBlock(input: AuthorInput): string {
  const links = input.urls.length > 0 ? `\n\nLink trong yêu cầu: ${input.urls.join(", ")}` : "";
  return `Yêu cầu gốc của người dùng:\n${input.text}${links}`;
}
