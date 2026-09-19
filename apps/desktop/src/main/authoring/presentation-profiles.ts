import type { PresentationProfile } from "./content-plan-schema.js";
import {
  authoringContract,
  creativeVisualization,
  technicalAuthoringContract,
} from "./contract-text.js";

const SHARED_PROFILE_DIRECTION = `HƯỚNG TRÌNH BÀY ĐÃ CHỌN:
- Giữ một ngôn ngữ thị giác nhất quán cho toàn video: hierarchy rõ, tuân thủ nghiêm ngặt Palette Token Contract, khoảng thở có chủ đích và asset thật chỉ dùng khi đóng góp nội dung.
- Mỗi cảnh có một focal structure riêng; không lặp một shell/card/HUD cho cả video và không chép nguyên narration lên màn hình.
- Motion phải diễn đạt reveal, focus, transformation hoặc cause/effect theo content plan; ambient motion không thay thế semantic progression.
- Profile là visual grammar CHỦ ĐẠO, không phải một layout áp cho mọi cảnh; hook/context/payoff được đổi hình thức khi cần nhưng không được làm mất viewer outcome của profile.
- Không bịa số liệu, quan hệ nhân quả, UI hoặc bằng chứng để làm cảnh trông cụ thể hơn.`;

const PROFILE_DIRECTIONS: Record<PresentationProfile, string> = {
  "editorial-story": `PRESENTATION PROFILE: editorial-story
Viewer outcome: hiểu chuyện gì đã xảy ra và vì sao đáng quan tâm (what happened).
- Dẫn bằng diễn biến hoặc dữ kiện mạnh nhất, rồi lần lượt làm rõ fact đã xác nhận, bối cảnh, hệ quả và điều còn chưa chắc chắn.
- Give each scene one dominant evidence object—photo, map, timeline, chart, document excerpt, quote, or a bespoke event reconstruction—and let motion move attention through that object.
- Treat a headline as a short label for the evidence, never as the whole scene. Preserve narrative continuity with crop, pan, scale, spatial relocation, or a recurring visual anchor.
- If no source asset exists, build one event-centric visual composition; do not fall back to a card carousel, stacked text panels, repeated news cards, or a dashboard shell.
- Tránh bịa quan hệ nhân quả, UI, ảnh hoặc bằng chứng chỉ để tăng kịch tính.`,
  "mechanism-explainer": `PRESENTATION PROFILE: mechanism-explainer
Viewer outcome: hiểu một cấu trúc, hệ thống hoặc cơ chế hoạt động như thế nào (how it works).
- Trước khi viết code, xác định: initial state, action/decision làm thay đổi, và resulting state. Nếu không gọi tên được 3 phần này, không nguỵ trang tóm tắt thành cơ chế.
- Identify the mechanism's actual domain primitives, draw them as persistent objects, and preserve their identity and spatial relationships across narration beats.
- Simulate each meaningful state transition: thể hiện rõ vật thể đi vào, quyết định xử lý, luồng dữ liệu truyền tải, và trạng thái kết quả đầu ra.
- Áp dụng các Geometric Archetypes phù hợp:
  * Decision trees & hierarchies: dùng nodes, edges, split criteria, and path traversal (cấu trúc 3 tầng nối bằng đường cong SVG, chữ dừng ở <= 62%–64% an toàn trên dải caption).
  * Pipelines: payload di chuyển qua các trạm xử lý nối mũi tên SVG.
  * State machines: các vòng tròn trạng thái có transition curves.
- Do not replace the mechanism with a feature grid, pros/cons list, architecture cards, headline sequence, or static diagram whose complete future state is visible from the start.
- Dùng motionBeats để reveal từng bước theo thứ tự đọc lời thoại, kết thúc bằng readable hold.`,
  "evidence-explainer": `PRESENTATION PROFILE: evidence-explainer
Viewer outcome: đánh giá bằng chứng (evidence) nào hỗ trợ kết luận và giới hạn của bằng chứng đó.
- Tổ chức claim → method/evidence → result → limitation → implication; phân biệt rõ quan sát, suy luận và kết luận.
- Ưu tiên figure, chart, bảng, crop/highlight vùng liên quan và biểu đạt uncertainty; giữ trục, nhãn và tỷ lệ trung thực.
- Để evidence object làm focal structure; chữ chỉ chỉ ra cách đọc và giới hạn, không tách mỗi claim thành một card độc lập.
- Tránh causal arrow khi nguồn chỉ cho correlation, tránh phóng đại paper và không biến uncertainty thành lời khẳng định chắc chắn.`,
  "procedural-guide": `PRESENTATION PROFILE: procedural-guide
Viewer outcome: người xem có thể thực hiện một ordered task và nhận biết kết quả đúng.
- Tổ chức goal → prerequisite → action → visible result/check; UI, terminal, command và bước thao tác xuất hiện đúng thứ tự narration.
- Giữ trạng thái trước đó để người xem hiểu ngữ cảnh, nhưng không hiện bước tương lai hay kết quả hoàn tất trước cue.
- Giữ một workspace/artifact xuyên các bước và cho mỗi thao tác tạo ra kết quả nhìn thấy được trên chính workspace đó; danh sách bước chỉ là nhãn phụ.
- Tránh workflow trừu tượng khi cần hành động cụ thể và tránh gom toàn bộ các bước lên màn hình ngay từ đầu.`,
  "comparison-decision": `PRESENTATION PROFILE: comparison-decision
Viewer outcome: lựa chọn (choose) giữa các phương án bằng tiêu chí chung và trade-off rõ ràng.
- Dùng cùng scale, visual encoding và thứ tự tiêu chí cho mọi phương án; reveal từng tiêu chí rồi mới đưa kết luận phù hợp từng đối tượng.
- Motion giúp đối chiếu cùng một thuộc tính, bảo toàn vị trí để người xem không phải tìm lại phương án.
- Đặt các phương án trong cùng visual field và cùng hệ quy chiếu; không trình bày chúng như các card độc lập không có quan hệ trực quan.
- Tránh false binary, điểm số không có nguồn, scale lệch hoặc làm một phía nổi bật chỉ vì trang trí.`,
  "narrative-conceptual": `PRESENTATION PROFILE: narrative-conceptual
Viewer outcome: hiểu một ý tưởng đã phát triển ra sao hoặc có ý nghĩa gì (evolved).
- Dẫn bằng setup → tension → turn → payoff; dùng timeline, typographic storytelling hoặc một visual metaphor xuyên suốt khi phù hợp.
- Motion thể hiện sự biến đổi của ý nghĩa và mối quan hệ, xen các beat tĩnh để payoff có khoảng thở.
- Nếu dùng metaphor, giữ cùng các object cốt lõi và để chúng tiến hóa qua câu chuyện; typography chỉ hỗ trợ chứ không thay thế diễn biến hình ảnh.
- Tránh đổi metaphor vô cớ, ép khái niệm thành dashboard hoặc biến mọi cảnh thành checklist giải thích.`,
  "product-showcase": `PRESENTATION PROFILE: product-showcase
Viewer outcome: thấy sản phẩm thực sự làm được gì trong một workflow thật (actually does).
- Để UI, screenshot hoặc demo media thật làm chủ thể; tổ chức feature/action → visible outcome → user benefit.
- Dùng crop, pan và callout để chỉ vùng liên quan, giữ sản phẩm đủ lớn và dễ đọc; đồ hoạ bespoke chỉ hỗ trợ chứ không lấn át demo.
- Tránh dựng UI giả khi đã có asset thật, chôn demo trong khung trang trí nhỏ hoặc dùng claim marketing không có căn cứ.`,
};

export function presentationProfileDirection(profile: PresentationProfile): string {
  return `${SHARED_PROFILE_DIRECTION}\n\n${PROFILE_DIRECTIONS[profile]}`;
}

export function authoringContractForProfile(
  profile: PresentationProfile | undefined,
  dominantColor?: string,
): string {
  return profile
    ? `${technicalAuthoringContract(dominantColor)}\n\n${creativeVisualization(dominantColor)}\n\n${presentationProfileDirection(profile)}`
    : authoringContract(dominantColor);
}
