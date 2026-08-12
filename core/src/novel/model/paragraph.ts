/**
 * 草稿段落：不可变值对象，属于一个 StoryUnit，orderKey 局部排序。
 * 与旧系统一致（draft = 段落级正文）。
 */

import type { ParagraphId, StoryUnitId } from "./id.js";
import type { OrderKey } from "./outline.js";

/** 草稿段落（不可变） */
export interface Paragraph {
	/** 段落 id */
	id: ParagraphId
	/** 所属 story unit */
	storyUnitId: StoryUnitId
	/** 段落内排序键 */
	orderKey: OrderKey
	/** 正文 */
	text: string
}
