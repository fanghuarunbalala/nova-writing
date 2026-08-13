/**
 * NovelMutation：novel-db 变更判别联合。
 * 方案 A：直接落库 + novel.changed 广播，无 commit/approval 管线。
 */

import type {
	CharacterId,
	LocationId,
	ParagraphId,
	PublicationChapterId,
	PublicationVolumeId,
	StoryUnitId,
} from "../model/id.js";
import type {
	OrderKey,
	StoryUnitPlanningStatus,
	StoryUnitRealizationStatus,
	StoryUnitScope,
} from "../model/outline.js";

/** 角色/地点输入（实体档案） */
export interface CharacterInput {
	/** 名字 */
	name: string
	/** 别名 */
	aliases?: readonly string[]
	/** 摘要 */
	summary?: string
	/** 初始状态 */
	initialState?: string
	/** 作者备注 */
	authorNotes?: string
}

/** 地点输入（与角色同构） */
export type LocationInput = CharacterInput

/** 乐观并发版本（= 实体 entityVersion；update/delete 需传最近读到的版本，stale 拒绝） */
export type NovelRevision = number

/** 变更：novel-db 写操作（create/insert 新建不需 revision；update/delete 需 baseRevision 乐观锁） */
export type NovelMutation =
	// ── 大纲 ──
	| {
			op: "outline.storyUnit.create"
			parentId?: StoryUnitId
			orderKey: OrderKey
			title: string
			intent?: string
			synopsis?: string
			scope?: StoryUnitScope
	  }
	| {
			op: "outline.storyUnit.update"
			storyUnitId: StoryUnitId
			baseRevision: NovelRevision
			patch: {
				title?: string
				intent?: string
				synopsis?: string
				scope?: StoryUnitScope
				planningStatus?: StoryUnitPlanningStatus
				realizationStatus?: StoryUnitRealizationStatus
			}
	  }
	| {
			op: "outline.storyUnit.move"
			storyUnitId: StoryUnitId
			baseRevision: NovelRevision
			parentId?: StoryUnitId
			orderKey: OrderKey
	  }
	| { op: "outline.storyUnit.delete"; storyUnitId: StoryUnitId; baseRevision: NovelRevision }
	// ── 实体 ──
	| { op: "character.create"; input: CharacterInput }
	| { op: "character.update"; characterId: CharacterId; baseRevision: NovelRevision; patch: Partial<CharacterInput> }
	| { op: "character.delete"; characterId: CharacterId; baseRevision: NovelRevision }
	| { op: "location.create"; input: LocationInput }
	| { op: "location.update"; locationId: LocationId; baseRevision: NovelRevision; patch: Partial<LocationInput> }
	| { op: "location.delete"; locationId: LocationId; baseRevision: NovelRevision }
	// ── 草稿段落（不可变：insert 追加 / update 替换） ──
	| { op: "paragraph.insert"; storyUnitId: StoryUnitId; orderKey: OrderKey; text: string }
	| { op: "paragraph.update"; paragraphId: ParagraphId; baseRevision: NovelRevision; text: string }
	| { op: "paragraph.delete"; paragraphId: ParagraphId; baseRevision: NovelRevision }
	// ── 发布 ──
	| { op: "publication.volume.create"; orderKey: OrderKey; title: string }
	| {
			op: "publication.volume.update"
			volumeId: PublicationVolumeId
			baseRevision: NovelRevision
			patch: { title?: string; orderKey?: OrderKey }
	  }
	| { op: "publication.volume.delete"; volumeId: PublicationVolumeId; baseRevision: NovelRevision }
	| {
			op: "publication.chapter.create"
			volumeId?: PublicationVolumeId
			orderKey: OrderKey
			title: string
			storyUnitId?: StoryUnitId
	  }
	| {
			op: "publication.chapter.update"
			chapterId: PublicationChapterId
			baseRevision: NovelRevision
			patch: {
				title?: string
				volumeId?: PublicationVolumeId
				orderKey?: OrderKey
			}
	  }
	| { op: "publication.chapter.delete"; chapterId: PublicationChapterId; baseRevision: NovelRevision }
