/**
 * 实体模型：Character / Location（同构），带 entity_version 乐观并发。
 * 与旧系统一致。
 */

import type { CharacterId, LocationId } from "./id.js";

/** 稳定实体档案（名字 / 别名 / 摘要 / 初始状态 / 作者备注） */
export interface StableEntityProfile {
	/** 名字 */
	name: string
	/** 别名 */
	aliases: readonly string[]
	/** 摘要 */
	summary?: string
	/** 初始状态 */
	initialState?: string
	/** 作者备注 */
	authorNotes?: string
}

/** 角色 */
export interface Character extends StableEntityProfile {
	/** 角色 id */
	id: CharacterId
	/** 乐观并发版本 */
	entityVersion: number
	/** 创建时间 */
	createdAt: string
	/** 更新时间 */
	updatedAt: string
}

/** 地点 */
export interface Location extends StableEntityProfile {
	/** 地点 id */
	id: LocationId
	/** 乐观并发版本 */
	entityVersion: number
	/** 创建时间 */
	createdAt: string
	/** 更新时间 */
	updatedAt: string
}
