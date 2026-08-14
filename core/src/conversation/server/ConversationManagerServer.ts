/**
 * ConversationManagerServer 实现：manager 进程侧（内存版）。
 * 生命周期 + 目录 + 消息调度 + wait 请求路由。进程派生后续接 stdio/kkrpc transport。
 */
import type {
	ConversationId,
	ConversationMessage,
	ConversationApprovalDecision,
	ConversationApprovalRequest,
	ConversationAskingRequest,
	ConversationExitComposeRequest,
	ConversationMode,
	Receipt,
} from "../contract/types/index.js";
import {
	closeSync,
	existsSync,
	openSync,
	readFileSync,
	readSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import type { ChildProcess } from "node:child_process";
import type { Logger } from "../../log/Logger.js";
import { noopLogger } from "../../log/noop.js";
import { isCanonicalNovelWrite } from "../compose/canonicalTools.js";
import type {
	ConversationMeta,
	ConversationRef,
	ConversationStatus,
	ConversationSummary,
} from "../../manager/contract/types.js";
import type { ConversationManagerServer as Contract } from "../../manager/contract/server.js";
import { WaitRequestQueue, type ApprovalQueueItem } from "./WaitRequestQueue.js";
import type { Conversation } from "./Conversation.js";
import type { ConversationHandle } from "../contract/handle/index.js";
import type { ConversationInteraction } from "../contract/interaction/index.js";
import type { WaitingInteractionRequest } from "../contract/interaction/index.js";

/** conversation 操作目标（内存 Conversation / 进程 handle 统一接口） */
type ConversationTarget = ConversationInteraction & WaitingInteractionRequest;

/** conversation 工厂：给定 conversationId + agentType 创建 Conversation（上层装配注入） */
export interface ConversationFactory {
	/**
	 * 创建 conversation
	 * @param opts conversationId + agent 类型
	 * @returns Conversation 实例
	 */
	create(opts: { conversationId: string; agentType: string; parentId?: string }): Conversation;
}

/** 进程派生器：spawn conversation 子进程（manager WS 握手），返回子进程 + handle（连接报到后 resolve） */
export interface ConversationProcessSpawner {
	/**
	 * 派生 conversation 进程
	 * @param opts conversationId + agent 类型 + parentId + storedir（manager 分配，journal 落盘目录）+ workspace
	 * @returns 子进程 + 对端 handle（Promise：子进程经 manager WS register 连回后 resolve）
	 */
	spawn(opts: {
		conversationId: string;
		agentType: string;
		parentId?: string;
		storedir: string;
		workspace?: string;
	}): {
		child: ChildProcess;
		handle: Promise<ConversationHandle>;
	};
}

/** manager 服务端构造选项 */
export interface ConversationManagerServerOptions {
	/**
	 * 会话存储根目录（storedirRoot）。提供时：
	 * - 每个 conversation 分配 storedirRoot/<conversationId>/（journal 落盘目录）；
	 * - 构造时扫描目录种子 catalog（重启恢复）；
	 * - 崩溃后 createOrResume 用同一 storedir 重派生（子进程 journal 重放续跑）。
	 */
	storedirRoot?: string;
	/**
	 * 当前工作区根路径提供器（spawn 时求值，经 env NOVEL_CONVERSATION_WORKSPACE 注入子进程；
	 * 缺省子进程用 "."）。
	 */
	workspaceProvider?: () => string | undefined;
	/** 结构化日志（缺省 noop；审批入队/决议、根 bypass 自动批准等关键链路埋点） */
	logger?: Logger;
}

/** manager 进程侧实现（内存 factory 测试 / 进程 spawn 生产） */
export class ConversationManagerServer implements Contract {
	/** conversationId → Conversation 实例（内存模式） */
	private readonly conversations = new Map<string, Conversation>();
	/** conversationId → 操作目标（内存 Conversation / 进程 handle 统一，均为 ConversationHandle） */
	private readonly handles = new Map<string, ConversationHandle>();
	/** conversationId → 子进程（进程模式） */
	private readonly childProcesses = new Map<string, ChildProcess>();
	/** conversationId → 摘要（目录） */
	private readonly summaries = new Map<string, ConversationSummary>();
	/** 主动终止的会话 id（exit 事件据此区分 crashed / stopped） */
	private readonly terminatedIds = new Set<string>();
	/** wait 请求队列（request/resolve 分离的缓冲层） */
	private readonly waitQueue = new WaitRequestQueue();
	/** 会话存储根目录（undefined = 不落盘目录，storedir 为空串） */
	private readonly storedirRoot?: string;
	/** 当前工作区根路径提供器（spawn 时求值） */
	private readonly workspaceProvider?: () => string | undefined;
	/** id 递增 */
	private seq = 0;
	/** conversation 工厂（内存模式） */
	private readonly factory: ConversationFactory;
	/** 进程派生器（进程模式；缺省用内存 factory） */
	private readonly spawner?: ConversationProcessSpawner;
	/** 结构化日志（审批链路埋点；缺省 noop） */
	private readonly logger: Logger;

	/**
	 * 构造 ManagerServer
	 * @param factory conversation 工厂（内存模式，上层装配注入）
	 * @param spawner 进程派生器（进程模式；缺省用 factory 内存）
	 * @param opts 可选配置（storedirRoot：会话存储根目录，含目录扫描恢复）
	 */
	constructor(
		factory: ConversationFactory,
		spawner?: ConversationProcessSpawner,
		opts?: ConversationManagerServerOptions,
	) {
		this.factory = factory;
		this.spawner = spawner;
		this.storedirRoot = opts?.storedirRoot;
		this.workspaceProvider = opts?.workspaceProvider;
		this.logger = (opts?.logger ?? noopLogger).child({ component: "conversation_manager" });
		if (this.storedirRoot !== undefined) this.scanCatalog();
	}

	/** 会话存储目录（storedirRoot 未提供时为空串；id 全局唯一，目录确定性可重派生复用）。
	 *  二次防御：resolve 后必须仍位于 storedirRoot 内（入口校验之外的兜底） */
	private allocStoredir(conversationId: string): string {
		if (this.storedirRoot === undefined) return "";
		const dir = join(this.storedirRoot, conversationId);
		const rootAbs = resolve(this.storedirRoot);
		const dirAbs = resolve(dir);
		if (dirAbs !== rootAbs && !dirAbs.startsWith(rootAbs + sep)) {
			throw new Error(`非法 conversationId（路径逃逸 storedirRoot）: ${conversationId}`);
		}
		return dir;
	}

	/**
	 * conversationId 合法性校验：拒绝路径穿越/分隔符/Windows 保留字符。
	 * id 来自渲染进程 RPC（不可信输入），直接用于文件路径拼接；自定义 id（如测试用 c1）
	 * 合法，但不得含 / \ 及 : * ? " < > | 等会逃逸 storedirRoot 的字符。
	 */
	private isKnownConversationId(conversationId: string): boolean {
		return (
			conversationId !== "." &&
			conversationId !== ".." &&
			!conversationId.startsWith(".") && // 隐藏目录/相对路径前缀
			!/[\\/:*?"<>|\0]/.test(conversationId)
		);
	}

	/** 扫描 storedirRoot 种子 catalog（重启恢复）：目录名 = conversationId，status:"stopped"，seq 取 conv_<n> 最大值防 id 撞车；
	 *  名字恢复优先级：meta.json 显式名 → journal 首句用户消息（截断）→ conversationId */
	private scanCatalog(): void {
		if (this.storedirRoot === undefined || !existsSync(this.storedirRoot)) return;
		for (const entry of readdirSync(this.storedirRoot, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const conversationId = entry.name;
			this.summaries.set(conversationId, {
				conversationId,
				name: this.readMetaName(conversationId) ?? this.deriveFirstName(conversationId) ?? conversationId,
				storeDir: this.allocStoredir(conversationId),
				status: "stopped",
			});
			const match = /^conv_(\d+)$/.exec(conversationId);
			if (match) this.seq = Math.max(this.seq, Number(match[1]));
		}
	}

	/** 会话 meta 文件路径（storedirRoot 未提供时 undefined → 不落盘） */
	private metaPath(conversationId: string): string | undefined {
		if (this.storedirRoot === undefined) return undefined;
		return join(this.storedirRoot, conversationId, "meta.json");
	}

	/** 读 meta.json 显式名（无文件/损坏/空名 → undefined） */
	private readMetaName(conversationId: string): string | undefined {
		const path = this.metaPath(conversationId);
		if (path === undefined) return undefined;
		try {
			const parsed = JSON.parse(readFileSync(path, "utf8")) as { name?: unknown };
			return typeof parsed.name === "string" && parsed.name.trim() !== "" ? parsed.name : undefined;
		} catch {
			return undefined;
		}
	}

	/** 写 meta.json 显式名（合并保留 mode 等其他字段；落盘失败忽略：内存态仍生效，重启回退首句派生） */
	private writeMetaName(conversationId: string, name: string): void {
		const path = this.metaPath(conversationId);
		if (path === undefined) return;
		try {
			let existing: Record<string, unknown> = {};
			try {
				existing = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
			} catch {
				// 无文件/损坏：从空对象起步
			}
			writeFileSync(path, JSON.stringify({ ...existing, name }), "utf8");
		} catch {
			// 见方法注释
		}
	}

	/** 读 journal.jsonl 首行派生默认名（首条 user 消息，截断 30 字；读不到 → undefined） */
	private deriveFirstName(conversationId: string): string | undefined {
		if (this.storedirRoot === undefined) return undefined;
		const line = readJournalFirstLine(join(this.storedirRoot, conversationId, "journal.jsonl"));
		if (line === undefined) return undefined;
		try {
			const parsed = JSON.parse(line) as {
				run?: { messages?: Array<{ role?: string; content?: unknown }> };
			};
			const messages = parsed.run?.messages;
			if (!Array.isArray(messages)) return undefined;
			const first = messages.find((m) => m.role === "user");
			if (first?.content === undefined) return undefined;
			return truncateConversationName(typeof first.content === "string" ? first.content : String(first.content));
		} catch {
			return undefined;
		}
	}

	/** 挂子进程 exit 监听：主动终止（terminatedIds）→ 清记录置 stopped；异常退出（非零码/信号）标 crashed；exit 0 置 stopped */
	private attachExit(conversationId: ConversationId, child: ChildProcess): void {
		child.once("exit", (code, signal) => {
			const summary = this.summaries.get(conversationId);
			if (this.terminatedIds.has(conversationId)) {
				this.terminatedIds.delete(conversationId);
				if (summary) summary.status = "stopped";
			} else if (summary) {
				summary.status = code === 0 && signal === null ? "stopped" : "crashed";
			}
			// 进程退出：pending wait 条目标记过期（重启补完按超时拒绝处理）
			this.waitQueue.expireConversation(conversationId, new Date().toISOString());
			this.childProcesses.delete(conversationId);
			this.handles.delete(conversationId);
		});
	}

	/** conversation 启动报到（不冲刷显式名：子进程恒报 conversationId，已有名字时保留） */
	async register(meta: ConversationMeta): Promise<void> {
		const existing = this.summaries.get(meta.conversationId);
		const name =
			existing !== undefined &&
			existing.name !== existing.conversationId &&
			meta.name === meta.conversationId
				? existing.name
				: meta.name;
		this.summaries.set(meta.conversationId, {
			conversationId: meta.conversationId,
			name,
			storeDir: meta.storeDir,
			status: "active",
			parentId: meta.parentId,
		});
	}

	/** 心跳上报状态 */
	async heartbeat(conversationId: ConversationId, status: ConversationStatus): Promise<void> {
		const s = this.summaries.get(conversationId);
		if (s) s.status = status;
	}

	/** 终止会话（进程模式 kill 子进程，保留目录；exit 事件置 stopped；pending wait 标记过期） */
	async terminate(conversationId: ConversationId): Promise<void> {
		const child = this.childProcesses.get(conversationId);
		if (child !== undefined) {
			this.terminatedIds.add(conversationId);
			child.kill();
		}
		this.childProcesses.delete(conversationId);
		const conv = this.conversations.get(conversationId);
		conv?.dispose();
		this.conversations.delete(conversationId);
		this.handles.delete(conversationId);
		// pending wait 条目标记过期（重启补完按超时拒绝处理）
		this.waitQueue.expireConversation(conversationId, new Date().toISOString());
		const s = this.summaries.get(conversationId);
		if (s) s.status = "stopped";
	}

	/** 派生 conversation（进程 spawn 优先，缺省内存 factory） */
	async spawnConversation(opts: {
		agentType: string;
		agentVersion?: string;
		extraPrompt?: string;
		parentId?: ConversationId;
	}): Promise<ConversationRef> {
		const conversationId = `conv_${++this.seq}`;
		const storedir = this.allocStoredir(conversationId);
		if (this.spawner) {
			// 进程派生（生产）：manager 分配 storedir，等子进程 manager WS 报到后登记 handle
			const { child, handle: handlePromise } = this.spawner.spawn({
				conversationId,
				agentType: opts.agentType,
				parentId: opts.parentId,
				storedir,
				workspace: this.workspaceProvider?.(),
			});
			this.childProcesses.set(conversationId, child);
			this.summaries.set(conversationId, {
				conversationId,
				name: conversationId,
				storeDir: storedir,
				status: "active",
				parentId: opts.parentId,
			});
			this.attachExit(conversationId, child);
			let handle: ConversationHandle;
			try {
				handle = await handlePromise;
			} catch (err) {
				// 报到超时等失败：回滚登记（子进程已由 spawner kill，目录保留供重试）
				this.childProcesses.delete(conversationId);
				this.summaries.delete(conversationId);
				throw err;
			}
			this.handles.set(conversationId, handle);
			return { conversationId, handle };
		}
		// 内存（测试）
		const conversation = this.factory.create({
			conversationId,
			agentType: opts.agentType,
			parentId: opts.parentId,
		});
		this.conversations.set(conversationId, conversation);
		this.handles.set(conversationId, conversation);
		this.summaries.set(conversationId, {
			conversationId,
			name: conversationId,
			storeDir: storedir,
			status: "active",
			parentId: opts.parentId,
		});
		return { conversationId, handle: conversation };
	}

	/** 列出所有会话摘要 */
	async list(): Promise<ConversationSummary[]> {
		return [...this.summaries.values()];
	}

	/** 创建或恢复会话（spawner 可用时派生/复用子进程，否则内存新建） */
	async createOrResume(conversationId?: ConversationId): Promise<ConversationRef> {
		const id = conversationId ?? `conv_${++this.seq}`;
		if (conversationId !== undefined && !this.isKnownConversationId(conversationId)) {
			throw new Error(`未知 conversationId: ${conversationId}`);
		}
		if (this.spawner) {
			// 进程模式：子进程存活则复用；已死（crashed/未派生）用同一 storedir 重派生，子进程经 journal 重放续跑
			let handle = this.handles.get(id);
			const existingChild = this.childProcesses.get(id);
			if (handle === undefined || existingChild === undefined || existingChild.exitCode !== null) {
				const storedir = this.allocStoredir(id);
				const { child, handle: spawnedPromise } = this.spawner.spawn({
					conversationId: id,
					agentType: "novel",
					storedir,
					workspace: this.workspaceProvider?.(),
				});
				const prevSummary = this.summaries.get(id);
				this.childProcesses.set(id, child);
				// 重派生保留既有 parentId（F6 teammate 冒泡依赖；崩溃重启不得丢）
				const existing = this.summaries.get(id);
				this.summaries.set(id, {
					conversationId: id,
					name: id,
					storeDir: storedir,
					status: "active",
					...(existing?.parentId === undefined ? {} : { parentId: existing.parentId }),
				});
				this.attachExit(id, child);
				try {
					handle = await spawnedPromise;
				} catch (err) {
					// 报到超时等失败：回滚登记（恢复原 summary；目录保留供重试）
					this.childProcesses.delete(id);
					if (prevSummary !== undefined) this.summaries.set(id, prevSummary);
					else this.summaries.delete(id);
					throw err;
				}
				this.handles.set(id, handle);
			}
			return { conversationId: id, handle };
		}
		let conversation = this.conversations.get(id);
		if (!conversation) {
			conversation = this.factory.create({ conversationId: id, agentType: "novel" });
			this.conversations.set(id, conversation);
			this.handles.set(id, conversation);
			this.summaries.set(id, {
				conversationId: id,
				name: id,
				storeDir: this.allocStoredir(id),
				status: "active",
			});
		}
		return { conversationId: id, handle: conversation };
	}

	/** 重命名会话：更新目录摘要 + 写 meta.json 持久化（重启扫描恢复；显式名优先于 journal 首句派生） */
	async rename(conversationId: ConversationId, name: string): Promise<boolean> {
		if (!this.isKnownConversationId(conversationId)) return false;
		const summary = this.summaries.get(conversationId);
		const trimmed = name.trim();
		if (summary === undefined || trimmed === "") return false;
		summary.name = trimmed;
		this.writeMetaName(conversationId, trimmed);
		return true;
	}

	/** 删除会话（kill 子进程 + 删目录；Windows 下刚 kill 的子进程句柄可能短暂占用目录，删除失败忽略） */
	async delete(conversationId: ConversationId): Promise<void> {
		// id 不可信（渲染进程 RPC）：非法 id 直接拒绝，避免 rmSync 逃逸 storedirRoot
		if (!this.isKnownConversationId(conversationId)) return;
		const child = this.childProcesses.get(conversationId);
		if (child !== undefined) {
			this.terminatedIds.add(conversationId);
			child.kill();
		}
		this.childProcesses.delete(conversationId);
		this.conversations.get(conversationId)?.dispose();
		this.conversations.delete(conversationId);
		this.handles.delete(conversationId);
		this.summaries.delete(conversationId);
		this.waitQueue.clearConversation(conversationId);
		if (this.storedirRoot !== undefined) {
			try {
				rmSync(this.allocStoredir(conversationId), { recursive: true, force: true });
			} catch {
				// 目录暂被占用（Windows 子进程句柄），残留目录无副作用，忽略
			}
		}
	}

	/** 转发消息到目标 conversation（按消息类型分派） */
	async sendMessageTo(conversationId: ConversationId, msg: ConversationMessage): Promise<Receipt> {
		const conv = this.require(conversationId);
		if ("text" in msg) return conv.sendUserMessage(msg);
		if ("name" in msg) return conv.sendUserCommand(msg);
		return conv.sendSystemControl(msg);
	}

	/**
	 * 提交审批请求（非阻塞）：入队 + decisioner 派生（parentId → parent 冒泡；否则 ui）。
	 * 根会话（无 parentId）按自身 activeMode 裁决：bypass 模式下整批均为 canonical 写时
	 * 跳过 UI 直接批准（根完全自主决策，F6；先入队再决议——队列保留记录供重启补完查询）。
	 * 批内含非 canonical（如 ExitComposeMode）时不短路，整批走 UI。
	 */
	async submitApprovalRequest(
		conversationId: ConversationId,
		req: ConversationApprovalRequest,
	): Promise<void> {
		const parentId = this.summaries.get(conversationId)?.parentId;
		// 根会话 bypass：整批 canonical 写直接批准（防御纵深——conversation 侧短路通常先命中）
		const allCanonical = req.toolCalls.every((tc) => isCanonicalNovelWrite(tc.toolName));
		if (parentId === undefined && allCanonical) {
			const handle = this.handles.get(conversationId);
			const mode = await this.readConversationMode(handle);
			if (mode === "bypass") {
				this.logger.info("approval.root_bypass_autoapproved", {
					conversationId,
					requestId: req.requestId,
					toolNames: req.toolCalls.map((tc) => tc.toolName),
				});
				this.waitQueue.submit({
					conversationId,
					requestId: req.requestId,
					toolCalls: req.toolCalls.map((tc) => ({
						toolCallId: tc.toolCallId,
						toolName: tc.toolName,
						args: tc.args,
					})),
					decisioner: "ui",
					status: "pending",
					requestedAt: new Date().toISOString(),
				});
				this.waitQueue.resolve(req.requestId, { kind: "approve" }, new Date().toISOString());
				this.pushDecision(conversationId, req.requestId, { kind: "approve" });
				return;
			}
		}
		this.waitQueue.submit({
			conversationId,
			requestId: req.requestId,
			toolCalls: req.toolCalls.map((tc) => ({
				toolCallId: tc.toolCallId,
				toolName: tc.toolName,
				args: tc.args,
			})),
			decisioner: parentId !== undefined ? "parent" : "ui",
			status: "pending",
			requestedAt: new Date().toISOString(),
		});
		this.logger.info("approval.enqueued", {
			conversationId,
			requestId: req.requestId,
			decisioner: parentId !== undefined ? "parent" : "ui",
			toolCallCount: req.toolCalls.length,
		});
	}

	/** 读会话当前生效模式（缺省 review；远程代理失败按 review 保守处理） */
	private async readConversationMode(
		handle: ConversationHandle | undefined,
	): Promise<ConversationMode> {
		if (handle === undefined) return "review";
		try {
			return await Promise.resolve(
				handle.getConversationMode() as unknown as Promise<ConversationMode>,
			);
		} catch {
			return "review";
		}
	}

	/** 驻留直推决策（进程存活则解除 conversation 阻塞；已退出留待重启查询） */
	private pushDecision(
		conversationId: ConversationId,
		requestId: string,
		decision: ConversationApprovalDecision,
	): void {
		const handle = this.handles.get(conversationId);
		if (handle === undefined) return;
		try {
			void Promise.resolve(
				handle.resolveApproval(requestId, decision) as unknown,
			).catch(() => {});
		} catch {
			// 代理同步抛错（通道已关）属预期，忽略
		}
	}

	/** 提交提问请求（非阻塞；路由同审批，UI 展示延后——本期内入队仅登记） */
	async submitAskingRequest(
		_conversationId: ConversationId,
		_req: ConversationAskingRequest,
	): Promise<void> {
		// 提问/退出 compose 与审批同一路由；UI 面板延后，队列登记后续接入
	}

	/** 提交退出 compose 请求（非阻塞；路由同审批） */
	async submitExitComposeRequest(
		_conversationId: ConversationId,
		_req: ConversationExitComposeRequest,
	): Promise<void> {
		// 见 submitAskingRequest
	}

	/** 待 UI 决策的审批列表（decisioner="ui"） */
	async listApprovals(): Promise<readonly ApprovalQueueItem[]> {
		return this.waitQueue.list();
	}

	/** 记录 UI 决策：驻留会话直推 resolveApproval，已退出留待重启查询 */
	async resolveApproval(requestId: string, decision: ConversationApprovalDecision): Promise<boolean> {
		const resolved = this.waitQueue.resolve(requestId, decision, new Date().toISOString());
		if (!resolved) return false;
		this.logger.info("approval.resolved", { requestId, decision: decision.kind });
		// 驻留直推：会话存活则经 handle 调 conversation 的 resolveApproval（阻塞解除）
		const item = this.waitQueue.takeByRequestId(requestId);
		if (item !== undefined) {
			this.pushDecision(item.conversationId, requestId, decision);
		}
		return true;
	}

	/** 子进程重启查询：该会话的待决/已决条目（暂停点续跑） */
	async takeDecisions(conversationId: ConversationId): Promise<readonly ApprovalQueueItem[]> {
		return this.waitQueue.take(conversationId);
	}

	/** 订阅队列变化（main 侧转发 UI 通知） */
	onWaitChange(listener: () => void): () => void {
		return this.waitQueue.onChange(listener);
	}

	/** 取 conversation 操作目标，缺省抛错 */
	private require(id: ConversationId): ConversationTarget {
		const target = this.handles.get(id);
		if (!target) throw new Error(`未找到 conversation: ${id}`);
		return target;
	}
}

/** journal 首行读取上限（首行即首个 run，含完整 user 消息；超限视为损坏） */
const JOURNAL_FIRST_LINE_MAX_BYTES = 256 * 1024;

/**
 * 有界读 journal.jsonl 首行（找到首个 \n 即返回，不整文件读；超上限/打开失败 → undefined）。
 * @param filePath journal 文件路径
 * @returns 首行内容（不含换行）
 */
function readJournalFirstLine(filePath: string): string | undefined {
	let fd: number;
	try {
		fd = openSync(filePath, "r");
	} catch {
		return undefined;
	}
	try {
		const chunks: Buffer[] = [];
		let total = 0;
		const buffer = Buffer.alloc(64 * 1024);
		while (total < JOURNAL_FIRST_LINE_MAX_BYTES) {
			const read = readSync(fd, buffer, 0, buffer.length, total);
			if (read <= 0) break;
			chunks.push(Buffer.from(buffer.subarray(0, read)));
			total += read;
			const joined = Buffer.concat(chunks).toString("utf8");
			const newline = joined.indexOf("\n");
			if (newline >= 0) return joined.slice(0, newline);
		}
		return Buffer.concat(chunks).toString("utf8");
	} catch {
		return undefined;
	} finally {
		try {
			closeSync(fd);
		} catch {
			// 关闭失败忽略
		}
	}
}

/** 会话名截断：折叠空白、上限 30 字 + 省略号（首句派生默认名用） */
function truncateConversationName(text: string): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	if (collapsed === "") return "";
	return collapsed.length > 30 ? `${collapsed.slice(0, 30)}…` : collapsed;
}
