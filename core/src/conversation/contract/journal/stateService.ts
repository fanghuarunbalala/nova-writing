/**
 * 状态事件写侧契约：compose/mode 边界事件 sidecar 落盘（state.jsonl）。
 * 与 journal.jsonl（turn 快照）并存；供会话进程重启时 hydrate 重放恢复 mode + compose 子状态。
 */

import type { PersistedOutputEvent } from "../events/index.js";

/** 状态事件写侧：每 main conversation 一个实例，一行一条 `{ts, event}` */
export interface ConversationStateJournalService {
	/**
	 * 追加一条状态事件（调用方只传 persist=true 的 compose/mode 边界事件）
	 * @param event 状态事件（compose.begin/submitted/applied/discarded、mode.changed）
	 */
	append(event: PersistedOutputEvent): Promise<void>;
}
