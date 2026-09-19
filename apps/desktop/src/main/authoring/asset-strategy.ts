import {
  DEFAULT_AGENT_ASSET_STRATEGY,
  type AgentAssetStrategy,
} from "../../shared/types.js";

/** A short authoring instruction, chosen once by the user at brief approval. */
export function normalizeAssetStrategy(value: unknown): AgentAssetStrategy {
  return value === "visualize-first" || value === "evidence-first" || value === "balanced"
    ? value
    : DEFAULT_AGENT_ASSET_STRATEGY;
}

export function assetStrategyDirection(value: AgentAssetStrategy | undefined): string {
  switch (normalizeAssetStrategy(value)) {
    case "visualize-first":
      return "ƯU TIÊN TỰ MINH HOẠ BẰNG CODE: Với cơ chế, cấu trúc, luồng dữ liệu, quy trình hoặc so sánh, hãy tự vẽ và animate chủ thể bằng JSX/SVG/CSS để người xem hiểu nó hoạt động ra sao. Chỉ dùng ảnh đã duyệt khi đó là bằng chứng/chủ thể thật hoặc điểm nhấn ngữ cảnh nhỏ; không thay phần giải thích bằng ảnh web có sẵn.";
    case "evidence-first":
      return "ƯU TIÊN BẰNG CHỨNG THẬT: Khi ảnh, giao diện, tài liệu hoặc logo đã duyệt là chủ thể/bằng chứng của ý đang nói, hãy dùng nó làm focal object và crop, pan hoặc callout theo lời đọc. Code chỉ dùng để làm rõ quan hệ, không dựng lại bằng chứng thật một cách giả tạo.";
    case "balanced":
      return "CÂN BẰNG CODE VÀ ASSET: Bắt đầu từ điều người xem cần hiểu. Tự minh hoạ bằng code cho cơ chế/khái niệm; dùng asset đã duyệt khi nó là chủ thể hoặc bằng chứng thật. Không dùng ảnh chỉ vì pool có sẵn và không né tự minh hoạ khi hình động giải thích rõ hơn.";
  }
}
