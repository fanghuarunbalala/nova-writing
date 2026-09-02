/**
 * 等待交互接收接口：conversation 实现它，接收经 manager 转发来的 wait 请求。
 * 这是**延迟 RPC**：实现方挂起该 run，直到决策/回答产生才 resolve（wait 的意义 = 阻塞到答案）。
 * 发送方经 ConversationManagerServer 的 send*RequestTo 转发，manager 查图后调目标 conversation 的对应方法；
 * 决策/回答作为该 RPC 的返回值沿原链返回。
 */

import type {
	AskQuestionAnswer,
	ConversationApprovalDecision,
	ConversationApprovalRequest,
	ConversationAskingRequest,
	ConversationExitComposeRequest,
} from "../types/index.js";

/** 等待交互接收接口（conversation 实现） */
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
	 * @returns 逐问回答（与 req.questions 顺序对应；skipped 表示作者跳过）
	 */
	sendAskingQuestionRequest(req: ConversationAskingRequest): Promise<readonly AskQuestionAnswer[]>;
	/**
	 * 请求退出 compose（阻塞直到退出）
	 * @param req 退出请求
	 * @returns 完成
	 */
	sendExitComposeRequest(req: ConversationExitComposeRequest): Promise<void>;
}
