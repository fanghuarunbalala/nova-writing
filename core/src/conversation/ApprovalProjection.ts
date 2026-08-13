/**
 * ApprovalProjection：把审批事件（approval.request / approval.resolved）投影成审批视图。
 * 供 UI 审批面板消费（pending / resolved 列表）。
 */

import type { OutputEvent } from "./contract/events/index.js";

/** 审批状态 */
export type ApprovalStatus = "pending" | "approved" | "rejected" | "edited";

/** 审批视图 */
export interface ApprovalView {
	/** 审批请求 id */
	requestId: string;
	/** 会话 id（面板分组目录键） */
	conversationId: string;
	/** 工具名 */
	toolName: string;
	/** 参数 */
	args: string;
	/** 状态 */
	status: ApprovalStatus;
	/** 请求时间（approval.request 事件 ts） */
	requestedAt: string;
	/** 决策时间（approval.resolved 事件 ts） */
	resolvedAt?: string;
}

/** 审批事件 → 审批视图投影器 */
export class ApprovalProjection {
	private readonly approvals = new Map<string, ApprovalView>();

	/**
	 * 应用一条 OutputEvent（approval.request / approval.resolved）
	 * @param event 输出事件
	 */
	apply(event: OutputEvent): void {
		if (event.type === "approval.request") {
			this.approvals.set(event.requestId, {
				requestId: event.requestId,
				conversationId: event.conversationId,
				toolName: event.toolName,
				args: event.args,
				status: "pending",
				requestedAt: event.ts,
			});
		} else if (event.type === "approval.resolved") {
			const approval = this.approvals.get(event.requestId);
			if (approval) {
				this.approvals.set(event.requestId, {
					...approval,
					status: event.decision,
					resolvedAt: event.ts,
				});
			}
		}
	}

	/** 待决审批 */
	getPending(): readonly ApprovalView[] {
		return [...this.approvals.values()].filter((a) => a.status === "pending");
	}

	/** 全部审批 */
	getAll(): readonly ApprovalView[] {
		return [...this.approvals.values()];
	}
}
