/**
 * journal 读侧契约：UI / zygote 直连，跨会话查 history（只读，进程无关）。
 */

import type { ConversationId } from "../types/index.js";
import type { OutputEvent, ProjectedEvent } from "../events/index.js";
import type { RunContext } from "../../../runtime/loop/types.js";

/** 已落盘 run（RunContext 去掉运行时闭包方法的持久化形态） */
export type PersistedRun = Omit<RunContext, "appendRunMessages">;

/** 读侧：跨会话查 history（纯文件读取，任何进程可访问），返回适配的 OutputEvent 序列 */
export interface ConversationJournalReadOnlyService {
	/**
	 * 读取会话已落盘 run（映射为 OutputEvent 序列；不含 assistant.delta）
	 * @param conversationId 会话 id
	 * @param opts 分页/游标
	 * @returns OutputEvent 序列（run-start/end 边界 + user/assistant.message + tool-call 事件）
	 */
	history(
		conversationId: ConversationId,
		opts: { fromSeq?: number; limit?: number }
	): Promise<OutputEvent[]>;
	/**
	 * 投影读取：读 journal 完整事件 → 过 ProjectionLayer → 返回 ProjectedEvent 序列
	 * （与 hub 实时订阅同形态；工具调用以 tool-recorded.started/recorded 出现，
	 * 不含完整 tool-call-request/response）。范围起点不在 run 边界时按确定性规则
	 * 处理（配对缺失 → unknown）。见 PRD `output-投影层` §4.5。
	 * @param conversationId 会话 id
	 * @param opts 分页/游标（与 history 相同语义）
	 * @returns ProjectedEvent 序列（投影事件，瞬态、不落盘）
	 */
	projectedHistory(
		conversationId: ConversationId,
		opts: { fromSeq?: number; limit?: number }
	): Promise<ProjectedEvent[]>;
	/**
	 * 读取会话已落盘 runs（按 run.seq 去重取最新、升序；子进程恢复上下文用）
	 * @param conversationId 会话 id
	 * @returns 已落盘 run 列表
	 */
	readRuns(conversationId: ConversationId): Promise<PersistedRun[]>;
}
