/**
 * 远端 conversation 视图（UI 侧）。
 */

import type { ProjectedEvent } from "../events/index.js";
import type { ConversationInteraction } from "../interaction/index.js";
import type { WaitingInteractionRequest } from "../interaction/index.js";
import type { ConversationApprovalDecision, ConversationMode } from "../types/index.js";

/**
 * UI 侧对远端 conversation 的视图（createOrResume / spawnConversation 返回）。
 * = 输入侧契约 + 等待交互（审批/提问/退出 compose）+ 决策回传 + 事件流订阅 + 释放。
 */
export interface ConversationHandle extends ConversationInteraction, WaitingInteractionRequest {
	/**
	 * 订阅该 conversation 的输出事件流（hub，push-based 实时分发）。
	 * listener 为函数参数：跨 kkrpc 通道时由调用方经 kkrpc/remote-refs 的 proxy() 标记
	 * 才能被编码为 remote ref（AsyncIterable 返回值无法跨 RPC 传输，故用回调契约）。
	 * @param listener 输出事件回调（事件产生即推送）
	 * @returns 订阅完成（立即返回）；取消订阅经 dispose()
	 */
	subscribeEvents(listener: (e: ProjectedEvent) => void): Promise<void>;
	/**
	 * 回传审批决策（解除 sendApprovalRequest 的阻塞等待）
	 * @param requestId 审批请求 id（CMS wait 队列条目）
	 * @param decision 决策（approve / reject / edit）
	 */
	resolveApproval(requestId: string, decision: ConversationApprovalDecision): void;
	/**
	 * 回传提问回答（解除 sendAskingQuestionRequest 的阻塞等待）
	 * @param requestId 提问请求 id
	 * @param answer 回答文本
	 */
	resolveQuestion(requestId: string, answer: string): void;
	/**
	 * 回传退出 compose 完成（解除 sendExitComposeRequest 的阻塞等待）
	 * @param requestId 退出请求 id
	 */
	resolveExitCompose(requestId: string): void;
	/**
	 * 查询当前生效的会话模式（review/bypass/compose；mode.set 待下次 turn 生效）。
	 * 读走查（进度走读不走推同理，mode 是会话状态非进度）
	 * @returns 当前生效模式
	 */
	getConversationMode(): Promise<ConversationMode>;
	/** 释放 handle（取消全部订阅 / 断开通道） */
	dispose(): void;
}
