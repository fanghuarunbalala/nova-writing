/**
 * NovelStore：novel-db 存储抽象（RPC server 与 sqlite 之间）。
 * 本阶段用内存实现跑通 RPC 垂直切片；sqlite 实现下一阶段。
 */

import type { NovelQuery } from "./contract/query.js";
import type { NovelMutation } from "./contract/mutation.js";
import type { NovelMutateResult } from "./contract/snapshot.js";

/** novel 数据存储（query 读 / mutate 写） */
export interface NovelStore {
	/**
	 * 执行查询
	 * @param q 查询
	 * @returns 对应 snapshot（按 op 判别）
	 */
	query(q: NovelQuery): Promise<unknown>;
	/**
	 * 执行变更
	 * @param m 变更
	 * @returns 变更结果（版本 / 实体 id / 类型，用于 novel.changed）
	 */
	mutate(m: NovelMutation): Promise<NovelMutateResult>;
	/**
	 * 批量变更（批内原子）：单事务顺序执行，任一项失败整批回滚并抛错
	 * @param ms 变更序列
	 * @returns 逐项变更结果（与 ms 等长同序）
	 */
	mutateBatch(ms: readonly NovelMutation[]): Promise<NovelMutateResult[]>;
}
