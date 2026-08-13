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
	 * 订阅该 conversation 的输出事件流（hub，push-based 实时分发）。
	 * listener 为函数参数：跨 kkrpc 通道时由调用方经 kkrpc/remote-refs 的 proxy() 标记
	 * 才能被编码为 remote ref（AsyncIterable 返回值无法跨 RPC 传输，故用回调契约）。
	 * @param listener 输出事件回调（事件产生即推送）
	 * @returns 订阅完成（立即返回）；取消订阅经 dispose()
	 */
	subscribeEvents(listener: (e: OutputEvent) => void): Promise<void>;
	/** 释放 handle（取消全部订阅 / 断开通道） */
	dispose(): void;
}
