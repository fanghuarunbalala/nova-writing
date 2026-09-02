/**
 * 事件流两端。
 * 写端：进程内生产方 push（单写者队列 + 单一 drainer）；读端：订阅方 pull。
 */

import type { LoopEvent } from "../../../runtime/loop/types.js";

/** 事件流写端（进程内生产方 push；同步 O(1)，不阻塞） */
export interface ConversationEventBusEnqueue {
	/**
	 * 推入一条输出事件
	 * @param evt 输出事件
	 */
	enqueue(evt: LoopEvent): void;
}

/** 事件流读端（订阅方 pull） */
export interface ConversationEventBusDequeue {
	/** 异步迭代器：按序拉取输出事件 */
	[Symbol.asyncIterator](): AsyncIterator<LoopEvent>;
}
