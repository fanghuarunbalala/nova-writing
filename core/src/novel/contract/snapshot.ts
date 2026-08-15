/**
 * 查询返回结构（对齐 model 实体）。
 */

import type { NovelId } from "../model/id.js";
import type { LeafPlan } from "../model/outline.js";
import type { NovelChangeEntity } from "./event.js";
import type {
	Character,
	Location,
	Paragraph,
	PublicationChapter,
	PublicationStructure,
	PublicationVolume,
	StoryOutline,
	StoryUnit,
} from "../model/index.js";

/** overview.get 返回 */
export interface NovelOverview {
	/** novel id */
	novelId: NovelId
	/** 小说标题 */
	title: string
	/** 各实体计数 */
	counts: {
		storyUnits: number
		characters: number
		locations: number
		volumes: number
		chapters: number
		paragraphs: number
	}
}

/** outline.get / storyUnit.get 返回 */
export interface StoryOutlineSnapshot {
	/** 大纲 */
	outline: StoryOutline
	/** 全部 story unit（层级树；includePlans=true 时附 leaf 与 progress） */
	units: StoryUnit[]
}

/** includePlans 读路径的单元附带：leaf 计划 + 叶完成度 rollup */
export type StoryUnitWithLeaf = StoryUnit & {
	/** leaf 计划（存在时附） */
	leaf?: LeafPlan
	/** 叶完成度 rollup（含派生状态） */
	progress?: {
		effectiveStatus: string
		isBlocked: boolean
		completedLeafCount: number
		totalLeafCount: number
	}
}

/** characters.get / locations.get 返回 */
export type CharacterSnapshot = Character
export type LocationSnapshot = Location

/** paragraph.get 返回 */
export type ParagraphSnapshot = Paragraph

/** mutate 结果（novel-db 返回，含变更事件所需字段） */
export interface NovelMutateResult {
	/** 变更后版本（乐观并发） */
	version: number
	/** 变更实体 id */
	changeId: string
	/** 实体类型 */
	entity: NovelChangeEntity
	/** 级联删除时实际删除的实体完整记录（含目标自身与级联展开；无级联时缺省） */
	deleted?: ReadonlyArray<NovelDeletedRecord>
}

/** 被删实体完整记录（NovelDelete 返回给调用方备查） */
export interface NovelDeletedRecord {
	/** 实体类型（story_unit/leaf_plan/paragraph/volume/chapter/character/location） */
	kind: string
	/** 实体 id */
	id: string
	/** 删除前的完整实体数据 */
	data: unknown
}

/** publication.get 返回 */
export interface PublicationSnapshot {
	/** 发布结构 */
	structure: PublicationStructure
	/** 卷 */
	volumes: PublicationVolume[]
	/** 章 */
	chapters: PublicationChapter[]
}
