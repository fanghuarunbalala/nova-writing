/**
 * 查询返回结构（对齐 model 实体）。
 */

import type { NovelId } from "../model/id.js";
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

/** publication.get 返回 */
export interface PublicationSnapshot {
	/** 发布结构 */
	structure: PublicationStructure
	/** 卷 */
	volumes: PublicationVolume[]
	/** 章 */
	chapters: PublicationChapter[]
}
