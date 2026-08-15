/**
 * NovelMutation：novel-db 变更判别联合。
 * 方案 A：直接落库 + novel.changed 广播，无 commit/approval 管线。
 * P1 对齐 legacy 契约：创建可自选 id（重复抛 duplicate_id）；orderKey 缺省由
 * 宿主生成末位兄弟后继键；update 为 PATCH 形状（未提供字段保留）。
 */

import type {
	ParagraphId,
	CharacterId,
	LocationId,
	PublicationChapterId,
	PublicationVolumeId,
	StoryUnitId,
} from "../model/id.js";
import type {
	LeafPlan,
	LeafPlanPatch,
	OrderKey,
	StoryUnitAbandonment,
	StoryUnitBlockState,
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
			/** 自选 id（缺省宿主生成；重复抛 duplicate_id） */
			id?: string
			parentId?: StoryUnitId
			/** 排序键（缺省 = 末位兄弟后继） */
			orderKey?: OrderKey
			title: string
			intent?: string
			synopsis?: string
			scope?: StoryUnitScope
			planningStatus?: StoryUnitPlanningStatus
			realizationStatus?: StoryUnitRealizationStatus
			blockState?: StoryUnitBlockState
			abandonment?: StoryUnitAbandonment
			/** 创建时同挂 leaf 计划 */
			leaf?: LeafPlan
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
				/** 移动父节点（null = 移到根；未提供保留） */
				parentId?: StoryUnitId | null
				/** 重排序 */
				orderKey?: OrderKey
				/** 阻塞状态（null 清除） */
				blockState?: StoryUnitBlockState | null
				/** 废弃状态（null 清除） */
				abandonment?: StoryUnitAbandonment | null
				/** leaf 计划补丁（null 清整个计划；字段级替换见 LeafPlanPatch） */
				leaf?: LeafPlanPatch | null
			}
	  }
	| {
			op: "outline.storyUnit.move"
			storyUnitId: StoryUnitId
			baseRevision: NovelRevision
			parentId?: StoryUnitId
			orderKey: OrderKey
	  }
	| {
			op: "outline.storyUnit.delete"
			storyUnitId: StoryUnitId
			baseRevision: NovelRevision
			/** 级联：删整个子树（单元 + leaf 计划 + 段落 + 相关章选择）；缺省拒绝有依赖的单元 */
			cascade?: boolean
	  }
	// ── 实体 ──
	| { op: "character.create"; id?: string; input: CharacterInput }
	| { op: "character.update"; characterId: CharacterId; baseRevision: NovelRevision; patch: Partial<CharacterInput> }
	| { op: "character.delete"; characterId: CharacterId; baseRevision: NovelRevision }
	| { op: "location.create"; id?: string; input: LocationInput }
	| { op: "location.update"; locationId: LocationId; baseRevision: NovelRevision; patch: Partial<LocationInput> }
	| { op: "location.delete"; locationId: LocationId; baseRevision: NovelRevision }
	// ── 草稿段落（不可变值对象：insert 追加 / update PATCH） ──
	| {
			op: "paragraph.insert"
			/** 自选 id（缺省宿主生成；重复抛 duplicate_id） */
			id?: string
			storyUnitId: StoryUnitId
			/** 排序键（缺省 = 该单元末段后继） */
			orderKey?: OrderKey
			text: string
	  }
	| {
			op: "paragraph.update"
			paragraphId: ParagraphId
			baseRevision: NovelRevision
			/** 替换正文（未提供保留） */
			text?: string
			/** 移动所属单元（未提供保留） */
			storyUnitId?: StoryUnitId
			/** 重排序 */
			orderKey?: OrderKey
	  }
	| { op: "paragraph.delete"; paragraphId: ParagraphId; baseRevision: NovelRevision }
	// ── 发布 ──
	| {
			op: "publication.volume.create"
			/** 自选 id（缺省宿主生成；重复抛 duplicate_id） */
			id?: string
			/** 排序键（缺省 = 末卷后继） */
			orderKey?: OrderKey
			title: string
	  }
	| {
			op: "publication.volume.update"
			volumeId: PublicationVolumeId
			baseRevision: NovelRevision
			patch: { title?: string; orderKey?: OrderKey }
	  }
	| {
			op: "publication.volume.delete"
			volumeId: PublicationVolumeId
			baseRevision: NovelRevision
			/** 级联：删卷下全部章（含各自选择）；缺省拒绝含章的卷 */
			cascade?: boolean
	  }
	| {
			op: "publication.chapter.create"
			/** 自选 id（缺省宿主生成；重复抛 duplicate_id） */
			id?: string
			volumeId?: PublicationVolumeId
			/** 排序键（缺省 = 同卷末章后继） */
			orderKey?: OrderKey
			title: string
			storyUnitId?: StoryUnitId
			/** 章内段落有序选择（缺省空选择） */
			paragraphIds?: readonly ParagraphId[]
	  }
	| {
			op: "publication.chapter.update"
			chapterId: PublicationChapterId
			baseRevision: NovelRevision
			patch: {
				title?: string
				volumeId?: PublicationVolumeId
				orderKey?: OrderKey
				/** 全量替换有序选择（拆分/合并/重排/跨单元/中途收章都靠它）；null 清空选择 */
				paragraphIds?: readonly ParagraphId[] | null
			}
	  }
	| {
			op: "publication.chapter.delete"
			chapterId: PublicationChapterId
			baseRevision: NovelRevision
			/** 级联：清空章的段落选择（段落保留在单元下）；缺省拒绝有选择的章 */
			cascade?: boolean
	  }
