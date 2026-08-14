/**
 * 进程派生器：spawn conversation 子进程（stdio 仅 stderr 日志）+ manager WS 双工握手。
 * manager 进程侧用（生产），测试用内存 factory。
 * conversation ↔ CMS 全量 rpc 走 manager WS（单连接双工 RPCChannel）；novel-db 走 kkrpc/ws。
 * fd>2 管道禁用（Windows 写方向失效，见 CLAUDE.md transport 约束）。
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ConversationProcessSpawner } from "../conversation/server/ConversationManagerServer.js";
import type { ConnectedConversation } from "../conversation/server/ConversationManagerWsServer.js";
import type { ConversationHandle } from "../conversation/contract/handle/index.js";
import type { Logger } from "../log/Logger.js";

/**
 * stderr 内容捕获上限：正常运行的 child 只写常规日志；仅当 child 异常退出时
 * （非零退出码或被信号杀死）才把缓冲的 stderr 原文写入日志用于崩溃诊断。
 * 健康运行（exit 0）永不落盘 stderr 内容——保持 supervisor 脱敏不变量。
 * Capture cap for child stderr text. Buffered content is only logged when the
 * child exits abnormally (non-zero exit or signal), preserving the redaction
 * invariant on clean runs.
 */
const STDERR_CAPTURE_LIMIT = 8 * 1024;

/** child 崩溃自曝日志路径 env（runDesktopRuntimeChildEntrypoint 读） */
const CHILD_LOG_ENV = "NOVEL_DESKTOP_CHILD_LOG" as const;

/** manager WS 传输（main 的 ConversationManagerWsServer 句柄面） */
export interface ManagerWsTransport {
	/** 连接地址（子进程 env） */
	url: string;
	/** 访问 token */
	token: string;
	/** 连接报到订阅（spawner 等待用） */
	onConnected(listener: (connected: ConnectedConversation) => void): () => void;
}

/** novel-db WS 连接信息（由 main 的 NovelDbWsServer 提供，经 env 注入子进程） */
export interface NovelDbWsConnection {
	/** 连接地址（ws://127.0.0.1:<port>） */
	url: string;
	/** 访问 token（WebSocket subprotocol） */
	token: string;
}

/** 进程派生器传输选项 */
export interface ProcessSpawnerTransports {
	/** manager WS（conversation↔CMS 双工） */
	managerWs: ManagerWsTransport;
	/** novel-db WS（缺省子进程回退内存 store） */
	novelWs?: NovelDbWsConnection;
	/** 崩溃诊断日志（缺省回退 console.error，仅异常退出时写 stderr 原文） */
	logger?: Logger;
}

/** 连接握手超时（子进程应秒级连回） */
const CONNECT_TIMEOUT_MS = 15_000;

/**
 * 创建默认进程派生器（manager WS 握手：spawn 子进程 + 等其 register 连回）
 * @param childScriptPath conversation 子进程入口脚本绝对路径
 * @param transports manager WS + 可选 novel WS
 * @returns 进程派生器（spawn 返回的 handle 为 Promise：连接报到后 resolve）
 */
export function createProcessSpawner(
	childScriptPath: string,
	transports: ProcessSpawnerTransports,
): ConversationProcessSpawner {
	return {
		spawn(opts) {
			// storedir 由 manager 分配：spawn 前确保目录存在，子进程在目录内建 journal
			mkdirSync(opts.storedir, { recursive: true });
			// 崩溃自曝日志目录：child 入口在一切逻辑之前同步 appendFile，目录必须已存在
			const childLogPath = join(opts.storedir, "logs", "runtime-child.log");
			mkdirSync(join(opts.storedir, "logs"), { recursive: true });
			// Electron main 里 process.execPath 是 electron.exe：ELECTRON_RUN_AS_NODE 使其按
			// 纯 Node 运行脚本（否则子进程是 Electron 实例，脚本完成后无窗口自动退出）
			const child = spawn(process.execPath, [childScriptPath], {
				// stdio 不承载任何 rpc：stdin/stdout 丢弃，stderr 捕获（崩溃诊断 + 回显）
				stdio: ["ignore", "ignore", "pipe"],
				env: {
					...process.env,
					ELECTRON_RUN_AS_NODE: "1",
					CONVERSATION_ID: opts.conversationId,
					AGENT_ID: "main",
					NOVEL_CONVERSATION_STOREDIR: opts.storedir,
					NOVEL_CONVERSATION_WORKSPACE: opts.workspace ?? ".",
					NOVEL_MANAGER_WS_URL: transports.managerWs.url,
					NOVEL_MANAGER_WS_TOKEN: transports.managerWs.token,
					[CHILD_LOG_ENV]: childLogPath,
					...(transports.novelWs !== undefined
						? { NOVEL_DB_WS_URL: transports.novelWs.url, NOVEL_DB_WS_TOKEN: transports.novelWs.token }
						: {}),
				},
			});
			// stderr 捕获：实时回显（保持原 inherit 的开发可见性）+ 8KB 缓冲。
			// 仅异常退出（非零退出码/信号）时把缓冲原文写入日志——健康运行不泄漏内容。
			let stderrText = "";
			let stderrTruncated = false;
			child.stderr?.on("data", (chunk: Buffer) => {
				process.stderr.write(chunk);
				if (!stderrTruncated) {
					const text = chunk.toString("utf8");
					const remaining = STDERR_CAPTURE_LIMIT - stderrText.length;
					if (text.length > remaining) {
						stderrText += text.slice(0, Math.max(0, remaining));
						stderrTruncated = true;
					} else {
						stderrText += text;
					}
				}
			});
			child.on("exit", (code, signal) => {
				if (code === 0 && signal === null) return;
				const fields = {
					conversationId: opts.conversationId,
					code,
					signal: signal ?? null,
					...(stderrTruncated ? { truncated: true } : {}),
					text: stderrText,
				};
				if (transports.logger !== undefined) {
					transports.logger.error("runtime.process.child_stderr", fields);
				} else {
					// 无 logger 时回退 console：内容与 inherit 时代一致，仅多一层异常退出标记
					console.error(
						`[runtime] conversation ${opts.conversationId} 异常退出 (code=${code}, signal=${signal ?? "none"}) stderr 原文:\n${stderrText}`,
					);
				}
			});
			// 等子进程 register 连回（manager WS onConnected 匹配 conversationId）
			const handle = new Promise<ConversationHandle>((resolve, reject) => {
				const timer = setTimeout(() => {
					unsubscribe();
					reject(new Error(`conversation ${opts.conversationId} 连接报到超时`));
				}, CONNECT_TIMEOUT_MS);
				const unsubscribe = transports.managerWs.onConnected((connected) => {
					if (connected.conversationId !== opts.conversationId) return;
					clearTimeout(timer);
					unsubscribe();
					resolve(connected.handle);
				});
			});
			return { child, handle };
		},
	};
}
