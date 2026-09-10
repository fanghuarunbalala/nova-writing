/**
 * novel-guide 消息包装（PRD compose-案例引导 F4）：选中案例正文 → 一条 system
 * 消息（persistent append 注入首 run，紧随委派 prompt）。wire 层外层由既有规则
 * 包 <system-reminder>（systemReminder.ts），<novel-guide> 为内层内容标记；
 * 权威性由 system 侧（novel.compose.guide 段 + process/reporting 协议）背书。
 * 空选中返回 undefined（不注入，降级到索引）。
 */
import type { LLMessage } from "../../provider/types.js";
import type { GuideCaseEntry } from "./types.js";

/** novel-guide 开闭标签（内层内容标记） */
export const NOVEL_GUIDE_OPEN_TAG = "<novel-guide>";
export const NOVEL_GUIDE_CLOSE_TAG = "</novel-guide>";

/**
 * 包装选中案例为 novel-guide system 消息
 * @param items 选中条目与各自全文
 * @returns system 消息；空选中返回 undefined
 */
export function wrapNovelGuideMessage(
  items: ReadonlyArray<{ entry: GuideCaseEntry; content: string }>,
): LLMessage | undefined {
  if (items.length === 0) return undefined;
  const body = items
    .map(({ entry, content }) => {
      const title = entry.summary !== "" ? entry.summary : entry.file;
      return [`## ${title}`, `路径：${entry.path}`, "", content].join("\n");
    })
    .join("\n\n---\n\n");
  return {
    role: "system",
    content: `${NOVEL_GUIDE_OPEN_TAG}\n以下是本任务配套的参考案例，起草前必须对照：\n\n${body}\n${NOVEL_GUIDE_CLOSE_TAG}`,
  };
}
