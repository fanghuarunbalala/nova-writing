/**
 * NovelQuery：novel-db 查询判别联合（简化命名，对齐旧操作面）。
 */

import type {
	CharacterId,
	LocationId,
	ParagraphId,
	StoryUnitId,
} from "../model/id.js";

/** 查询：novel-db 只读操作 */
export type NovelQuery =
	/** 小说总览（标题 + 各实体计数） */
	| { op: "overview.get" }
	/** 大纲（含全部 story unit 树） */
	| { op: "outline.get" }
	/** 单个 story unit */
	| { op: "outline.storyUnit.get"; storyUnitId: StoryUnitId }
	/** 角色列表 */
	| { op: "characters.list" }
	/** 单个角色 */
	| { op: "characters.get"; characterId: CharacterId }
	/** 地点列表 */
	| { op: "locations.list" }
	/** 单个地点 */
	| { op: "locations.get"; locationId: LocationId }
	/** 某 story unit 的段落列表（按 orderKey 排序） */
	| { op: "paragraphs.list"; storyUnitId: StoryUnitId }
	/** 单个段落 */
	| { op: "paragraph.get"; paragraphId: ParagraphId }
	/** 发布结构（卷/章） */
	| { op: "publication.get" }
