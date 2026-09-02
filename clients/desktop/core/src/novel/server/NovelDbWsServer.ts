/**
 * novel-db WebSocket RPC 服务端（协议定稿 transport：conversation ↔ novel-db 走 kkrpc/ws + token）。
 * 承载 query/mutate 请求-响应（普通 rpc，非流式）；novel.changed 走 ZeroMQ PUB/SUB，不经此通道。
 * 禁止用附加 fd 管道承载本通道（Windows 下 fd>2 pipe 写方向会失效，见 CLAUDE.md transport 约束）。
 */
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { expose } from "kkrpc";
import { webSocketTransport, type WebSocketLike } from "kkrpc/ws";
import type { NovelStore } from "../store.js";
import type { NovelQuery } from "../contract/query.js";
import type { NovelMutation } from "../contract/mutation.js";

/** novel-db WS 服务端构造选项 */
export interface NovelDbWsServerOptions {
	/** novel 存储（canonical store） */
	store: NovelStore;
	/** 监听地址（默认 127.0.0.1，仅本机） */
	host?: string;
	/** 监听端口（默认 0 = 随机） */
	port?: number;
	/** 访问 token（经 WebSocket subprotocol 传递；默认随机 UUID） */
	token?: string;
}

/** novel-db WS 服务端句柄 */
export interface NovelDbWsServerHandle {
	/** 连接地址（ws://host:port；子进程经 env 注入） */
	url: string;
	/** 访问 token（子进程经 env 注入） */
	token: string;
	/** 关闭服务端（断开全部连接） */
	close(): Promise<void>;
}

/**
 * 启动 novel-db WebSocket RPC 服务端：expose { query, mutate } 给 conversation 子进程。
 * token 经 WebSocket subprotocol 校验（不进 URL，避免日志泄漏；握手不符直接拒绝）。
 * @param options store + 可选 host/port/token
 * @returns 服务句柄（url + token + close）
 */
export function startNovelDbWsServer(options: NovelDbWsServerOptions): Promise<NovelDbWsServerHandle> {
	return new Promise((resolve, reject) => {
		const token = options.token ?? randomUUID();
		const wss = new WebSocketServer({
			host: options.host ?? "127.0.0.1",
			port: options.port ?? 0,
			handleProtocols: (protocols) => (protocols.has(token) ? token : false),
		});
		const sockets = new Set<WebSocket>();
		wss.on("connection", (socket) => {
			// 双保险：handleProtocols 拒绝之外再校验一次（防绕过）
			if (socket.protocol !== token) {
				socket.close();
				return;
			}
			sockets.add(socket);
			socket.on("close", () => sockets.delete(socket));
			expose(
				{
					query: (q: NovelQuery) => options.store.query(q),
					mutate: (m: NovelMutation) => options.store.mutate(m),
					mutateBatch: (ms: readonly NovelMutation[]) => options.store.mutateBatch(ms),
				},
				webSocketTransport(socket as WebSocketLike),
			);
		});
		wss.on("error", reject);
		wss.on("listening", () => {
			const address = wss.address();
			const port = typeof address === "object" && address !== null ? address.port : options.port!;
			resolve({
				url: `ws://${options.host ?? "127.0.0.1"}:${port}`,
				token,
				close: () =>
					new Promise<void>((res, rej) => {
						for (const s of sockets) s.terminate();
						wss.close((err) => (err ? rej(err) : res()));
					}),
			});
		});
	});
}
