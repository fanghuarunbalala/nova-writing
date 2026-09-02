/**
 * conversation 输入侧契约。
 * 纯类型契约：全进程共享。
 */

import type {
	ConversationSystemControl,
	ConversationUserCommand,
	ConversationUserMessage,
	Receipt,
} from "../types/index.js";

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
