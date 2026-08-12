/**
 * 进程内 subagent 句柄。
 */

import type { OutputEvent } from "../events/index.js";

/** 主 loop → 进程内 subagent 的句柄 */
export interface SubagentHandle {
	/**
	 * 向 subagent 发送指令
	 * @param instruction 指令文本
	 */
	send(instruction: string): Promise<void>;
	/**
	 * 订阅 subagent 输出事件
	 * @returns 输出事件异步迭代器
	 */
	events(): AsyncIterable<OutputEvent>;
	/**
	 * 取 subagent 最终结果
	 * @returns 结果
	 */
	result(): Promise<unknown>;
	/**
	 * 终止 subagent
	 */
	stop(): Promise<void>;
}
