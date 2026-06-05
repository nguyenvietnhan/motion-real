import { SCENE_PACING, type DurationPreset, type VideoSpec } from "@news/schema";

/**
 * Evidence-safe mock planner for local structure checks (no AI key needed).
 * It produces a structurally valid spec that ROTATES through the diverse
 * component catalog (so a no-voice draft actually showcases Remotion's visual
 * range instead of repeating two layouts), while inventing no sources, prices,
 * benchmarks, or quotes — mirroring news_video_tool's evidence-safe mock mode.
 *
 * Content discipline: the middle scenes carry only generic, qualitative
 * statements. Number-shaped components (price-spotlight, stat-grid) are filled
 * with qualitative tokens ("Nhiều", "Cao", …) rather than fabricated figures,
 * and quote-pull is left unattributed so no quote is passed off as real.
 */

type SceneSpec = VideoSpec["scenes"][number];
type MiddleProps = SceneSpec["props"];

// Filler narration phrases (>= ~24 words) that carry a micro-section transition
// keyword so longer presets also satisfy the storytelling rhythm.
const MIDDLE_NARRATIONS = [
  "Nhưng đằng sau bề mặt đơn giản ấy là một chuỗi đánh đổi mà rất ít người chịu nhìn thẳng, và chính điều đó mới quyết định kết quả cuối cùng.",
  "Tuy nhiên nếu chỉ nhìn vào lợi ích trước mắt, ta dễ bỏ qua cái giá ẩn đang âm thầm lớn dần theo từng quyết định nhỏ mỗi ngày.",
  "Sự thật là phần lớn rủi ro không nằm ở thứ ta thấy, mà nằm ở những giả định ta mặc nhiên tin đúng nhưng chưa từng kiểm chứng.",
  "Điều đáng nói là cùng một công cụ, người này tạo ra giá trị lớn còn người kia lại lãng phí nguồn lực, khác biệt nằm ở cách tiếp cận.",
  "Ngược lại, khi ta đặt câu hỏi đúng từ đầu, mọi bước sau trở nên rõ ràng hơn và quyết định cũng bớt cảm tính hơn rất nhiều.",
  "Bí mật nằm ở chỗ tốc độ và sự chắc chắn hiếm khi đi cùng nhau, nên việc chọn ưu tiên gì trước luôn là một bài toán đánh đổi thực sự.",
];

type SceneTag = NonNullable<SceneSpec["sfx"]>;

/** One varied, evidence-safe middle-scene template. */
type MiddleVariant = {
  component: string;
  eyebrow: string;
  headline: string;
  body: string;
  props: MiddleProps;
  sfx: SceneTag;
};

/**
 * The rotation pool. Cycling through it gives a draft that exercises five
 * distinct layouts (insight list, A/B split, pulled statement, single emphasis,
 * qualitative grid) with no two adjacent scenes sharing a component.
 */
const MIDDLE_VARIANTS: MiddleVariant[] = [
  {
    component: "insight-stack",
    eyebrow: "Phân tích",
    headline: "Những lớp ẩn bên dưới",
    body: "Một dòng phụ ngắn làm rõ ý cho cảnh này.",
    props: {
      steps: ["Điểm thứ nhất đáng chú ý", "Điểm thứ hai cần cân nhắc", "Điểm thứ ba dễ bị bỏ qua"],
    },
    sfx: "transition",
  },
  {
    component: "comparison-split",
    eyebrow: "Đối chiếu",
    headline: "Hai hướng đi, hai cái giá",
    body: "Đặt hai lựa chọn cạnh nhau để thấy rõ đánh đổi.",
    props: {
      left: { label: "Trước mắt", detail: "Nhanh, dễ thấy kết quả ngay" },
      right: { label: "Lâu dài", detail: "Chậm hơn nhưng bền vững hơn" },
    },
    sfx: "emphasis",
  },
  {
    component: "quote-pull",
    eyebrow: "Nguyên tắc",
    headline: "Một câu đáng dừng lại",
    body: "Một ý ngắn gọn cô đọng toàn bộ tinh thần.",
    props: {
      quote: "Tốc độ không có nhiều ý nghĩa nếu thiếu đi sự ổn định.",
    },
    sfx: "none",
  },
  {
    component: "price-spotlight",
    eyebrow: "Điểm nhấn",
    headline: "Yếu tố đáng chú ý nhất",
    body: "Một dòng phụ ngắn làm rõ ý cho cảnh này.",
    props: { value: "Nhiều", unit: "yếu tố cần cân nhắc", note: "không chỉ một chiều" },
    sfx: "alert",
  },
  {
    component: "stat-grid",
    eyebrow: "Tổng quan",
    headline: "Ba khía cạnh cần cân đo",
    body: "Nhìn nhanh các mặt định tính của vấn đề.",
    props: {
      stats: [
        { value: "Cao", label: "Tiềm năng" },
        { value: "Vừa", label: "Rủi ro" },
        { value: "Thấp", label: "Chi phí thử" },
      ],
    },
    sfx: "transition",
  },
];

export function buildMockSpec(prompt: string, duration: DurationPreset): VideoSpec {
  const pacing = SCENE_PACING[duration];
  const count = pacing.target;
  const topic = prompt.trim().slice(0, 40) || "Chủ đề";

  // Distribute durations so they sum exactly to the preset.
  const base = Math.floor((duration / count) * 100) / 100;
  const durations = Array.from({ length: count }, () => base);
  const drift = Number((duration - base * count).toFixed(2));
  durations[count - 1] = Number((durations[count - 1]! + drift).toFixed(2));

  const scenes: VideoSpec["scenes"] = [];

  // scene-01: hero hook
  scenes.push({
    id: "scene-01",
    component: "hero-announcement",
    durationInSeconds: durations[0]!,
    eyebrow: "Góc nhìn",
    headline: "Một điều ít ai nói thẳng",
    body: "Mở đầu bằng một cảnh báo thực tế về chủ đề này.",
    narration:
      "Đừng vội kết luận khi mới nhìn bề nổi, vì thứ quyết định kết quả thường là phần chìm mà rất ít người chịu bỏ thời gian soi cho kỹ.",
    props: { badgeText: "Chủ đề", highlight: "Sự thật" },
    sfx: "transition",
  });

  // middle scenes: rotate through the diverse component catalog so the draft
  // shows visual range (no two adjacent scenes share a component).
  for (let i = 2; i <= count - 1; i += 1) {
    const variant = MIDDLE_VARIANTS[(i - 2) % MIDDLE_VARIANTS.length]!;
    const narration = MIDDLE_NARRATIONS[(i - 2) % MIDDLE_NARRATIONS.length]!;
    scenes.push({
      id: `scene-${String(i).padStart(2, "0")}`,
      component: variant.component,
      durationInSeconds: durations[i - 1]!,
      eyebrow: variant.eyebrow,
      headline: variant.headline,
      body: variant.body,
      narration,
      props: variant.props,
      sfx: variant.sfx,
    });
  }

  // final scene: CTA
  scenes.push({
    id: `scene-${String(count).padStart(2, "0")}`,
    component: "final-cta",
    durationInSeconds: durations[count - 1]!,
    eyebrow: "Đúc kết",
    headline: "Lựa chọn nằm ở bạn",
    body: "Một câu hỏi đánh đổi để khép lại chủ đề.",
    narration:
      "Vậy giữa cái lợi trước mắt và sự bền vững lâu dài, bạn sẽ ưu tiên điều gì khi phải tự mình đưa ra quyết định cho chặng đường sắp tới.",
    props: { ctaText: "Cân nhắc đánh đổi", subText: "Bạn chọn cái lợi nhanh hay sự bền vững lâu dài?" },
    sfx: "success",
  });

  return {
    version: 1,
    title: `Bản nháp: ${topic}`.slice(0, 140),
    styleId: "clean-luxury-tech",
    duration,
    ratio: "9:16",
    language: "vi",
    scenes,
  };
}
