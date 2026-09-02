/**
 * novel.changed 变更事件：mutation 成功落库后广播给订阅者（UI 刷新 / 会话失效缓存）。
 */

import type { NovelMutation } from "./mutation.js";

/** 变更涉及的实体类型 */
export type NovelChangeEntity =
	| "outline"
	| "character"
	| "location"
	| "paragraph"
	| "publication"

/** novel 数据变更事件 */
export interface NovelChangeEvent {
	/** 事件类型 */
	type: "novel.changed"
	/** 变更操作 */
	op: NovelMutation["op"]
	/** 实体类型 */
	entity: NovelChangeEntity
	/** 变更实体 id */
	id: string
	/** 变更后版本（乐观并发） */
	version: number
	/** 时间 */
	ts: string
}
