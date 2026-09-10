/**
 * journal 写侧契约：每 main conversation 一个实例，以 run 为单位存储（RunContext）。
 * 行协议（gui-performance-2 功能点二）：`{seq, kind:"snapshot", run}`（run 开号一次）
 * + `{seq, kind:"append", messages}`（每次消息追加一行增量）；旧格式 `{seq, run}`
 * 无 kind 行按 snapshot 解释（向后兼容）。
 */

import type { Receipt } from "../types/index.js";
import type { RunContext } from "../../../runtime/loop/types.js";
import type { LLMessage } from "../../../runtime/provider/types.js";

/** 写侧：每 main conversation 一个实例，以 run 为单位落盘 */
export interface ConversationJournalService {
	/** 打开 journal（进程启动时） */
	open(): Promise<void>;
	/** 最近落盘的 run seq（open 恢复 / appendRun/writeRuns 更新；无落盘为 0） */
	readonly lastSeq: number;
	/**
	 * 追加一个 run 快照行（run 开号一次；同 seq 多写 = 快照重置基线）
	 * @param run 当前 run（含 messages）
	 * @returns 持久化回执（seq）
	 */
	appendRun(run: RunContext): Promise<Receipt>;
	/**
	 * 追加 run 消息增量行（只含本次追加的消息；读侧按文件序折叠到同 seq 基线上）
	 * @param seq 所属 run seq
	 * @param messages 本次追加的消息（增量）
	 * @returns 持久化回执（seq）
	 */
	appendRunMessages(seq: number, messages: LLMessage[]): Promise<Receipt>;
	/**
	 * 全量覆盖写：compaction/clear 后重写 journal（snapshot 行序列）
	 * @param runs 压缩后去重的 run 序列
	 */
	writeRuns(runs: RunContext[]): Promise<void>;
	/** 强制落盘（排空写队列） */
	flush(): Promise<void>;
	/** 关闭 journal（进程退出/停止时） */
	close(): Promise<void>;
	/** 崩溃恢复：读 journal 重放，seq 对齐 */
	reconcile(): Promise<void>;
}
