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
	/** 大纲（含全部 story unit 树；includePlans=true 附 leaf 计划与叶完成度 rollup） */
	| { op: "outline.get"; includePlans?: boolean }
	/** 单个 story unit（includePlans=true 附 leaf 计划） */
	| { op: "outline.storyUnit.get"; storyUnitId: StoryUnitId; includePlans?: boolean }
	/** 角色列表 */
	| { op: "characters.list" }
	/** 单个角色 */
	| { op: "characters.get"; characterId: CharacterId }
	/** 地点列表 */
	| { op: "locations.list" }
	/** 单个地点 */
	| { op: "locations.get"; locationId: LocationId }
	/** 段落列表（storyUnitId 缺省返回全部——按单元分组、组内按 orderKey 排序） */
	| { op: "paragraphs.list"; storyUnitId?: StoryUnitId }
	/** 单个段落 */
	| { op: "paragraph.get"; paragraphId: ParagraphId }
	/** 发布结构（卷/章） */
	| { op: "publication.get" }
