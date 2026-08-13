/**
 * 进程派生器：spawn conversation 子进程（stdio 主通道）+ wrap handle。
 * manager 进程侧用（生产），测试用内存 factory。
 * novel-db RPC 不走附加 fd 管道（Windows 下 fd>2 pipe 写方向会失效），走 kkrpc/ws（见 NovelDbWsServer）。
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { wrap } from "kkrpc";
import { createStdioTransport } from "../rpc/transport.js";
import type { ConversationProcessSpawner } from "../conversation/server/ConversationManagerServer.js";
import type { ConversationHandle } from "../conversation/contract/handle/index.js";

/** novel-db WS 连接信息（由 main 的 NovelDbWsServer 提供，经 env 注入子进程） */
export interface NovelDbWsConnection {
	/** 连接地址（ws://127.0.0.1:<port>） */
	url: string;
	/** 访问 token（WebSocket subprotocol） */
	token: string;
}

/**
 * 创建默认进程派生器（stdio：spawn 子进程脚本 + wrap handle）
 * @param childScriptPath conversation 子进程入口脚本绝对路径
 * @param novelWs novel-db WS 连接（url + token，经 env NOVEL_DB_WS_* 注入子进程；缺省子进程回退内存 store）
 * @returns 进程派生器
 */
export function createProcessSpawner(
	childScriptPath: string,
	novelWs?: NovelDbWsConnection,
): ConversationProcessSpawner {
	return {
		spawn(opts) {
			// storedir 由 manager 分配：spawn 前确保目录存在，子进程在目录内建 journal
			mkdirSync(opts.storedir, { recursive: true });
			// Electron main 里 process.execPath 是 electron.exe：ELECTRON_RUN_AS_NODE 使其按
			// 纯 Node 运行脚本（否则子进程是 Electron 实例，脚本完成后无窗口自动退出）
			const child = spawn(process.execPath, [childScriptPath], {
				stdio: ["pipe", "pipe", "inherit"],
				env: {
					...process.env,
					ELECTRON_RUN_AS_NODE: "1",
					CONVERSATION_ID: opts.conversationId,
					AGENT_ID: "main",
					NOVEL_CONVERSATION_STOREDIR: opts.storedir,
					NOVEL_CONVERSATION_WORKSPACE: opts.workspace ?? ".",
					...(novelWs !== undefined
						? { NOVEL_DB_WS_URL: novelWs.url, NOVEL_DB_WS_TOKEN: novelWs.token }
						: {}),
				},
			});
			const transport = createStdioTransport({ readable: child.stdout!, writable: child.stdin! });
			const handle = wrap(transport) as ConversationHandle;
			return { child, handle };
		},
	};
}
