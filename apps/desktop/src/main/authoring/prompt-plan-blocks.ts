import type { AuthorInput } from "../agent/agent-worker.js";
import type { ContentPlan, ContentPlanQualityIssue } from "./content-plan.js";

export function contentPlanBlock(plan?: ContentPlan): string {
  if (!plan) return "";
  return `

CONTENT PLAN ĐÃ DUYỆT (bắt buộc bám theo):
${JSON.stringify(plan, null, 2)}

LUẬT DÙNG CONTENT PLAN:
- Giữ đúng title, viewerPromise, hook/openLoop/payoff và thứ tự sceneId/purpose/beat trừ khi cần sửa rất nhỏ để hợp TSX.
- Mỗi cảnh phải hiện thực hóa đúng beat/narration/onScreenText/visualMetaphor/layoutFamily đã được lập kế hoạch.
- Đọc motionProgression như motion intent, KHÔNG như lệnh kéo mọi animation ra hết cảnh:
  quick entrance/reveal/pop vào nhanh tự nhiên (thường settle 0.2–0.8 giây bằng frame/spring);
  nếu motionProgression có nhãn "semantic:", PHẢI hiện thực 2–4 thay đổi có thứ tự bằng các khoảng progress tương đối: bước/list hiện lần lượt, terminal thêm dòng, timeline/path tiến dần, comparison đổi focus hoặc trạng thái biến đổi theo narration. Chỉ cho toàn cảnh entrance một lần rồi đứng yên là chưa đạt;
  continuous living motion dùng phase/period deterministic cho wave/pulse/signal/walking sau khi entrance đã settle.
  Không cần khớp timestamp từng từ; dùng thứ tự và các pha tương đối của cảnh. Final hold sau khi beat chính land là hợp lệ; quick entrance + readable final hold luôn hợp lệ cho statement beat không có nhãn semantic.
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
