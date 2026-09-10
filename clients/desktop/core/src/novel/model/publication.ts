/**
 * 发布模型：卷 → 章 结构（P3：章持 paragraphIds 有序选择，可跨单元/拆分/合并）。
 * 与旧系统一致（PublicationStructure + Volume[] + Chapter[]）。
 */

import type {
	ParagraphId,
	NovelId,
	PublicationChapterId,
	PublicationStructureId,
	PublicationVolumeId,
	StoryUnitId,
} from "./id.js";
import type { OrderKey } from "./outline.js";

/** 发布结构（一本 novel 一个） */
export interface PublicationStructure {
	/** 结构 id */
	id: PublicationStructureId
	/** 所属 novel */
	novelId: NovelId
}

/** 卷 */
export interface PublicationVolume {
	/** 卷 id */
	id: PublicationVolumeId
	/** 乐观并发版本 */
	entityVersion: number
	/** 排序键 */
	orderKey: OrderKey
	/** 卷标题 */
	title: string
}

/** 章 */
export interface PublicationChapter {
	/** 章 id */
	id: PublicationChapterId
	/** 乐观并发版本 */
	entityVersion: number
	/** 所属卷（缺省 = 未归卷） */
	volumeId?: PublicationVolumeId
	/** 排序键 */
	orderKey: OrderKey
	/** 章标题 */
	title: string
	/** 对应 story unit（P3 起仅作来源提示；正文以 paragraphIds 选择为准） */
	storyUnitId?: StoryUnitId
	/** 章内段落有序选择（P3：可跨单元、可拆分/合并/重排） */
	paragraphIds: readonly ParagraphId[]
}
