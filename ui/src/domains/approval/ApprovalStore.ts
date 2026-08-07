/**
 * ApprovalStore
 *
 * 审批面板数据源（shell 级 ExternalStore）：从对话投影的 ToolApprovalProjection
 * 派生待审/已决列表，并持有决策回调（由 ChatSurface 注入，走
 * ApprovalDecisionInputEvent enqueue）。InspectorHost 订阅渲染。
 *
 * Approval-panel data source: derives pending/resolved tool-approval lists from
 * the conversation projection and holds a decision callback (injected by
 * ChatSurface, sent via ApprovalDecisionInputEvent enqueue).
 */
import type { ToolApprovalProjection } from "@novel/core";
import { ExternalStore } from "../../shared/state/ExternalStore.js";

export type ApprovalDecision = "approved" | "rejected";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired";

export interface ApprovalView {
  readonly approvalRequestId: string;
  /** 所属 turn（同轮审批可合并展示）。Owning turn for per-turn grouping. */
  readonly turnId?: string;
  readonly toolName: string;
  readonly title: string;
  readonly description?: string;
  /** 每目标一行的操作摘要。Per-target operation rows. */
  readonly operations?: ToolApprovalProjection["operations"];
  /** 完整工具参数（仅 pending 保留）。Full tool arguments while pending. */
  readonly arguments?: ToolApprovalProjection["arguments"];
  readonly argumentDigest: `sha256:${string}`;
  readonly status: ApprovalStatus;
  readonly requestedAt: string;
  readonly resolvedAt?: string;
  readonly actorId?: string;
}

export interface ApprovalStoreSnapshot {
  readonly approvals: readonly ApprovalView[];
  readonly pendingCount: number;
  readonly selectedId?: string;
}

export type ApprovalDecisionHandler = (
  approvalRequestId: string,
  decision: ApprovalDecision,
  argumentDigest: `sha256:${string}`,
) => Promise<unknown> | void;

const EMPTY: ApprovalStoreSnapshot = Object.freeze({
  approvals: Object.freeze([]),
  pendingCount: 0,
});

export class ApprovalStore extends ExternalStore<ApprovalStoreSnapshot> {
  private decisionHandler?: ApprovalDecisionHandler;

  constructor() {
    super(EMPTY);
  }

  /** 由 ChatSurface 同步对话投影里的工具审批列表。 */
  setApprovals(approvals: readonly ApprovalView[]): void {
    const pendingCount = approvals.filter(
      (approval) => approval.status === "pending",
    ).length;
    this.setSnapshot({
      approvals: Object.freeze(approvals),
      pendingCount,
      ...(this.snapshot.selectedId === undefined
        ? {}
        : { selectedId: this.snapshot.selectedId }),
    });
  }

  /** 由 ChatSurface 注入决策回调（binding enqueue ApprovalDecisionInputEvent）。 */
  setDecisionHandler(handler: ApprovalDecisionHandler | undefined): void {
    this.decisionHandler = handler;
  }

  select(approvalRequestId: string): void {
    this.setSnapshot({ ...this.snapshot, selectedId: approvalRequestId });
  }

  /** 发起审批决策；无对应审批或未注入回调时无操作。 */
  decide(
    approvalRequestId: string,
    decision: ApprovalDecision,
  ): Promise<unknown> | void | undefined {
    const approval = this.snapshot.approvals.find(
      (item) => item.approvalRequestId === approvalRequestId,
    );
    if (approval === undefined || this.decisionHandler === undefined) {
      return undefined;
    }
    return this.decisionHandler(
      approvalRequestId,
      decision,
      approval.argumentDigest,
    );
  }
}

export function toApprovalView(
  projection: ToolApprovalProjection,
): ApprovalView {
  return Object.freeze({
    approvalRequestId: projection.approvalRequestId,
    ...(projection.turnId === undefined
      ? {}
      : { turnId: projection.turnId }),
    toolName: projection.toolName,
    title: projection.title,
    ...(projection.description === undefined
      ? {}
      : { description: projection.description }),
    ...(projection.operations === undefined
      ? {}
      : { operations: projection.operations }),
    ...(projection.arguments === undefined
      ? {}
      : { arguments: projection.arguments }),
    argumentDigest: projection.argumentDigest,
    status: projection.status as ApprovalStatus,
    requestedAt: projection.requestedAt,
    ...(projection.resolvedAt === undefined
      ? {}
      : { resolvedAt: projection.resolvedAt }),
    ...(projection.actorId === undefined ? {} : { actorId: projection.actorId }),
  });
}

export function mapApprovalViews(
  projections: readonly ToolApprovalProjection[],
): readonly ApprovalView[] {
  return Object.freeze(projections.map(toApprovalView));
}
