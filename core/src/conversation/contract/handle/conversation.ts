/**
 * 远端 conversation 视图（UI 侧）。
 */

import type { OutputEvent } from "../events/index.js";
import type { ConversationInteraction } from "../interaction/index.js";
import type { WaitingInteractionRequest } from "../interaction/index.js";

/**
 * UI 侧对远端 conversation 的视图（createOrResume / spawnConversation 返回）。
 * = 输入侧契约 + 等待交互（审批/提问/退出 compose）+ 事件流订阅 + 释放。
 */
export interface ConversationHandle extends ConversationInteraction, WaitingInteractionRequest {
	/**
	 * 订阅该 conversation 的输出事件流（hub）
	 * @param fromSeq 可选：从指定 journal 序列号开始（重放已落盘部分）
	 * @returns 输出事件异步迭代器（break 即取消订阅）
	 */
	events(fromSeq?: number): AsyncIterable<OutputEvent>;
	/** 释放 handle（取消订阅 / 断开通道） */
	dispose(): void;
}
