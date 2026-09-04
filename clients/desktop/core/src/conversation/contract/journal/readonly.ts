/**
 * journal 读侧契约：UI / zygote 直连，跨会话查 history（只读，进程无关）。
 */

import type { ConversationId } from "../types/index.js";
import type { OutputEvent, PersistedOutputEvent, ProjectedEvent } from "../events/index.js";
import type { RunContext } from "../../../runtime/loop/types.js";

/** 已落盘 run（RunContext 去掉运行时闭包方法的持久化形态） */
export type PersistedRun = Omit<RunContext, "appendRunMessages">;

/** history 分页/游标（纯云端化 ⑤ 分段加载） */
export interface JournalHistoryOpts {
	/** 前向起点：只返回 run seq ≥ fromSeq（resume/断档补拉用；缺省 1） */
	fromSeq?: number;
	/**
	 * 尾锚：只返回 run seq < before 的最近 limit 个 run（向上翻页游标 = 当前已载最早 run seq）。
	 * 与 fromSeq 互斥使用（同时给出时以 before 为准）。
	 */
	before?: number;
	/**
	 * 尾部页：返回最近 limit 个 run（首开场景——旧的「fromSeq+limit 取头部」语义保留，
	 * 长会话首屏只载最新一页）。与 before 同用时以 before 为准。
	 */
	latest?: boolean;
	/** 页大小（run 粒度；调用方可传 limit+1 探测是否还有更早） */
	limit?: number;
}

/** 读侧：跨会话查 history（纯文件读取，任何进程可访问），返回适配的 OutputEvent 序列 */
export interface ConversationJournalReadOnlyService {
	/**
	 * 读取会话已落盘 run（映射为 OutputEvent 序列；不含 assistant.delta）
	 * @param conversationId 会话 id
	 * @param opts 分页/游标
	 * @returns OutputEvent 序列（run-start/end 边界 + user/assistant.message + tool-call 事件）
	 */
	history(conversationId: ConversationId, opts: JournalHistoryOpts): Promise<OutputEvent[]>;
	/**
	 * 投影读取：读 journal 完整事件 → 过 ProjectionLayer → 返回 ProjectedEvent 序列
	 * （与 hub 实时订阅同形态；工具调用以 tool-recorded.started/recorded 出现，
	 * 不含完整 tool-call-request/response）。范围起点不在 run 边界时按确定性规则
	 * 处理（配对缺失 → unknown）。见 PRD `output-投影层` §4.5。
	 * @param conversationId 会话 id
	 * @param opts 分页/游标（与 history 相同语义）
	 * @returns ProjectedEvent 序列（投影事件，瞬态、不落盘）
	 */
	projectedHistory(conversationId: ConversationId, opts: JournalHistoryOpts): Promise<ProjectedEvent[]>;
	/**
	 * 读取会话已落盘 runs（按 run.seq 去重取最新、升序；子进程恢复上下文用）
	 * @param conversationId 会话 id
	 * @returns 已落盘 run 列表
	 */
	readRuns(conversationId: ConversationId): Promise<PersistedRun[]>;
	/**
	 * 读取会话状态事件 sidecar（state.jsonl；重启 hydrate 重放恢复 mode + compose 子状态）
	 * @param conversationId 会话 id
	 * @returns 状态事件序列（落盘顺序；坏行/半行容忍跳过）
	 */
	readStateEvents(conversationId: ConversationId): Promise<PersistedOutputEvent[]>;
}
