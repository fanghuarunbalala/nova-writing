/**
 * ConversationManagerServer server 模式接线测试（M3 FR4/FR5）：
 * - conversationLease：acquire 在 spawn 前调用（token 进子进程 env）；失败阻止 spawn；
 *   会话退出（exit）触发 release；createOrResume 重派生同样走 acquire；
 * - serverApprovals：submitApprovalRequest → 征询上 server（runSeq 从 requestId 解析）；
 *   resolveApproval → 决议同步 server（approve/reject）；本地队列行为不受注入影响。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import {
	ConversationManagerServer,
	type ConversationFactory,
	type ConversationProcessSpawner,
	type ConversationManagerServerOptions,
} from "../ConversationManagerServer.js";
import type { Conversation } from "../Conversation.js";
import type { ConversationHandle } from "../../contract/handle/index.js";
import type { ConversationApprovalRequest } from "../../contract/types/index.js";

class FakeChild extends EventEmitter {
	exitCode: number | null = null;
	killed = false;
	kill(): void {
		this.killed = true;
	}
	exitCrashed(): void {
		this.exitCode = 1;
		this.emit("exit", 1, null);
	}
	exitTerminated(): void {
		this.exitCode = 0;
		this.emit("exit", 0, null);
	}
}

interface SpawnRecord {
	opts: Parameters<ConversationProcessSpawner["spawn"]>[0];
	child: FakeChild;
}

function makeFakeSpawner(): { spawner: ConversationProcessSpawner; spawned: SpawnRecord[] } {
	const spawned: SpawnRecord[] = [];
	const spawner: ConversationProcessSpawner = {
		spawn(opts) {
			mkdirSync(opts.storedir, { recursive: true });
			const child = new FakeChild();
			spawned.push({ opts, child });
			return { child: child as unknown as ChildProcess, handle: fakeHandle() };
		},
	};
	return { spawner, spawned };
}

function noopFactory(): ConversationFactory {
	return { create: () => ({}) as unknown as Conversation };
}

function fakeHandle(): ConversationHandle {
	return {
		sendUserMessage: async () => ({ seq: 0, recordedAt: "" }),
		sendUserCommand: async () => ({ seq: 0, recordedAt: "" }),
		sendSystemControl: async () => ({ seq: 0, recordedAt: "" }),
		sendApprovalRequest: async () => ({ kind: "approve" }),
		sendAskingQuestionRequest: async () => "",
		sendExitComposeRequest: async () => {},
		subscribeEvents: async () => {},
		getConversationMode: async () => "review",
		resolveApproval: () => {},
		resolveQuestion: () => {},
		resolveExitCompose: () => {},
		dispose: () => {},
	};
}

function approvalReq(requestId: string, toolName = "write_file"): ConversationApprovalRequest {
	return {
		requestId,
		toolCalls: [{ toolCallId: "tc-1", toolName, args: {} }],
	} as unknown as ConversationApprovalRequest;
}

describe("ConversationManagerServer（server 模式接线）", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "novel-mgr-srv-"));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	describe("conversationLease（FR5）", () => {
		it("acquire 在 spawn 前调用，token 注入子进程 env", async () => {
			const { spawner, spawned } = makeFakeSpawner();
			const acquired: string[] = [];
			const server = new ConversationManagerServer(noopFactory(), spawner, {
				storedirRoot: root,
				conversationLease: {
					acquire: async (id) => {
						acquired.push(id);
						return { NOVEL_LEASE_TOKEN: `lt-${id}` };
					},
					release: async () => {},
				},
			});
			const ref = await server.spawnConversation({ agentType: "novel" });
			expect(acquired).toEqual([ref.conversationId]);
			expect(spawned[0]!.opts.extraEnv).toMatchObject({ NOVEL_LEASE_TOKEN: `lt-${ref.conversationId}` });
		});

		it("acquire 抛错（他端持有 409）→ spawn 中止", async () => {
			const { spawner, spawned } = makeFakeSpawner();
			const server = new ConversationManagerServer(noopFactory(), spawner, {
				storedirRoot: root,
				conversationLease: {
					acquire: async () => {
						throw new Error("会话正被其他设备执行");
					},
					release: async () => {},
				},
			});
			await expect(server.spawnConversation({ agentType: "novel" })).rejects.toThrow("其他设备");
			expect(spawned).toHaveLength(0);
		});

		it("会话退出（exit）→ release 被调用（含崩溃路径）", async () => {
			const { spawner, spawned } = makeFakeSpawner();
			const released: string[] = [];
			const server = new ConversationManagerServer(noopFactory(), spawner, {
				storedirRoot: root,
				conversationLease: {
					acquire: async () => ({}),
					release: async (id) => {
						released.push(id);
					},
				},
			});
			const ref = await server.spawnConversation({ agentType: "novel" });
			spawned[0]!.child.exitCrashed();
			await vi.waitFor(() => expect(released).toEqual([ref.conversationId]));
		});

		it("createOrResume 崩溃重派生同样走 acquire（新 token 生效）", async () => {
			const { spawner, spawned } = makeFakeSpawner();
			let nonce = 0;
			const server = new ConversationManagerServer(noopFactory(), spawner, {
				storedirRoot: root,
				conversationLease: {
					acquire: async () => ({ NOVEL_LEASE_TOKEN: `lt-${++nonce}` }),
					release: async () => {},
				},
			});
			const ref = await server.spawnConversation({ agentType: "novel" });
			spawned[0]!.child.exitCrashed();
			await server.createOrResume(ref.conversationId);
			expect(spawned).toHaveLength(2);
			expect(spawned[1]!.opts.extraEnv).toMatchObject({ NOVEL_LEASE_TOKEN: "lt-2" });
		});

		it("release 抛错不影响退出清理（静默吞）", async () => {
			const { spawner, spawned } = makeFakeSpawner();
			const server = new ConversationManagerServer(noopFactory(), spawner, {
				storedirRoot: root,
				conversationLease: {
					acquire: async () => ({}),
					release: async () => {
						throw new Error("network down");
					},
				},
			});
			const ref = await server.spawnConversation({ agentType: "novel" });
			expect(() => spawned[0]!.child.exitTerminated()).not.toThrow();
			await new Promise((r) => setTimeout(r, 10));
			expect((await server.list())[0]!.status).toBe("stopped");
			expect(ref.conversationId).toBeTruthy();
		});
	});

	describe("serverApprovals（FR4）", () => {
		function makeServerWithApprovals(): {
			server: ConversationManagerServer;
			submitted: Array<{ conversationId: string; requestId: string; runSeq: number; calls: Array<{ name: string }> }>;
			resolved: Array<{ requestId: string; decision: string }>;
			spawned: SpawnRecord[];
		} {
			const { spawner, spawned } = makeFakeSpawner();
			const submitted: Array<{ conversationId: string; requestId: string; runSeq: number; calls: Array<{ name: string }> }> = [];
			const resolved: Array<{ requestId: string; decision: string }> = [];
			const approvals: NonNullable<ConversationManagerServerOptions["serverApprovals"]> = {
				submit: async (input) => {
					submitted.push(input);
				},
				resolve: async (requestId, decision) => {
					resolved.push({ requestId, decision });
				},
			};
			const server = new ConversationManagerServer(noopFactory(), spawner, {
				storedirRoot: root,
				serverApprovals: approvals,
			});
			return { server, submitted, resolved, spawned };
		}

		it("submitApprovalRequest → serverApprovals.submit（runSeq 从 requestId 解析，含工具名）", async () => {
			const { server, submitted } = makeServerWithApprovals();
			const ref = await server.spawnConversation({ agentType: "novel" });
			await server.submitApprovalRequest(ref.conversationId, approvalReq(`approval:${ref.conversationId}:7:b2`, "novel.write"));
			await vi.waitFor(() => expect(submitted).toHaveLength(1));
			expect(submitted[0]).toMatchObject({
				conversationId: ref.conversationId,
				requestId: `approval:${ref.conversationId}:7:b2`,
				runSeq: 7,
			});
			expect(submitted[0]!.calls[0]).toMatchObject({ name: "novel.write" });
			// 本地队列同时入队（UI 可见）
			expect((await server.listApprovals()).some((i) => i.requestId === `approval:${ref.conversationId}:7:b2`)).toBe(true);
		});

		it("submit 上 server 失败静默（本地队列不受影响）", async () => {
			const { spawner } = makeFakeSpawner();
			const server = new ConversationManagerServer(noopFactory(), spawner, {
				storedirRoot: root,
				serverApprovals: {
					submit: async () => {
						throw new Error("server unreachable");
					},
					resolve: async () => {},
				},
			});
			const ref = await server.spawnConversation({ agentType: "novel" });
			await expect(
				server.submitApprovalRequest(ref.conversationId, approvalReq(`approval:${ref.conversationId}:1:b1`)),
			).resolves.toBeUndefined();
			expect((await server.listApprovals())).toHaveLength(1);
		});

		it("resolveApproval → serverApprovals.resolve（approve/reject）", async () => {
			const { server, resolved } = makeServerWithApprovals();
			const ref = await server.spawnConversation({ agentType: "novel" });
			const rid = `approval:${ref.conversationId}:3:b1`;
			await server.submitApprovalRequest(ref.conversationId, approvalReq(rid));
			expect(await server.resolveApproval(rid, { kind: "approve" })).toBe(true);
			await vi.waitFor(() => expect(resolved).toEqual([{ requestId: rid, decision: "approve" }]));
			// 他端经 SSE 批掉（同一入口）→ reject 同步
			const rid2 = `approval:${ref.conversationId}:4:b1`;
			await server.submitApprovalRequest(ref.conversationId, approvalReq(rid2));
			await server.resolveApproval(rid2, { kind: "reject" });
			await vi.waitFor(() =>
				expect(resolved).toEqual([
					{ requestId: rid, decision: "approve" },
					{ requestId: rid2, decision: "reject" },
				]),
			);
		});

		it("无 serverApprovals 注入（本地模式）→ 行为与现状一致", async () => {
			const { spawner } = makeFakeSpawner();
			const server = new ConversationManagerServer(noopFactory(), spawner, { storedirRoot: root });
			const ref = await server.spawnConversation({ agentType: "novel" });
			const rid = `approval:${ref.conversationId}:1:b1`;
			await server.submitApprovalRequest(ref.conversationId, approvalReq(rid));
			expect(await server.resolveApproval(rid, { kind: "approve" })).toBe(true);
			expect((await server.listApprovals()).every((i) => i.status !== "pending")).toBe(true);
		});
	});
});
