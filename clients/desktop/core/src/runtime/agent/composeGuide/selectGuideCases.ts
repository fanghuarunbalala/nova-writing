/**
 * 案例选择（纯函数，PRD compose-案例引导 F6）：task_type 精确匹配必过滤；
 * character_type / situation 分类器有输出才参与，且仅在能保留 ≥1 结果时生效
 * （否则退化到任务级——「未命中的维度不筛选」）；命中超 2 份取前 2
 * （entries 已按 order/文件名序）。task_type 不中 → 空数组（弃权降级路径）。
 */
import type { GuideCaseEntry, IntentTags } from "./types.js";

/** 选中案例上限（注入消息体量控制） */
export const GUIDE_CASE_MAX_SELECTED = 2;

/**
 * 按意图标签筛选案例
 * @param entries 案例条目（已排序）
 * @param tags 意图标签（undefined = 弃权 → 空数组）
 * @returns 选中条目（≤2；空 = 不注入正文，降级到索引）
 */
export function selectGuideCases(
  entries: readonly GuideCaseEntry[],
  tags: IntentTags | undefined,
): GuideCaseEntry[] {
  if (tags === undefined) return [];
  let matched = entries.filter((e) => e.taskType === tags.taskType);
  if (tags.characterType !== undefined) {
    const finer = matched.filter((e) => e.characterType === tags.characterType);
    if (finer.length > 0) matched = finer;
  }
  if (tags.situation !== undefined) {
    const finer = matched.filter((e) => e.situation === tags.situation);
    if (finer.length > 0) matched = finer;
  }
  return matched.slice(0, GUIDE_CASE_MAX_SELECTED);
}
