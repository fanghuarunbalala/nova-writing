/**
 * novel-style-guide 消息包装（PRD 检索式形态示例 F3）：检索命中的强风格段渲染为
 * 一条 system 消息（Compose spawn seed 注入，紧随委派 prompt——novel-guide 同款缝）。
 * 「仅示范段落节奏与叙述腔，禁止复用其内容词句」纪律由注入块正文自身声明；
 * 空内容返回 undefined（不注入）。
 */
import type { LLMessage } from "../../provider/types.js";

/** novel-style-guide 开闭标签（内层内容标记；wire 层外层照旧包 <system-reminder>） */
export const NOVEL_STYLE_GUIDE_OPEN_TAG = "<novel-style-guide>";
export const NOVEL_STYLE_GUIDE_CLOSE_TAG = "</novel-style-guide>";

/**
 * 包装注入块为 novel-style-guide system 消息
 * @param content 注入块正文（formatStylelibBlock 产出）
 * @returns system 消息；空内容返回 undefined
 */
export function wrapStylelibGuideMessage(content: string): LLMessage | undefined {
	if (content.length === 0) return undefined;
	return {
		role: "system",
		content: `${NOVEL_STYLE_GUIDE_OPEN_TAG}\n${content}\n${NOVEL_STYLE_GUIDE_CLOSE_TAG}`,
	};
}
