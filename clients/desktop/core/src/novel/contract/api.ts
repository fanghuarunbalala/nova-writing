/**
 * novel-db 对外 API：client（wrap）/ server（expose）共用契约。
 */

import type { NovelQuery } from "./query.js";
import type { NovelMutation } from "./mutation.js";
import type { NovelMutateResult } from "./snapshot.js";

/** novel-db 对外 API（与 NovelHandle 的 wrap / NovelDbServer 的 expose 类型一致） */
export interface NovelApi {
	/**
	 * 查询
	 * @param q 查询
	 * @returns 对应 snapshot
	 */
	query(q: NovelQuery): Promise<unknown>;
	/**
	 * 变更（成功经 ZeroMQ 广播 novel.changed）
	 * @param m 变更
	 * @returns 变更结果
	 */
	mutate(m: NovelMutation): Promise<NovelMutateResult>;
	/**
	 * 批量变更（批内原子）：单事务顺序执行，任一项失败整批回滚并抛错
	 * @param ms 变更序列
	 * @returns 逐项变更结果（与 ms 等长同序）
	 */
	mutateBatch(ms: readonly NovelMutation[]): Promise<NovelMutateResult[]>;
}
