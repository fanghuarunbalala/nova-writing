/**
 * Subagent：进程内轻量子代理（复用 AgentLoop，无独立进程/持久化）。
 * 主 loop 派生，处理局部子任务（如只读 explore/compose）。
 */
import type { AgentLoop } from "../../runtime/loop/AgentLoop.js";
import type { SamplingConfig } from "../../runtime/provider/types.js";
import type { OutputEvent } from "../contract/events/index.js";
import type { SubagentHandle } from "../contract/handle/subagent.js";

/** Subagent 构造选项 */
export interface SubagentOptions {
	/** 子代理 agent 循环（上层用子代理能力装配） */
	loop: AgentLoop;
	/** 采样配置 */
	sampling: SamplingConfig;
}

/** 进程内 subagent 实现 */
export class Subagent implements SubagentHandle {
	/** agent 循环 */
	private readonly loop: AgentLoop;
	/** 采样 */
	private readonly sampling: SamplingConfig;
	/** 最终结果 */
	private lastResult?: unknown;
	/** 输出事件订阅者 */
	private readonly eventListeners = new Set<(e: OutputEvent) => void>();

	/**
	 * 构造 Subagent
	 * @param opts agent 循环 + 采样
	 */
	constructor(opts: SubagentOptions) {
		this.loop = opts.loop;
		this.sampling = opts.sampling;
	}

	/** 向 subagent 发送指令（触发一轮对话） */
	async send(instruction: string): Promise<void> {
		const result = await this.loop.run(instruction, { sampling: this.sampling }, (e) => this.emit(e));
		this.lastResult = result.final.content;
	}

	/** 取最终结果 */
	async result(): Promise<unknown> {
		return this.lastResult;
	}

	/** 终止 subagent */
	async stop(): Promise<void> {
		this.loop.cancel();
	}

	/** 订阅输出事件流 */
	events(): AsyncIterable<OutputEvent> {
		const listeners = this.eventListeners;
		const queue: OutputEvent[] = [];
		const waiters: Array<() => void> = [];
		const onEvent = (e: OutputEvent) => {
			queue.push(e);
			const wake = waiters.shift();
			if (wake) wake();
		};
		listeners.add(onEvent);
		return {
			[Symbol.asyncIterator]() {
				return {
					next: () =>
						new Promise<IteratorResult<OutputEvent>>((resolve) => {
							if (queue.length > 0) resolve({ value: queue.shift()!, done: false });
							else waiters.push(() => resolve({ value: queue.shift()!, done: false }));
						}),
					return: () => {
						listeners.delete(onEvent);
						return Promise.resolve({ value: undefined as unknown as OutputEvent, done: true });
					},
				};
			},
		};
	}

	/** 分发输出事件 */
	private emit(e: OutputEvent): void {
		for (const l of this.eventListeners) l(e);
	}
}
