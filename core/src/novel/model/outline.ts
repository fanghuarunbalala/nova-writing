/**
 * 大纲模型：StoryOutline（1 novel = 1 outline）+ StoryUnit 层级树 + 状态。
 * 与旧系统一致：层级（parentId + orderKey 稠密排序）、scope、规划/实现/阻塞/废弃状态。
 */

import type { NovelId, StoryOutlineId, StoryUnitId } from "./id.js";

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
