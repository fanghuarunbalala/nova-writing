/**
 * 查询返回结构（对齐 model 实体）。
 */

import type { NovelId } from "../model/id.js";
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

/** outline.get 返回 */
export interface StoryOutlineSnapshot {
	/** 大纲 */
	outline: StoryOutline
	/** 全部 story unit（层级树） */
	units: StoryUnit[]
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
