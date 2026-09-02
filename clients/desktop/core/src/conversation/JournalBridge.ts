/**
 * LoopContext ↔ journal 对接：生成持久化监听器，订阅状态变化 → 落盘。
 * 只 main 使用（subagent 不持久化，上层只在 agentId === "main" 时接入 listeners）。
 */
import type { LoopContextListener } from "../runtime/loop/types.js";
import type { ConversationJournalService } from "./contract/journal/index.js";

/**
 * 生成 journal 持久化监听器（接入 AgentLoopConfig.listeners）
 * @param journal 写侧服务（main conversation 持有）
 * @returns LoopContextListener
 */
export function journalListener(journal: ConversationJournalService): LoopContextListener {
	return {
		// 每次消息追加 → 增量行（只写本次追加的消息；读侧折叠到快照基线，
		// 写盘 O(增量) 而非 O(run 全量)，gui-performance-2 功能点二）
		// 落盘失败只告警不抛出：journal 是持久化副产物，失败不能反向打断 agent run
		onRunMessageAppend: (run, messages) => {
			void journal.appendRunMessages(run.seq, messages).catch((e) => {
				console.error("[journal] appendRunMessages failed:", e);
			});
		},
		// 压缩后 → 全量覆盖（去重）
		onCompacted: (runs) => {
			void journal.writeRuns(runs).catch((e) => {
				console.error("[journal] writeRuns failed:", e);
			});
		},
		// 清空 → 覆盖为空
		onClear: () => {
			void journal.writeRuns([]).catch((e) => {
				console.error("[journal] writeRuns failed:", e);
			});
		},
	};
}
