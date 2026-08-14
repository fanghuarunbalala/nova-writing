/**
 * journal 写侧契约：每 main conversation 一个实例，以 run 为单位存储（RunContext）。
 */

import type { Receipt } from "../types/index.js";
import type { RunContext } from "../../../runtime/loop/types.js";

/** 写侧：每 main conversation 一个实例，以 run 为单位落盘 */
export interface ConversationJournalService {
	/** 打开 journal（进程启动时） */
	open(): Promise<void>;
	/** 最近落盘的 run seq（open 恢复 / appendRun/writeRuns 更新；无落盘为 0） */
	readonly lastSeq: number;
	/**
	 * 追加一个 run 快照（一行一个完整 RunContext；同 seq 可多写，读侧取最新）
	 * @param run 当前 run（含 messages）
	 * @returns 持久化回执（seq）
	 */
	appendRun(run: RunContext): Promise<Receipt>;
	/**
	 * 全量覆盖写：compaction 后重写 journal（去重后的 runs 序列）
	 * @param runs 压缩后去重的 run 序列
	 */
	writeRuns(runs: RunContext[]): Promise<void>;
	/** 强制落盘 */
	flush(): Promise<void>;
	/** 关闭 journal（进程退出/停止时） */
	close(): Promise<void>;
	/** 崩溃恢复：读 journal 重放，seq 对齐 */
	reconcile(): Promise<void>;
}
