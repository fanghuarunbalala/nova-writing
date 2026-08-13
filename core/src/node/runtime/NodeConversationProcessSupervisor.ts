/**
 * NodeConversationProcessSupervisor：conversation 子进程监督器。
 * spawn 子进程 + stdio kkrpc wrap，跟踪活跃进程，close 时优雅终止。
 */

import { spawn, type ChildProcess } from "node:child_process";
import { wrap } from "kkrpc";
import { createStdioTransport } from "../../rpc/transport.js";
import type { ConversationHandle } from "../../conversation/contract/handle/index.js";

/** 监督器构造选项 */
export interface NodeConversationProcessSupervisorOptions {
	/** 子进程命令（process.execPath） */
	command: string
	/** 子进程入口脚本参数 */
	args: string[]
	/** 注入子进程的额外 env */
	env?: NodeJS.ProcessEnv
}

/** 活跃 conversation 进程 */
export interface ActiveConversationProcess {
	/** conversation id */
	conversationId: string
	/** 子进程 */
	child: ChildProcess
	/** 对端 handle（stdio wrap） */
	handle: ConversationHandle
}

/** conversation 子进程监督器 */
export class NodeConversationProcessSupervisor {
	private readonly options: NodeConversationProcessSupervisorOptions;
	private readonly active = new Map<string, ActiveConversationProcess>();

	/**
	 * @param options 命令 + 入口 + env
	 */
	constructor(options: NodeConversationProcessSupervisorOptions) {
		this.options = options;
	}

	/** 活跃进程数 */
	get activeProcessCount(): number {
		return this.active.size;
	}

	/**
	 * 派生 conversation 子进程
	 * @param conversationId conversation id
	 * @returns 子进程 + handle
	 */
	activate(conversationId: string): ActiveConversationProcess {
		const child = spawn(this.options.command, this.options.args, {
			stdio: ["pipe", "pipe", "inherit"],
			env: { ...process.env, ...this.options.env, CONVERSATION_ID: conversationId, AGENT_ID: "main" },
		});
		const transport = createStdioTransport({ readable: child.stdout!, writable: child.stdin! });
		const handle = wrap(transport) as ConversationHandle;
		const active: ActiveConversationProcess = { conversationId, child, handle };
		this.active.set(conversationId, active);
		child.on("exit", () => {
			this.active.delete(conversationId);
		});
		return active;
	}

	/** 终止所有活跃进程 */
	async close(): Promise<void> {
		for (const active of [...this.active.values()]) {
			active.child.kill();
		}
		this.active.clear();
	}
}
