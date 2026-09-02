/**
 * 草稿段落：不可变值对象，属于一个 StoryUnit，orderKey 局部排序。
 * 与旧系统一致（draft = 段落级正文）。
 */

import type { ParagraphId, StoryUnitId } from "./id.js";
import type { LeafRhythm, OrderKey } from "./outline.js";

/** 草稿段落（不可变；一段一句，携带节奏标注用于情绪曲线检查） */
export interface Paragraph {
	/** 段落 id */
	id: ParagraphId
	/** 乐观并发版本 */
	entityVersion: number
	/** 所属 story unit */
	storyUnitId: StoryUnitId
	/** 段落内排序键 */
	orderKey: OrderKey
	/** 正文（一段一句：网文排版范式） */
	text: string
	/** 节奏档位（对齐 leaf 节奏拍八档；旧数据缺省 hold） */
	rhythm: LeafRhythm
	/** 情绪强度 1-5（情绪曲线检查的数据源；旧数据缺省 3） */
	intensity: number
}
