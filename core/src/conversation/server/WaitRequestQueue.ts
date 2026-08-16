/**
 * WaitRequestQueue：CMS 的 wait 请求队列（缓冲层）。
 * request 与 resolve 分离：conversation 非阻塞提交 → UI 拉取 → resolve 记录决策；
 * 决策经 conversation 的 resolveApproval rpc 回传（驻留直推）或留待重启查询（take）。
 * decisioner 按会话 parentId 派生：teammate → parent（本期接口预留）、root → ui。
 */
import type {
	AskQuestionAnswer,
	AskQuestionSpec,
	ConversationApprovalDecision,
	ConversationId,
} from "../contract/types/index.js";

/** 审批队列条目状态 */
export type ApprovalQueueStatus = "pending" | "approved" | "rejected" | "edited" | "expired";

/** 决策者：ui（root conversation）/ parent（teammate 冒泡） */
export type ApprovalDecisioner = "ui" | "parent";

/** 审批队列条目中的待审工具调用（一批 = 同一次模型返回的全部待审调用） */
export interface ApprovalToolCall {
	/** 工具调用 id（恢复时按此匹配暂停点） */
	toolCallId: string;
	/** 工具名 */
	toolName: string;
	/** 工具参数（JSON 字符串） */
	args: string;
}

/** 审批队列条目 */
export interface ApprovalQueueItem {
	/** 发起会话 */
	conversationId: ConversationId;
	/** 审批请求 id（approval:{conversationId}:{runSeq}:b{batchSeq}） */
	requestId: string;
	/** 待审批的工具调用（≥1 项；决策作用于整批） */
	toolCalls: readonly ApprovalToolCall[];
	/** 决策者 */
	decisioner: ApprovalDecisioner;
	/** 状态 */
	status: ApprovalQueueStatus;
	/** edit 决策的意见文本 */
	decisionText?: string;
	/** 提交时间 */
	requestedAt: string;
	/** 决策时间 */
	resolvedAt?: string;
}

/** 提问队列条目状态 */
export type AskingQueueStatus = "pending" | "answered" | "skipped" | "expired";

/** 提问队列条目（AskUserQuestion 工具发起，经 CMS 路由到 UI 作答） */
export interface AskingQueueItem {
	/** 发起会话 */
	conversationId: ConversationId;
	/** 提问请求 id（ask:{conversationId}:{短码}） */
	requestId: string;
	/** 问题列表（1-4 个，选择题/开放题混排） */
	questions: readonly AskQuestionSpec[];
	/** 决策者（与审批同款派生：root → ui；teammate → parent） */
	decisioner: ApprovalDecisioner;
	/** 状态 */
	status: AskingQueueStatus;
	/** 决议时的逐问回答 */
	answers?: readonly AskQuestionAnswer[];
	/** 提交时间 */
	requestedAt: string;
	/** 决议时间 */
	resolvedAt?: string;
}

/** 队列变化回调（CMS 侧注册：转发 UI 的 onApprovalsChanged 等） */
export type WaitQueueChangeListener = () => void;

/**
 * wait 请求队列：提交（非阻塞）/ 列表 / 决策记录 / 重启查询 / 过期标记。
 * 审批与提问共用一个队列（条目经形状区分：toolCalls = 审批，questions = 提问）。
 * 内存实现（Electron 主进程生命周期内有效；跨重启持久化延后）。
 */
export class WaitRequestQueue {
	private readonly items = new Map<string, ApprovalQueueItem | AskingQueueItem>();
	private readonly listeners = new Set<WaitQueueChangeListener>();

	/**
	 * 提交审批请求（入队 + 通知变化；幂等：同 requestId 重复提交忽略）
	 * @param item 队列条目（status=pending）
	 */
	submit(item: ApprovalQueueItem): void {
		if (this.items.has(item.requestId)) return;
		this.items.set(item.requestId, { ...item, status: "pending" });
		this.notifyChange();
	}

	/**
	 * 提交提问请求（入队 + 通知变化；幂等：同 requestId 重复提交忽略）
	 * @param item 队列条目（status=pending）
	 */
	submitAsking(item: AskingQueueItem): void {
		if (this.items.has(item.requestId)) return;
		this.items.set(item.requestId, { ...item, status: "pending" });
		this.notifyChange();
	}

	/**
	 * 待 UI 决策的审批列表（decisioner="ui"，按提交时间倒序）
	 * @returns 队列条目（含已决近期条目，供面板展示历史）
	 */
	list(): readonly ApprovalQueueItem[] {
		return [...this.items.values()]
			.filter((item): item is ApprovalQueueItem => "toolCalls" in item)
			.filter((item) => item.decisioner === "ui")
			.sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
	}

	/**
	 * 待 UI 作答的提问列表（decisioner="ui"，按提交时间倒序）
	 * @returns 队列条目（含已答近期条目，供卡片展示历史）
	 */
	listAskings(): readonly AskingQueueItem[] {
		return [...this.items.values()]
			.filter((item): item is AskingQueueItem => "questions" in item)
			.filter((item) => item.decisioner === "ui")
			.sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
	}

	/**
	 * 记录 UI 决策
	 * @param requestId 请求 id
	 * @param decision 决策（approve/reject/edit）
	 * @returns 是否命中待决条目
	 */
	resolve(
		requestId: string,
		decision: ConversationApprovalDecision,
		resolvedAt: string,
	): boolean {
		const item = this.items.get(requestId);
		if (item === undefined || !("toolCalls" in item) || item.status !== "pending") return false;
		this.items.set(requestId, {
			...item,
			status: decision.kind === "approve" ? "approved" : decision.kind === "reject" ? "rejected" : "edited",
			...(decision.kind === "edit" ? { decisionText: decision.text } : {}),
			resolvedAt,
		});
		this.notifyChange();
		return true;
	}

	/**
	 * 记录 UI 提问回答
	 * @param requestId 请求 id
	 * @param answers 逐问回答（全 skipped 状态记 skipped，否则 answered）
	 * @returns 是否命中待决条目
	 */
	resolveAsking(
		requestId: string,
		answers: readonly AskQuestionAnswer[],
		resolvedAt: string,
	): boolean {
		const item = this.items.get(requestId);
		if (item === undefined || !("questions" in item) || item.status !== "pending") return false;
		this.items.set(requestId, {
			...item,
			status: answers.every((a) => a.skipped === true) ? "skipped" : "answered",
			answers,
			resolvedAt,
		});
		this.notifyChange();
		return true;
	}

	/**
	 * 标记超时过期（120s 无决策；重启补完按超时拒绝处理）
	 * @param requestId 请求 id
	 */
	expire(requestId: string, resolvedAt: string): void {
		const item = this.items.get(requestId);
		if (item === undefined || item.status !== "pending") return;
		this.items.set(requestId, { ...item, status: "expired", resolvedAt });
		this.notifyChange();
	}

	/**
	 * 子进程重启查询：该会话的待决/已决审批条目（按条目 toolCalls 成员 toolCallId 匹配暂停点）
	 * @param conversationId 会话 id
	 * @returns 条目列表
	 */
	take(conversationId: ConversationId): readonly ApprovalQueueItem[] {
		return [...this.items.values()]
			.filter((item): item is ApprovalQueueItem => "toolCalls" in item)
			.filter((item) => item.conversationId === conversationId);
	}

	/**
	 * 按 requestId 取条目（决策/回答直推定位会话用）
	 * @param requestId 请求 id
	 * @returns 队列条目（未命中 undefined）
	 */
	takeByRequestId(requestId: string): ApprovalQueueItem | AskingQueueItem | undefined {
		return this.items.get(requestId);
	}

	/**
	 * 会话删除时清理其条目
	 * @param conversationId 会话 id
	 */
	clearConversation(conversationId: ConversationId): void {
		for (const [id, item] of this.items) {
			if (item.conversationId === conversationId) this.items.delete(id);
		}
	}

	/**
	 * 会话进程退出时标记其 pending 条目过期（重启补完按「审批超时，按拒绝处理」）
	 * @param conversationId 会话 id
	 * @param resolvedAt 过期时间
	 */
	expireConversation(conversationId: ConversationId, resolvedAt: string): void {
		let changed = false;
		for (const [id, item] of this.items) {
			if (item.conversationId === conversationId && item.status === "pending") {
				this.items.set(id, { ...item, status: "expired", resolvedAt });
				changed = true;
			}
		}
		if (changed) this.notifyChange();
	}

	/** 订阅队列变化（CMS → UI 通知转发用） */
	onChange(listener: WaitQueueChangeListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notifyChange(): void {
		for (const listener of [...this.listeners]) {
			try {
				listener();
			} catch {
				// 通知失败不影响队列
			}
		}
	}
}
