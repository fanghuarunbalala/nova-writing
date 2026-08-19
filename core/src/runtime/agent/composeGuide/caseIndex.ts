/**
 * 案例索引渲染（runtime 层，provider-neutral）：条目 → 每案一行索引文本。
 * 原住 node/workspace/agentCases.ts；迁出供四份质量规范段（novelStandards.ts，
 * 段尾「参考案例」小节，main 与 Compose 共享）复用，node 层 re-export 保持
 * 既有导入兼容。
 */
import type { GuideCaseEntry } from "./types.js";

/** 案例索引提供者（node 层注入：seed + 扫描 .novel/cases；失败返回 undefined） */
export type AgentCaseIndexProvider = () => Promise<readonly GuideCaseEntry[] | undefined>;

/**
 * 渲染索引文本（每案一行：路径｜标签｜摘要）
 * @param entries 案例条目（已排序）
 * @returns 索引文本
 */
export function renderAgentCasesIndex(entries: readonly GuideCaseEntry[]): string {
  return entries
    .map((e) => {
      const tags = [`task=${e.taskType}`];
      if (e.characterType !== undefined) tags.push(`character=${e.characterType}`);
      if (e.situation !== undefined) tags.push(`situation=${e.situation}`);
      const summary = e.summary !== "" ? ` ｜ ${e.summary}` : "";
      return `- ${e.path} ｜ ${tags.join(" ")}${summary}`;
    })
    .join("\n");
}
