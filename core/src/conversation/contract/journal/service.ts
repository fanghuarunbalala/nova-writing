/**
 * journal 写侧契约：每 main conversation 一个实例，以 turn 为单位存储（TurnContext）。
 */

import type { Receipt } from "../types/index.js";
import type { TurnContext } from "../../../runtime/loop/types.js";

/** 写侧：每 main conversation 一个实例，以 turn 为单位落盘 */
export interface ConversationJournalService {
	/** 打开 journal（进程启动时） */
	open(): Promise<void>;
	/** 最近落盘的 turn seq（open 恢复 / appendTurn/writeTurns 更新；无落盘为 0） */
	readonly lastSeq: number;
	/**
	 * 追加一个 turn 快照（一行一个完整 TurnContext；同 seq 可多写，读侧取最新）
	 * @param turn 当前 turn（含 messages）
	 * @returns 持久化回执（seq）
	 */
	appendTurn(turn: TurnContext): Promise<Receipt>;
	/**
	 * 全量覆盖写：compaction 后重写 journal（去重后的 turns 序列）
	 * @param turns 压缩后去重的 turn 序列
	 */
	writeTurns(turns: TurnContext[]): Promise<void>;
	/** 强制落盘 */
	flush(): Promise<void>;
	/** 关闭 journal（进程退出/停止时） */
	close(): Promise<void>;
	/** 崩溃恢复：读 journal 重放，seq 对齐 */
	reconcile(): Promise<void>;
}
