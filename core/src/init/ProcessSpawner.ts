/**
 * 进程派生器：spawn conversation 子进程（stdio）+ wrap handle。
 * manager 进程侧用（生产），测试用内存 factory。
 * 可注入 novelStore：经 fd 3 第二条 stdio 管道暴露 novel {query,mutate}，子进程经 NovelHandle 访问共享 canonical store。
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { expose, wrap } from "kkrpc";
import { createStdioTransport } from "../rpc/transport.js";
import type { ConversationProcessSpawner } from "../conversation/server/ConversationManagerServer.js";
import type { ConversationHandle } from "../conversation/contract/handle/index.js";
import type { NovelStore } from "../novel/store.js";

/**
 * 创建默认进程派生器（stdio：spawn 子进程脚本 + wrap handle）
 * @param childScriptPath conversation 子进程入口脚本绝对路径
 * @param novelStore 可选共享 novel 存储（有则经 fd 3 暴露给子进程）
 * @returns 进程派生器
 */
export function createProcessSpawner(
	childScriptPath: string,
	novelStore?: NovelStore,
): ConversationProcessSpawner {
	return {
		spawn(opts) {
			// storedir 由 manager 分配：spawn 前确保目录存在，子进程在目录内建 journal
			mkdirSync(opts.storedir, { recursive: true });
			const child = spawn(process.execPath, [childScriptPath], {
				stdio: ["pipe", "pipe", "inherit", novelStore ? "pipe" : "ignore"],
				env: {
					...process.env,
					CONVERSATION_ID: opts.conversationId,
					AGENT_ID: "main",
					NOVEL_CONVERSATION_STOREDIR: opts.storedir,
					NOVEL_CONVERSATION_WORKSPACE: opts.workspace ?? ".",
				},
			});
			const transport = createStdioTransport({ readable: child.stdout!, writable: child.stdin! });
			const handle = wrap(transport) as ConversationHandle;
			if (novelStore) {
				const novelDuplex = child.stdio[3] as NodeJS.ReadWriteStream | undefined;
				if (novelDuplex) {
					const novelTransport = createStdioTransport({
						readable: novelDuplex,
						writable: novelDuplex,
					});
					expose(
						{
							query: (q: Parameters<NovelStore["query"]>[0]) => novelStore.query(q),
							mutate: (m: Parameters<NovelStore["mutate"]>[0]) => novelStore.mutate(m),
						},
						novelTransport,
					);
				}
			}
			return { child, handle };
		},
	};
}
