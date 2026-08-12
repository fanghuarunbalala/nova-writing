/**
 * 发布模型：卷 → 章 结构。
 * 与旧系统一致（PublicationStructure + Volume[] + Chapter[]）。
 */

import type {
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
	/** 排序键 */
	orderKey: OrderKey
	/** 卷标题 */
	title: string
}

/** 章 */
export interface PublicationChapter {
	/** 章 id */
	id: PublicationChapterId
	/** 所属卷（缺省 = 未归卷） */
	volumeId?: PublicationVolumeId
	/** 排序键 */
	orderKey: OrderKey
	/** 章标题 */
	title: string
	/** 对应 story unit（发布的正文来源） */
	storyUnitId?: StoryUnitId
}
