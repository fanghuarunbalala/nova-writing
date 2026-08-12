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
		// 每次消息追加 → appendTurn（当前 turn 快照，同 seq 多写）
		onTurnMessageAppend: (turn) => {
			void journal.appendTurn(turn);
		},
		// 压缩后 → 全量覆盖（去重）
		onCompacted: (turns) => {
			void journal.writeTurns(turns);
		},
		// 清空 → 覆盖为空
		onClear: () => {
			void journal.writeTurns([]);
		},
	};
}
