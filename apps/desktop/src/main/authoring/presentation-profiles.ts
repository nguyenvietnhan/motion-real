import type { PresentationProfile } from "./content-plan-schema.js";
import {
  authoringContract,
  getDesignTokens,
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

export const PROFILE_ARCHETYPES: Record<PresentationProfile, (dominant: string) => string> = {
  "mechanism-explainer": (dominant: string) => {
    const t = getDesignTokens(dominant);
    return `DOMAIN ARCHETYPES (MECHANISM-EXPLAINER) — BIẾN Ý THÀNH HÌNH:
Dùng <svg>/<div> trần theo frame. TUYỆT ĐỐI TRÁNH FROSTED GLASS CARD TRAP (không bọc text vào hộp kính mờ). Áp dụng các Domain Archetypes cụ thể:
1) Pipeline Dataflow (Luồng dữ liệu & Trạm xử lý tuần tự):
   - Chuỗi sequential nodes (Node 1 y: 380px, Node 2 y: 650px, Node 3 y: 920px) nối bằng dashed curved SVG connector:
     <svg viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
       <path d="M 540 440 C 540 540, 360 550, 360 650 C 360 750, 540 820, 540 920" fill="none" stroke="${t.ACCENT_PRIMARY}" strokeWidth={3} strokeDasharray="8 6" />
     </svg>
   - Payload chuyển động tuần tự qua từng trạm theo cues. Đuôi path mở rộng xuống base pedestal y: 1250-1350px neo sàn khung hình.
2) State Machine Transition (Chuyển trạng thái máy trạng thái):
   - Các circles (r: 70–90px, viền stroke="${t.ACCENT_PRIMARY}" hoặc nền ${t.BG}) nối bằng curved transition arrows SVG:
     <path d="M 380 620 Q 540 520 700 620" fill="none" stroke="${t.ACCENT_SECONDARY}" strokeWidth={2.5} markerEnd="url(#arrow)" />
   - Trạng thái active sáng nổi bật với ${t.SPOTLIGHT} hoặc stroke sáng, mô phỏng rõ trigger/action làm nhảy trạng thái.
3) Architecture Stack (Tầng kiến trúc & Phân cấp hệ thống):
   - 3 tiers khối hộp tối giản (Top: Client/Ingest y: 320px, Mid: Engine/Logic y: 620px, Bottom: Storage/Data y: 920px, cao ~160px, rộng ~880px, viền 1px ${t.TEXT_MUTED}).
   - Bus connector SVG thẳng đứng nối liền 3 tiers (<path d="M 540 480 L 540 620 M 540 780 L 540 920" stroke="${t.ACCENT_PRIMARY}" strokeWidth={3} />).
   - Chân bệ đỡ base pedestal y: 1250-1350px vững chắc neo ở đáy.`;
  },

  "comparison-decision": (dominant: string) => {
    const t = getDesignTokens(dominant);
    return `DOMAIN ARCHETYPES (COMPARISON-DECISION) — BIẾN Ý THÀNH HÌNH:
Dùng <svg>/<div> trần theo frame. TUYỆT ĐỐI TRÁNH FROSTED GLASS CARD TRAP (không bọc text vào hộp kính mờ). Áp dụng các Domain Archetypes cụ thể:
1) Dual Split-Core (Hai cột đối chiếu song song):
   - 2 symmetric columns (Cột trái x=100, Cột phải x=570, width: 410px, y: 340–1100px) đặt trên cùng hệ quy chiếu.
   - Vertical SVG divider at x=540:
     <svg viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
       <line x1={540} y1={360} x2={540} y2={1200} stroke="${t.TEXT_MUTED}" strokeWidth={1.5} strokeDasharray="4 4" />
       <circle cx={540} cy={700} r={32} fill="${t.BG}" stroke="${t.ACCENT_PRIMARY}" strokeWidth={2} />
     </svg>
   - Badge đối chiếu ("VS" hoặc tiêu chí) tại tâm x: 540, y: 700. Chân bệ đỡ base pedestal y: 1200-1320px SVG vững chắc.
2) Comparison Matrix Shelf (Kệ ma trận so sánh 3 criteria rows):
   - Bảng so sánh 3 criteria rows ngang rõ rệt (Row 1 y: 460px, Row 2 y: 680px, Row 3 y: 900px, cao 140px/hàng).
   - Phân định rõ 2 vế đối chiếu, viền phân cách mờ 1px, highlight điểm thắng bằng stroke="${t.STATUS_OK}" hoặc stroke="${t.ACCENT_PRIMARY}", điểm thua bằng text muted hoặc stroke="${t.STATUS_ERR}". Base pedestal y: 1200-1320px.`;
  },

  "evidence-explainer": (dominant: string) => {
    const t = getDesignTokens(dominant);
    return `DOMAIN ARCHETYPES (EVIDENCE-EXPLAINER) — BIẾN Ý THÀNH HÌNH:
Dùng <svg>/<div> trần theo frame. TUYỆT ĐỐI TRÁNH FROSTED GLASS CARD TRAP (không bọc text vào hộp kính mờ). Áp dụng các Domain Archetypes cụ thể:
1) Metric Gauge (Đồng hồ bán nguyệt đo chỉ số & Tỷ lệ):
   - SVG semicircle dial center 540,620 (bán kính r: 200–240px) với track nền mờ stroke="rgba(255,255,255,0.1)" và cung tiến trình stroke="${t.ACCENT_PRIMARY}" strokeWidth={16} strokeLinecap="round" animate bằng strokeDashoffset.
   - Giant metric 80-160px (${t.TEXT_PRIMARY} trắng sáng) đặt ngay tâm đồng hồ, kèm đơn vị đo và nhãn phương pháp ở dưới. Ray quét mở rộng xuống y: 1200–1300px neo không gian.
2) Data Trend Arc / Bar Delta (Hệ trục toạ độ & Cột chênh lệch xu hướng):
   - SVG coordinate axis with delta bars (<path d="M 140 1080 L 940 1080 M 140 1080 L 140 440" stroke="${t.TEXT_MUTED}" strokeWidth={2} />) kèm các delta bars hoặc đường cong xu hướng (<path d="..." fill="none" stroke="${t.ACCENT_PRIMARY}" strokeWidth={4} />).
   - Các mốc delta bars hiển thị phần trăm tăng/giảm nổi bật, dóng hàng tham chiếu ngang mức cơ sở.
3) Sourced Document Excerpt (Trích dẫn tài liệu kỹ thuật có căn cứ):
   - Technical framed excerpt (x: 120, width: 840, y: 380–1080px, viền 1px ${t.TEXT_MUTED}), typography trang nghiêm.
   - Spotlight highlight tập trung (background: "${t.SPOTLIGHT}", borderLeft: "4px solid ${t.ACCENT_PRIMARY}") rọi sáng chính xác câu trích dẫn hoặc số liệu bằng chứng, nhãn nguồn minh bạch đặt góc trên.`;
  },

  "editorial-story": (dominant: string) => {
    const t = getDesignTokens(dominant);
    return `DOMAIN ARCHETYPES (EDITORIAL-STORY) — BIẾN Ý THÀNH HÌNH:
Dùng <svg>/<div> trần theo frame. TUYỆT ĐỐI TRÁNH FROSTED GLASS CARD TRAP (không bọc text vào hộp kính mờ). Áp dụng các Domain Archetypes cụ thể:
1) Timeline Spine (Trục dòng thời gian sự kiện):
   - Vertical SVG axis with animated milestone nodes ở x: 540 (hoặc lệch x: 200) (<line x1={540} y1={360} x2={540} y2={1220} stroke="${t.ACCENT_PRIMARY}" strokeWidth={3} strokeDasharray="6 4" />).
   - Trên trục neo các animated milestone nodes (<circle cx={540} cy={y} r={14} fill="${t.BG}" stroke="${t.ACCENT_PRIMARY}" strokeWidth={3} />) bung mở theo motion cues, dẫn dắt mạch diễn biến theo thứ tự thời gian.
2) Photo/Map Focal Anchor (Khung neo tiêu điểm tư liệu / bản đồ):
   - Evidence photo/map container (width: 880px, y: 380–1040px, bo góc 16px, viền 1.5px stroke="${t.ACCENT_PRIMARY}"), hiệu ứng crop/pan/scale điện ảnh mượt mà.
   - Nhãn thời gian/địa danh dạng badge sắc nét ở góc, mỏ neo đồ hoạ mở rộng xuống y: 1200–1320px giữ vững không gian.
3) Event Headline Banner (Khối đồ hoạ tiêu đề thời sự bespoke):
   - Bespoke newspaper/headline graphic block trang trọng (y: 360–560px), typography tương phản cao giật tít sắc bén.
   - Dải banner tagline thể hiện tính cấp thiết (background: "${t.ACCENT_PRIMARY}", color: "${t.BG}", padding: "6px 16px", fontWeight: 800), phân tách với vùng tư liệu bằng đường phân cách SVG bespoke.`;
  },

  "procedural-guide": (dominant: string) => {
    const t = getDesignTokens(dominant);
    return `DOMAIN ARCHETYPES (PROCEDURAL-GUIDE) — BIẾN Ý THÀNH HÌNH:
Dùng <svg>/<div> trần theo frame. TUYỆT ĐỐI TRÁNH FROSTED GLASS CARD TRAP (không bọc text vào hộp kính mờ). Áp dụng các Domain Archetypes cụ thể:
1) Terminal Command Flow (Khung lệnh Terminal chuẩn xác):
   - Terminal window (width: 880px, x: 100, y: 360–1080px, nền "#070A0F", viền 1px "rgba(255,255,255,0.15)") với 3 window chrome dots (<circle cx={30} cy={20} r={6} fill="${t.STATUS_ERR}" />, <circle cx={50} cy={20} r={6} fill="#F59E0B" />, <circle cx={70} cy={20} r={6} fill="${t.STATUS_OK}" />).
   - Monospaced command ("Cascadia Mono", monospace, color: "${t.TEXT_PRIMARY}") với con trỏ nhấp nháy.
   - Immediate output block kết quả thực thi hiện ra tức thì bên dưới dòng lệnh khi lệnh hoàn tất.
2) Step-by-Step Action Shelf (Kệ các bước thao tác tuần tự):
   - Numbered sequential progress steps (Step 1 y: 400px, Step 2 y: 640px, Step 3 y: 880px).
   - Mỗi bước có huy hiệu số tròn (badge 44×44px, nền "${t.ACCENT_PRIMARY}" hoặc viền 2px), nhãn hành động dứt khoát, thanh ray SVG dọc nối các bước, mở rộng chân đế xuống y: 1200–1320px.`;
  },

  "product-showcase": (dominant: string) => {
    const t = getDesignTokens(dominant);
    return `DOMAIN ARCHETYPES (PRODUCT-SHOWCASE) — BIẾN Ý THÀNH HÌNH:
Dùng <svg>/<div> trần theo frame. TUYỆT ĐỐI TRÁNH FROSTED GLASS CARD TRAP (không bọc text vào hộp kính mờ). Áp dụng các Domain Archetypes cụ thể:
1) Spotlight App Window Frame (Khung cửa sổ ứng dụng trung tâm có Spotlight):
   - Centered app window with deep drop shadow & radial spotlight (width: 900px, x: 90, y: 360–1100px, bo góc 20px, viền 1.5px "rgba(255,255,255,0.2)", boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)").
   - Phía sau là radial spotlight rực rỡ (background: "${t.SPOTLIGHT}"), bên trong chứa UI/demo thật minh họa workflow sản phẩm.
2) Feature Callout Magnifier (Đường trỏ kính lúp phóng đại tính năng):
   - Vùng focal focus phóng to chi tiết giao diện quan trọng.
   - SVG pointer path to feature badge (<path d="M 320 600 Q 200 600, 180 750 L 160 850" fill="none" stroke="${t.ACCENT_PRIMARY}" strokeWidth={2.5} markerEnd="url(#dot)" />) trỏ từ tính năng đến badge nổi bật (nền "${t.BG}", viền 1.5px "${t.ACCENT_PRIMARY}", chữ trắng rõ ràng).`;
  },

  "narrative-conceptual": (dominant: string) => {
    const t = getDesignTokens(dominant);
    return `DOMAIN ARCHETYPES (NARRATIVE-CONCEPTUAL) — BIẾN Ý THÀNH HÌNH:
Dùng <svg>/<div> trần theo frame. TUYỆT ĐỐI TRÁNH FROSTED GLASS CARD TRAP (không bọc text vào hộp kính mờ). Áp dụng các Domain Archetypes cụ thể:
1) Metaphor Metamorphosis (Biến hoá hình mẫu ẩn dụ hình học):
   - Geometric metaphor object morphing: vật thể ẩn dụ trừu tượng (khối đa giác, vòng cầu xoắn, mạng tinh thể SVG tại tâm x: 540, y: 640).
   - Chuyển hoá hình thái qua các frame/cues bằng morphing path SVG (<path d="..." stroke="${t.ACCENT_PRIMARY}" fill="none" strokeWidth={3} />), biểu đạt trực quan sự tiến hoá hoặc chuyển biến ý niệm.
2) Concept Tension Balance (Cán cân đối trọng giằng co ý niệm):
   - Trade-off balance scale SVG tại x: 540, y: 580 (<line x1={240} y1={560} x2={840} y2={600} stroke="${t.ACCENT_PRIMARY}" strokeWidth={4} />, trụ tam giác ở x: 540).
   - Hai đĩa cân nâng hạ biểu đạt sự giằng co, đánh đổi hoặc dung hoà giữa hai khái niệm, chân đế mở rộng xuống y: 1200–1320px.`;
  },
};

const ANTI_REPEAT_AND_DISCIPLINE_RULES = `Mọi số, giá, ngày hoặc phần trăm literal trong props/JSX/SVG/chữ trên cảnh phải có trong brief hoặc CONTENT PLAN đã duyệt. CẤM bịa số trang trí để làm đồ hoạ cụ thể; không có số thật thì dùng nhãn định tính.

HÃY DÁM VẼ ẨN DỤ: chuyển ý trừu tượng thành hình cụ thể (tiến trình vọt vạch, khối nứt, node nối, cột tăng). Vẽ bằng <svg>/<div> theo frame.
LUẬT CHỐNG LẶP & CHỐNG CARD TRAP:
1) KHÔNG để hơn 2 cảnh LIÊN TIẾP cùng một khuôn bố cục.
2) Trong video 9–12 cảnh, dùng ÍT NHẤT 3 dạng bố cục khác nhau VÀ có ÍT NHẤT 1–2 cảnh mang đồ hoạ/ẩn dụ TỰ VẼ (SVG/CSS).
3) Toàn video tối đa 1 cảnh dạng card; các cảnh khác bắt buộc dùng Geometric Archetypes.`;

export function profileArchetypeDirection(
  profile: PresentationProfile,
  dominantColor?: string,
): string {
  const recipeFn = PROFILE_ARCHETYPES[profile];
  const recipe = recipeFn ? recipeFn(dominantColor ?? "#38BDF8") : "";
  return `${recipe}\n\n${ANTI_REPEAT_AND_DISCIPLINE_RULES}`;
}

export function presentationProfileDirection(profile: PresentationProfile): string {
  const specific = PROFILE_DIRECTIONS[profile];
  return specific ? `${SHARED_PROFILE_DIRECTION}\n\n${specific}` : SHARED_PROFILE_DIRECTION;
}

export function authoringContractForProfile(
  profile: PresentationProfile | undefined,
  dominantColor?: string,
): string {
  return profile && profile in PROFILE_ARCHETYPES
    ? `${technicalAuthoringContract(dominantColor)}\n\n${profileArchetypeDirection(profile, dominantColor)}\n\n${presentationProfileDirection(profile)}`
    : authoringContract(dominantColor);
}
