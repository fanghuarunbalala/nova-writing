/**
 * 大纲模型：StoryOutline（1 novel = 1 outline）+ StoryUnit 层级树 + 状态。
 * 与旧系统一致：层级（parentId + orderKey 稠密排序）、scope、规划/实现/阻塞/废弃状态；
 * P2 补 leaf 计划（场景级故事设计文档，从 legacy 迁回）。
 */

import type { CharacterId, LocationId, NovelId, StoryOutlineId, StoryUnitId } from "./id.js";

/** 稠密排序键：兄弟间插入不重排（旧 OrderKey，opaque string） */
declare const orderKeyBrand: unique symbol
export type OrderKey = string & { readonly [orderKeyBrand]: "OrderKey" }

/** 大纲单元层级作用域 */
export type StoryUnitScope = "saga" | "arc" | "sequence" | "scene" | "custom"

/** 规划状态 */
export type StoryUnitPlanningStatus = "idea" | "outlined" | "ready"

/** 实现状态 */
export type StoryUnitRealizationStatus =
	| "pending"
	| "in-progress"
	| "completed"
	| "abandoned"

/** 阻塞原因 */
export type StoryUnitBlockReason =
	| "dependency"
	| "decision-required"
	| "continuity-conflict"
	| "missing-material"
	| "outline-incomplete"
	| "other"

/** 废弃原因 */
export type StoryUnitAbandonReason =
	| "story-direction-changed"
	| "replaced"
	| "merged"
	| "duplicate"
	| "scope-reduced"
	| "other"

/** 阻塞状态 */
export interface StoryUnitBlockState {
	/** 阻塞原因码 */
	reasonCode?: StoryUnitBlockReason
	/** 说明 */
	note?: string
	/** 依赖的 story unit 列表 */
	dependencyIds: readonly StoryUnitId[]
}

/** 废弃状态 */
export interface StoryUnitAbandonment {
	/** 废弃原因码 */
	reasonCode: StoryUnitAbandonReason
	/** 说明 */
	note?: string
}

/** StoryOutline：一本 novel 一个 */
export interface StoryOutline {
	/** outline id */
	id: StoryOutlineId
	/** 所属 novel */
	novelId: NovelId
}

// ── leaf 计划（场景级故事设计文档，挂在 story unit 上；legacy LeafPlan 迁回） ──

/** 人物在场方式 */
export type LeafPresence = "present" | "offstage" | "mentioned"

/** 人物参与角色 */
export type LeafCharacterRole = "point-of-view" | "participant" | "observer" | "affected"

/** 人物绑定（leaf 内） */
export interface LeafCharacterBinding {
	/** 绑定人物 */
	characterId: CharacterId
	/** 在场与参与 */
	involvement?: {
		presence: LeafPresence
		roles: readonly LeafCharacterRole[]
	}
	/** 备注 */
	note?: string
}

/** 地点绑定角色 */
export type LeafLocationRole = "primary" | "secondary" | "mentioned"

/** 地点绑定（leaf 内） */
export interface LeafLocationBinding {
	/** 绑定地点 */
	locationId: LocationId
	/** 参与方式 */
	involvement?: {
		role: LeafLocationRole
		affected: boolean
	}
	/** 备注 */
	note?: string
}

/** leaf 事件（有序） */
export interface LeafEvent {
	/** 事件 id（leaf 内唯一） */
	id: string
	/** 排序 */
	orderKey: string
	/** 描述 */
	description: string
}

/** 节奏拍档位（叙事节拍） */
export type LeafRhythm =
	| "setup"
	| "rise"
	| "hold"
	| "turn"
	| "climax"
	| "fall"
	| "release"
	| "aftermath"

/** 节奏拍 */
export interface LeafRhythmBeat {
	/** 拍 id（leaf 内唯一） */
	id: string
	/** 排序 */
	orderKey: string
	/** 节拍档位 */
	rhythm: LeafRhythm
	/** 强度 1-5 */
	intensity: number
	/** 读者情绪 */
	readerEmotion?: string
	/** 视角人物情绪 */
	pointOfViewEmotion?: string
	/** 描述 */
	description?: string
	/** 关联事件 */
	relatedEventIds: readonly string[]
}

/** 实体状态变更类别（连贯性追踪） */
export type LeafEntityChangeCategory =
	| "identity"
	| "condition"
	| "location"
	| "relationship"
	| "knowledge"
	| "goal"
	| "ownership"
	| "environment"
	| "custom"

/** 实体状态变更 */
export interface LeafEntityChange {
	/** 变更 id（leaf 内唯一） */
	id: string
	/** 实体类型 */
	entityType: "character" | "location"
	/** 实体 id */
	entityId: string
	/** 关联实体（关系类变更的另一端） */
	relatedEntityId?: string
	/** 变更类别 */
	category: LeafEntityChangeCategory
	/** 摘要 */
	summary: string
	/** 来源事件 */
	sourceEventIds: readonly string[]
}

/** leaf 计划：场景级故事设计文档（人物/地点绑定、事件序列、节奏拍、实体状态变更） */
export interface LeafPlan {
	/** 场景模式：located（有确定地点）/ location-independent（无固定地点） */
	settingMode: "located" | "location-independent"
	/** 时间 */
	time?: {
		description: string
		timelineOrderKey?: string
	}
	/** 人物绑定 */
	characters: readonly LeafCharacterBinding[]
	/** 地点绑定 */
	locations: readonly LeafLocationBinding[]
	/** 事件序列 */
	events: readonly LeafEvent[]
	/** 节奏拍 */
	rhythmBeats: readonly LeafRhythmBeat[]
	/** 实体状态变更（连贯性追踪） */
	entityChanges: readonly LeafEntityChange[]
}

/** leaf 计划补丁（Edit 用）：字段级替换，null 清空对应集合 */
export interface LeafPlanPatch {
	settingMode?: "located" | "location-independent"
	time?: { description: string; timelineOrderKey?: string } | null
	characters?: readonly LeafCharacterBinding[] | null
	locations?: readonly LeafLocationBinding[] | null
	events?: readonly LeafEvent[] | null
	rhythmBeats?: readonly LeafRhythmBeat[] | null
	entityChanges?: readonly LeafEntityChange[] | null
}

/** 大纲单元（层级树节点）：内容 + 状态 */
export interface StoryUnit {
	/** story unit id */
	id: StoryUnitId
	/** 乐观并发版本 */
	entityVersion: number
	/** 所属 outline */
	outlineId: StoryOutlineId
	/** 父节点（root 缺省） */
	parentId?: StoryUnitId
	/** 兄弟间排序键（稠密） */
	orderKey: OrderKey
	/** 标题 */
	title: string
	/** 意图 */
	intent?: string
	/** 梗概 */
	synopsis?: string
	/** 层级作用域 */
	scope?: StoryUnitScope
	/** 规划状态 */
	planningStatus: StoryUnitPlanningStatus
	/** 实现状态 */
	realizationStatus: StoryUnitRealizationStatus
	/** 阻塞状态 */
	blockState?: StoryUnitBlockState
	/** 废弃状态 */
	abandonment?: StoryUnitAbandonment
}
