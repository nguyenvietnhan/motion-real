import { FPS, type LockedVideoSpec, secondsToFrames } from "@news/schema";

/**
 * A hand-built locked spec used to preview the pipeline in Studio without
 * calling the AI planner or TTS. Timing here is derived directly from the
 * target seconds (no audio), so it doubles as a no-voice "visual draft".
 */
const scenes = [
  {
    id: "scene-01",
    component: "hero-announcement",
    durationInSeconds: 8,
    eyebrow: "Tin công nghệ",
    headline: "Remotion đổi cách dựng video",
    body: "Mỗi cảnh giờ là một component React thật, không còn khuôn cứng.",
    narration:
      "Đừng tiếp tục nhốt video tin tức trong vài chục khuôn mẫu cố định, vì khán giả nhận ra sự lặp lại rất nhanh.",
    props: { badgeText: "Remotion", highlight: "React Video" },
  },
  {
    id: "scene-02",
    component: "price-spotlight",
    durationInSeconds: 8,
    eyebrow: "Con số",
    headline: "Một con số nói lên tất cả",
    body: "Toàn bộ pipeline render vẫn tất định và cache được như cũ.",
    narration:
      "Chỉ với một con số đặt đúng chỗ, người xem hiểu ngay quy mô của vấn đề mà không cần đọc cả đoạn văn dài.",
    props: { value: "40+", unit: "scene components", note: "Mở rộng không giới hạn" },
  },
  {
    id: "scene-03",
    component: "insight-stack",
    durationInSeconds: 9,
    eyebrow: "Vì sao",
    headline: "Ba điều giữ cho tự do an toàn",
    body: "Tự do thị giác chỉ bền khi có lưới an toàn bao quanh.",
    narration:
      "Nhưng tự do mà thiếu kiểm soát sẽ làm hỏng độ ổn định, nên ta giữ ba lớp bảo vệ then chốt cho mỗi component.",
    props: { steps: ["Schema cho từng component", "Render tất định", "Vòng review keyframe"] },
  },
  {
    id: "scene-04",
    component: "final-cta",
    durationInSeconds: 7,
    eyebrow: "Takeaway",
    headline: "Tự do có kỷ luật",
    body: "Đa dạng thị giác cộng với lưới an toàn kiểu math-tool.",
    narration:
      "Vậy câu hỏi còn lại là bạn sẽ đầu tư vào lớp lưới an toàn nào trước, để mở khóa sự đa dạng mà không mất ổn định?",
    props: {
      ctaText: "Tự do có kỷ luật",
      subText: "Bạn sẽ xây lưới an toàn nào trước cho mảng tin tức?",
    },
  },
] as const;

let startFrame = 0;
const lockedScenes = scenes.map((scene) => {
  const durationInFrames = secondsToFrames(scene.durationInSeconds);
  const locked = { ...scene, props: { ...scene.props }, startFrame, durationInFrames };
  startFrame += durationInFrames;
  return locked;
});

export const sampleSpec: LockedVideoSpec = {
  version: 1,
  title: "Remotion pipeline demo",
  styleId: "clean-luxury-tech",
  duration: 60,
  ratio: "9:16",
  language: "vi",
  fps: FPS,
  durationInFrames: startFrame,
  scenes: lockedScenes,
  audio: {},
};
