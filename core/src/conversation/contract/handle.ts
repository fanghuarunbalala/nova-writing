/**
 * 对端 handle 契约：调用方持有的远端/进程内视图。
 */

import type { OutputEvent } from "./events.js";
import type { ConversationInteraction } from "./interaction.js";

/**
 * UI 侧对远端 conversation 的视图（createOrResume / spawnConversation 返回）。
 * = 输入侧契约（含 sendSystemControl 应答审批）+ 事件流订阅 + 释放。
 */
export interface ConversationHandle extends ConversationInteraction {
	/**
	 * 订阅该 conversation 的输出事件流（hub）
	 * @param fromSeq 可选：从指定 journal 序列号开始（重放已落盘部分）
	 * @returns 输出事件异步迭代器（break 即取消订阅）
	 */
	events(fromSeq?: number): AsyncIterable<OutputEvent>;
	/** 释放 handle（取消订阅 / 断开通道） */
	dispose(): void;
}
