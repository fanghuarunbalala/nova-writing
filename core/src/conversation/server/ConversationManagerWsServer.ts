/**
 * ConversationManagerWsServer：conversation 子进程 ↔ CMS 的 manager WS 服务端。
 * 单连接双工（kkrpc RPCChannel：expose CMS 调用面 + getAPI 得 conversation handle）——
 * 替代 stdio 承载全部 manager↔conversation rpc（stdio 仅保留 stderr 日志；fd>2 管道禁用）。
 * 子进程连出（env NOVEL_MANAGER_WS_URL/TOKEN），连接后先 register 报到，再正常交互。
 */
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { RPCChannel } from "kkrpc";
import { webSocketTransport, type WebSocketLike } from "kkrpc/ws";
import type { ConversationManagerServer } from "../../manager/contract/server.js";
import type { ConversationHandle } from "../contract/handle/index.js";
import type { ConversationMeta } from "../../manager/contract/types.js";
import type {
	ConversationApprovalRequest,
	ConversationAskingRequest,
	ConversationExitComposeRequest,
	ConversationId,
} from "../contract/types/index.js";

/** CMS 面（manager WS expose 给子进程调用的方法子集） */
export interface CmsApiView {
	register(meta: ConversationMeta): Promise<void>;
	submitApprovalRequest(id: ConversationId, req: ConversationApprovalRequest): Promise<void>;
	submitAskingRequest(id: ConversationId, req: ConversationAskingRequest): Promise<void>;
	submitExitComposeRequest(id: ConversationId, req: ConversationExitComposeRequest): Promise<void>;
	takeDecisions(id: ConversationId): Promise<readonly unknown[]>;
}

/** manager WS 服务端构造选项 */
export interface ConversationManagerWsServerOptions {
	/**
	 * CMS 面 getter（manager 与服务端互依：服务端先建、manager 后建，
	 * 调用时解引用）
	 */
	manager: () => Pick<
		ConversationManagerServer,
		"register" | "submitApprovalRequest" | "submitAskingRequest" | "submitExitComposeRequest" | "takeDecisions"
	>;
	/** 监听地址（默认 127.0.0.1） */
	host?: string;
	/** 监听端口（默认 0 = 随机） */
	port?: number;
	/** 访问 token（subprotocol 校验；默认随机 UUID） */
	token?: string;
}

/** 已连接的 conversation（CMS 侧持有的远端视图） */
export interface ConnectedConversation {
	conversationId: string;
	/** 远端 conversation（getAPI()；输入转发/决策直推用） */
	handle: ConversationHandle;
	/** 连接关闭通知（等价子进程退出） */
	onClose(listener: () => void): () => void;
}

/** manager WS 服务端句柄 */
export interface ConversationManagerWsServerHandle {
	/** 连接地址（子进程经 env 注入） */
	url: string;
	/** 访问 token */
	token: string;
	/** 新 conversation 连接报到（register 后触发；spawner 等待用） */
	onConversationConnected(listener: (connected: ConnectedConversation) => void): () => void;
	/** 关闭服务端 */
	close(): Promise<void>;
}

/**
 * 启动 manager WS 服务端：子进程连接后 register 报到，CMS 面 expose 给子进程调用，
 * 同一连接的 getAPI 面即 conversation 远端视图。
 * @param options CMS + host/port/token
 * @returns 服务句柄（onConversationConnected 订阅连接报到）
 */
export function startConversationManagerWsServer(
	options: ConversationManagerWsServerOptions,
): Promise<ConversationManagerWsServerHandle> {
	return new Promise((resolve, reject) => {
		const token = options.token ?? randomUUID();
		const wss = new WebSocketServer({
			host: options.host ?? "127.0.0.1",
			port: options.port ?? 0,
			handleProtocols: (protocols) => (protocols.has(token) ? token : false),
		});
		const sockets = new Set<WebSocket>();
		const connectedListeners = new Set<(connected: ConnectedConversation) => void>();

		wss.on("connection", (socket) => {
			if (socket.protocol !== token) {
				socket.close();
				return;
			}
			sockets.add(socket);
			socket.on("close", () => sockets.delete(socket));

			let conversationId: string | undefined;
			const closeListeners = new Set<() => void>();
			const notifyConnected = (): void => {
				if (conversationId === undefined) return;
				const connected: ConnectedConversation = {
					conversationId,
					handle,
					onClose: (listener) => {
						closeListeners.add(listener);
						return () => closeListeners.delete(listener);
					},
				};
				for (const l of connectedListeners) l(connected);
			};
			// 单通道双工：expose CMS 面 + getAPI 得 conversation 面（探针已验证）
			const channel = new RPCChannel(webSocketTransport(socket as WebSocketLike), {
				expose: {
					/** 连接报到（spawner 等待点；后续 heartbeat 沿用） */
					register: async (meta: ConversationMeta) => {
						conversationId = meta.conversationId;
						await options.manager().register(meta);
						notifyConnected();
					},
					/** 审批提交（非阻塞） */
					submitApproval: async (id: ConversationId, req: ConversationApprovalRequest) => {
						await options.manager().submitApprovalRequest(id, req);
					},
					/** 提问提交（非阻塞） */
					submitAsking: async (id: ConversationId, req: ConversationAskingRequest) => {
						await options.manager().submitAskingRequest(id, req);
					},
					/** 退出 compose 提交（非阻塞） */
					submitExitCompose: async (id: ConversationId, req: ConversationExitComposeRequest) => {
						await options.manager().submitExitComposeRequest(id, req);
					},
					/** 重启查询：该会话的待决/已决条目（暂停点续跑） */
					takeDecisions: async (id: ConversationId) => options.manager().takeDecisions(id),
				},
			});
			const handle = channel.getAPI() as unknown as ConversationHandle;
			socket.on("close", () => {
				for (const l of closeListeners) l();
			});
		});
		wss.on("error", reject);
		wss.on("listening", () => {
			const address = wss.address();
			const port = typeof address === "object" && address !== null ? address.port : options.port!;
			resolve({
				url: `ws://${options.host ?? "127.0.0.1"}:${port}`,
				token,
				onConversationConnected: (listener) => {
					connectedListeners.add(listener);
					return () => connectedListeners.delete(listener);
				},
				close: () =>
					new Promise<void>((res, rej) => {
						for (const s of sockets) s.terminate();
						wss.close((err) => (err ? rej(err) : res()));
					}),
			});
		});
	});
}
