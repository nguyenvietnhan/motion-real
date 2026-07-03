import { FPS, T_TRANSITION, type LockedVideoSpec, secondsToFrames } from "@motionreal/schema";

/**
 * A hand-built locked spec used to preview the pipeline in Studio without
 * calling the AI planner or TTS. Timing here is derived directly from the
 * target seconds (no audio), laid out on the SAME transition-aware timeline the
 * lock produces (adjacent scenes overlap by `T_TRANSITION`), so it doubles as a
 * no-voice "visual draft" that previews the real transitions.
 */
const scenes = [
  {
    id: "scene-01",
    component: "demo-hero",
    durationInSeconds: 8,
    headline: "Remotion đổi cách dựng video",
    body: "Mỗi cảnh giờ là một component React thật, không còn khuôn cứng.",
    narration:
      "Đừng tiếp tục nhốt video tin tức trong vài chục khuôn mẫu cố định, vì khán giả nhận ra sự lặp lại rất nhanh.",
    props: { callout: "Tự do có kỷ luật" },
  },
  {
    id: "scene-02",
    component: "demo-idea",
    durationInSeconds: 8,
    headline: "Một con số nói lên tất cả",
    body: "Toàn bộ pipeline render vẫn tất định và cache được như cũ.",
    narration:
      "Chỉ với một con số đặt đúng chỗ, người xem hiểu ngay quy mô của vấn đề mà không cần đọc cả đoạn văn dài.",
    props: { idea: "Mở rộng không giới hạn bằng code", label: "Vì sao" },
  },
  {
    id: "scene-03",
    component: "demo-points",
    durationInSeconds: 9,
    headline: "Ba điều giữ cho tự do an toàn",
    body: "Tự do thị giác chỉ bền khi có lưới an toàn bao quanh.",
    narration:
      "Nhưng tự do mà thiếu kiểm soát sẽ làm hỏng độ ổn định, nên ta giữ ba lớp bảo vệ then chốt cho mỗi component.",
    props: { points: ["Schema cho từng component", "Render tất định", "Vòng review keyframe"] },
  },
  {
    id: "scene-04",
    component: "demo-cta",
    durationInSeconds: 7,
    headline: "Tự do có kỷ luật",
    body: "Đa dạng thị giác cộng với lưới an toàn kiểu math-tool.",
    narration:
      "Vậy câu hỏi còn lại là bạn sẽ đầu tư vào lớp lưới an toàn nào trước, để mở khóa sự đa dạng mà không mất ổn định?",
    props: { question: "Bạn sẽ xây lưới an toàn nào trước cho mảng tin tức?" },
  },
] as const;

let startFrame = 0;
const n = scenes.length;
const T = n > 1 ? T_TRANSITION : 0;
const lockedScenes = scenes.map((scene, i) => {
  const s = Math.max(1, secondsToFrames(scene.durationInSeconds));
  const headT = i === 0 ? 0 : T;
  const tailT = i === n - 1 ? 0 : T;
  const durationInFrames = s + headT + tailT;
  const locked = {
    ...scene,
    props: { ...scene.props },
    startFrame,
    durationInFrames,
    // Recap/CTA boundary fades; the rest slide (default).
    transitionToNext: i === n - 2 ? ("fade" as const) : ("slide" as const),
  };
  startFrame += durationInFrames - tailT;
  return locked;
});
const totalFrames = lockedScenes.length
  ? lockedScenes.at(-1)!.startFrame + lockedScenes.at(-1)!.durationInFrames
  : 0;

export const sampleSpec: LockedVideoSpec = {
  version: 1,
  title: "Remotion pipeline demo",
  styleId: "clean-luxury-tech",
  format: "tiktok",
  duration: 60,
  ratio: "9:16",
  language: "vi",
  theme: { dominant: "#5B8CFF", mood: "xanh công nghệ điềm tĩnh" },
  fps: FPS,
  durationInFrames: totalFrames,
  scenes: lockedScenes,
  audio: {},
  captions: [],
};
