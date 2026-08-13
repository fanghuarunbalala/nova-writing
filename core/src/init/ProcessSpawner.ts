/**
 * 进程派生器：spawn conversation 子进程（stdio）+ wrap handle。
 * manager 进程侧用（生产），测试用内存 factory。
 */
import { spawn } from "node:child_process";
import { wrap } from "kkrpc";
import { createStdioTransport } from "../rpc/transport.js";
import type { ConversationProcessSpawner } from "../conversation/server/ConversationManagerServer.js";
import type { ConversationHandle } from "../conversation/contract/handle/index.js";

/**
 * 创建默认进程派生器（stdio：spawn 子进程脚本 + wrap handle）
 * @param childScriptPath conversation 子进程入口脚本绝对路径
 * @returns 进程派生器
 */
export function createProcessSpawner(childScriptPath: string): ConversationProcessSpawner {
	return {
		spawn(opts) {
			const child = spawn(process.execPath, [childScriptPath], {
				stdio: ["pipe", "pipe", "inherit"],
				env: { ...process.env, CONVERSATION_ID: opts.conversationId, AGENT_ID: "main" },
			});
			const transport = createStdioTransport({ readable: child.stdout, writable: child.stdin });
			const handle = wrap(transport) as ConversationHandle;
			return { child, handle };
		},
	};
}
