/**
 * ConversationManagerWsServer 集成测试：单连接双工（RPCChannel expose+getAPI）+
 * wait 队列全链路（提交 → 列表 → 决策直推 → 驻留解除）+ 暂停点决策查询。
 */
import { describe, expect, it, afterEach } from "vitest";
import { RPCChannel } from "kkrpc";
import { webSocketClientTransport } from "kkrpc/ws";
import { Conversation } from "../Conversation.js";
import { ConversationManagerServer, type ConversationFactory } from "../ConversationManagerServer.js";
import {
	startConversationManagerWsServer,
	type ConversationManagerWsServerHandle,
	type ConnectedConversation,
} from "../ConversationManagerWsServer.js";
import type { AgentLoop } from "../../../runtime/loop/AgentLoop.js";
import type { OutputEvent } from "../../contract/events/index.js";

function mockLoop(): AgentLoop {
	return {
		run: async () => ({ final: { role: "assistant" as const, content: "ok" }, usage: undefined }),
		followup: () => ({
			seq: 1,
			messages: [{ role: "user", content: "hi" }],
			ts: "t",
			appendTurnMessages: () => {},
		}),
		steer: () => {},
		stop: () => {},
		cancel: () => {},
		onOutputEvent: () => () => {},
	} as unknown as AgentLoop;
}

function conversationFactory(): ConversationFactory {
	return {
		create: (o) =>
			new Conversation({
				conversationId: o.conversationId,
				loop: mockLoop(),
				sampling: { model: "gpt-5" },
			}),
	};
}

const openServers: ConversationManagerWsServerHandle[] = [];

afterEach(async () => {
	await Promise.all(openServers.splice(0).map((s) => s.close()));
});

describe("ConversationManagerWsServer（manager WS 双工 + wait 路由）", () => {
	it("子进程连接 register → onConversationConnected 携带 conversation handle（可跨 WS 调用）", async () => {
		const manager = new ConversationManagerServer(conversationFactory());
		const holder: { manager?: ConversationManagerServer } = {};
		const server = await startConversationManagerWsServer({ manager: () => holder.manager! });
		openServers.push(server);
		holder.manager = manager;

		const connectedPromise = new Promise<ConnectedConversation>((resolve) => {
			const unsubscribe = server.onConversationConnected((connected) => {
				unsubscribe();
				resolve(connected);
			});
		});

		// 假子进程：RPCChannel 双工（expose conversation 面 + getAPI CMS 面）
		const childChannel = new RPCChannel(
			webSocketClientTransport({ url: server.url, protocols: [server.token] }),
			{
				expose: {
					sendUserMessage: async () => ({ seq: 1, recordedAt: "t" }),
					sendUserCommand: async () => ({ seq: 0, recordedAt: "t" }),
					sendSystemControl: async () => ({ seq: 0, recordedAt: "t" }),
					sendApprovalRequest: async () => ({ kind: "reject" }),
					sendAskingQuestionRequest: async () => "",
					sendExitComposeRequest: async () => {},
					subscribeEvents: async () => {},
					getConversationMode: async () => "review",
					resolveApproval: () => {},
					resolveQuestion: () => {},
					resolveExitCompose: () => {},
					dispose: () => {},
				},
			},
		);
		const cms = childChannel.getAPI() as unknown as {
			register(meta: { conversationId: string; name: string; storeDir: string }): Promise<void>;
			submitApproval(id: string, req: unknown): Promise<void>;
			takeDecisions(id: string): Promise<readonly unknown[]>;
		};
		await cms.register({ conversationId: "conv_1", name: "conv_1", storeDir: "" });

		const connected = await connectedPromise;
		expect(connected.conversationId).toBe("conv_1");
		// 跨 WS 调子进程 conversation（CMS → conversation 方向）
		const receipt = await connected.handle.sendUserMessage({ text: "hi" });
		expect(receipt).toMatchObject({ seq: 1 });
		// 子进程 → CMS 方向：提交审批 + 重启查询
		await cms.submitApproval("conv_1", { requestId: "approval_conv_1_1_t1", toolName: "CharacterWrite", args: "{}" });
		expect(await manager.listApprovals()).toHaveLength(1);
		expect(await cms.takeDecisions("conv_1")).toHaveLength(1);
	});

	it("wait 全链路：submit → list（decisioner=ui）→ resolve → 驻留会话解除", async () => {
		const manager = new ConversationManagerServer(conversationFactory());
		const ref = await manager.spawnConversation({ agentType: "novel" });
		const conv = (ref.handle as unknown) as Conversation;

		await manager.submitApprovalRequest(ref.conversationId, {
			requestId: "approval_x_1_t1",
			toolName: "CharacterWrite",
			args: "{}",
		});
		const list = await manager.listApprovals();
		expect(list[0]).toMatchObject({ decisioner: "ui", status: "pending" });

		// 驻留等待 + 决策直推
		const pending = conv.sendApprovalRequest({
			requestId: "approval_x_1_t2",
			toolName: "CharacterWrite",
			args: "{}",
		});
		await manager.submitApprovalRequest(ref.conversationId, {
			requestId: "approval_x_1_t2",
			toolName: "CharacterWrite",
			args: "{}",
		});
		expect(await manager.resolveApproval("approval_x_1_t2", { kind: "approve" })).toBe(true);
		expect(await pending).toEqual({ kind: "approve" });
	});

	it("会话退出标记 pending 过期（重启补完按超时拒绝）", async () => {
		const manager = new ConversationManagerServer(conversationFactory());
		const ref = await manager.spawnConversation({ agentType: "novel" });
		await manager.submitApprovalRequest(ref.conversationId, {
			requestId: "approval_x_1_t1",
			toolName: "CharacterWrite",
			args: "{}",
		});
		await manager.terminate(ref.conversationId);
		const decisions = await manager.takeDecisions(ref.conversationId);
		expect(decisions[0]).toMatchObject({ status: "expired" });
	});

	it("错误 token 拒绝握手", async () => {
		const manager = new ConversationManagerServer(conversationFactory());
		const holder: { manager?: ConversationManagerServer } = {};
		const server = await startConversationManagerWsServer({ manager: () => holder.manager! });
		openServers.push(server);
		holder.manager = manager;
		const channel = new RPCChannel(
			webSocketClientTransport({ url: server.url, protocols: ["wrong"] }),
			{ expose: {} },
		);
		const cms = channel.getAPI() as unknown as { register(m: unknown): Promise<void> };
		await expect(cms.register({})).rejects.toThrow();
		channel.destroy();
	});
});
