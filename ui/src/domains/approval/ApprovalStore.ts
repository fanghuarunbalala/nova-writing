/**
 * ApprovalStore
 *
 * 审批面板数据源（shell 级 ExternalStore）：数据唯一权威是 CMS wait 队列。
 * refresh() 经 api.approvals.list() 拉取；decide() 经 api.approvals.resolve()
 * 提交（CMS 记录并直推驻留 conversation）。变化通知经 approvalChangeBus 触发重拉。
 */
import type { ApprovalQueueItem, ConversationApprovalDecision, NovelApiClient } from "@novel/core";
import { ExternalStore } from "../../shared/state/ExternalStore.js";

export type ApprovalDecision = "approved" | "rejected";

export interface ApprovalStoreSnapshot {
  readonly approvals: readonly ApprovalQueueItem[];
  readonly pendingCount: number;
  readonly selectedId?: string;
}

const EMPTY: ApprovalStoreSnapshot = Object.freeze({
  approvals: Object.freeze([]),
  pendingCount: 0,
});

export class ApprovalStore extends ExternalStore<ApprovalStoreSnapshot> {
  private readonly api: NovelApiClient;

  /**
   * @param deps api（approvals.list/resolve）
   */
  constructor(deps: { readonly api: NovelApiClient }) {
    super(EMPTY);
    this.api = deps.api;
  }

  /** 从 CMS 拉取审批队列（变化通知触发） */
  async refresh(): Promise<void> {
    try {
      const approvals = await this.api.approvals.list();
      const pendingCount = approvals.filter((item) => item.status === "pending").length;
      this.setSnapshot({
        approvals: Object.freeze(approvals),
        pendingCount,
        ...(this.snapshot.selectedId === undefined
          ? {}
          : { selectedId: this.snapshot.selectedId }),
      });
    } catch {
      // 拉取失败保持现状（面板显示旧数据，下次通知重试）
    }
  }

  select(requestId: string): void {
    this.setSnapshot({ ...this.snapshot, selectedId: requestId });
  }

  /**
   * 提交审批决策（CMS 记录 + 直推 conversation；随后重拉刷新）
   * @param requestId 请求 id
   * @param decision 决策（approved/rejected；edited 走 decideEdited）
   */
  decide(requestId: string, decision: ApprovalDecision): Promise<unknown> {
    const core: ConversationApprovalDecision =
      decision === "approved" ? { kind: "approve" } : { kind: "reject" };
    return this.api.approvals.resolve(requestId, core).then((hit) => {
      if (hit) void this.refresh();
      return hit;
    });
  }

  /**
   * 提交「请求修改」决策（意见文本随决策回传 conversation）
   * @param requestId 请求 id
   * @param text 修改意见
   */
  decideEdited(requestId: string, text: string): Promise<unknown> {
    return this.api.approvals.resolve(requestId, { kind: "edit", text }).then((hit) => {
      if (hit) void this.refresh();
      return hit;
    });
  }
}
