export const AUTHOR_BATCH_SIZE = 2;
/** Enough batches for MAX_BATCHED_COMPONENTS at AUTHOR_BATCH_SIZE. */
export const MAX_AUTHOR_BATCHES = 10;
/**
 * Plans at or below this size use one authoring reply (no batching).
 * Raised with the 20-component budget so ~15–20 scene plans stay workable.
 */
export const AUTHOR_BATCH_THRESHOLD = 16;
/** Hard cap on authored components per create (tier 4 ~3:30 may need many scenes). */
export const MAX_BATCHED_COMPONENTS = AUTHOR_BATCH_SIZE * MAX_AUTHOR_BATCHES;

export const AUTHOR_BATCH_BUDGET_FAILURE =
  `AI lập kế hoạch quá nhiều cảnh cho lượt authoring an toàn (tối đa ${MAX_BATCHED_COMPONENTS} component). Hãy thử lại với phạm vi hẹp hơn hoặc thời lượng ngắn hơn.`;

export type AuthorBatchDecision =
  | { mode: "single"; componentIds: string[]; reason: "short-plan" | "user-images" }
  | { mode: "batched"; componentIds: string[]; batches: string[][] }
  | { mode: "too-large"; componentIds: string[] };

export function planAuthorBatching(args: { sceneIds: readonly string[]; imageCount: number }): AuthorBatchDecision {
  const componentIds = [...new Set(args.sceneIds)];
  if (args.imageCount > 0) return { mode: "single", componentIds, reason: "user-images" };
  if (componentIds.length <= AUTHOR_BATCH_THRESHOLD) return { mode: "single", componentIds, reason: "short-plan" };
  if (componentIds.length > MAX_BATCHED_COMPONENTS) return { mode: "too-large", componentIds };
  return { mode: "batched", componentIds, batches: chunk(componentIds, AUTHOR_BATCH_SIZE) };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}
