/**
 * ApprovalStore
 *
 * 审批面板数据源（shell 级 ExternalStore）：持有审批视图（core ApprovalProjection 派生）
 * 与决策回调。决策经 conversation 的审批应答回传。
 */
import type { ApprovalView } from "@novel/core";
import { ExternalStore } from "../../shared/state/ExternalStore.js";

export type ApprovalDecision = "approved" | "rejected";

export interface ApprovalStoreSnapshot {
  readonly approvals: readonly ApprovalView[];
  readonly pendingCount: number;
  readonly selectedId?: string;
}

export type ApprovalDecisionHandler = (
  requestId: string,
  decision: ApprovalDecision,
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

  /** 同步审批视图列表（由投影订阅驱动）。 */
  setApprovals(approvals: readonly ApprovalView[]): void {
    const pendingCount = approvals.filter((approval) => approval.status === "pending").length;
    this.setSnapshot({
      approvals: Object.freeze(approvals),
      pendingCount,
      ...(this.snapshot.selectedId === undefined
        ? {}
        : { selectedId: this.snapshot.selectedId }),
    });
  }

  /** 注入决策回调（投递审批决策）。 */
  setDecisionHandler(handler: ApprovalDecisionHandler | undefined): void {
    this.decisionHandler = handler;
  }

  select(requestId: string): void {
    this.setSnapshot({ ...this.snapshot, selectedId: requestId });
  }

  /** 发起审批决策；无对应审批或未注入回调时无操作。 */
  decide(requestId: string, decision: ApprovalDecision): Promise<unknown> | void | undefined {
    const approval = this.snapshot.approvals.find((item) => item.requestId === requestId);
    if (approval === undefined || this.decisionHandler === undefined) return undefined;
    return this.decisionHandler(requestId, decision);
  }
}
