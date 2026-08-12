/**
 * conversation 输入侧 / 等待交互请求侧契约。
 * 纯类型契约：全进程共享。
 */

import type {
	ConversationApprovalDecision,
	ConversationApprovalRequest,
	ConversationAskingRequest,
	ConversationExitComposeRequest,
	ConversationSystemControl,
	ConversationUserCommand,
	ConversationUserMessage,
	Receipt,
} from "./types.js";

/** 输入侧契约：UI / manager 调 conversation（rpc，响应 = 持久化回执） */
export interface ConversationInteraction {
	/**
	 * 发送用户消息（turn lane）
	 * @param msg 用户消息
	 * @returns 持久化回执（seq）
	 */
	sendUserMessage(msg: ConversationUserMessage): Promise<Receipt>;
	/**
	 * 发送用户命令（turn lane，agent 可见）
	 * @param cmd 用户命令
	 * @returns 持久化回执（seq）
	 */
	sendUserCommand(cmd: ConversationUserCommand): Promise<Receipt>;
	/**
	 * 发送系统控制（control lane，可抢占）
	 * @param ctrl 系统控制
	 * @returns 持久化回执（seq）
	 */
	sendSystemControl(ctrl: ConversationSystemControl): Promise<Receipt>;
}

/**
 * 等待交互接收接口：conversation 实现它，接收经 manager 转发来的 wait 请求。
 * 这是**延迟 RPC**：实现方挂起该 turn，直到决策/回答产生才 resolve（wait 的意义 = 阻塞到答案）。
 * 发送方经 ConversationManagerServer 的 send*RequestTo 转发，manager 查图后调目标 conversation 的对应方法；
 * 决策/回答作为该 RPC 的返回值沿原链返回。
 */
export interface WaitingInteractionRequest {
	/**
	 * 请求审批（阻塞直到决策）
	 * @param req 审批请求
	 * @returns 审批决策（approve / reject / edit）
	 */
	sendApprovalRequest(
		req: ConversationApprovalRequest
	): Promise<ConversationApprovalDecision>;
	/**
	 * 请求提问（阻塞直到回答）
	 * @param req 提问请求
	 * @returns 用户回答文本
	 */
	sendAskingQuestionRequest(req: ConversationAskingRequest): Promise<string>;
	/**
	 * 请求退出 compose（阻塞直到退出）
	 * @param req 退出请求
	 * @returns 完成
	 */
	sendExitComposeRequest(req: ConversationExitComposeRequest): Promise<void>;
}
