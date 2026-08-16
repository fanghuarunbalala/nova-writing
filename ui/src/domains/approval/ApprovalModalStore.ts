/**
 * ApprovalModalStore
 *
 * 审批整体弹窗的开关与选中态（shell 级 ExternalStore）。
 * 审批是阻塞的（挂起时不能发送）→ 弹窗即「必须先决策」；
 * 「稍后处理」= minimize（会话仍挂起，由 挂起提示条 / 状态行 / 工具行 唤回）。
 */
import { ExternalStore } from "../../shared/state/ExternalStore.js";

export interface ApprovalModalSnapshot {
  readonly open: boolean;
  /** 选中的审批组 key（`${conversationId}:${requestId}`）；缺省取最新待审组。 */
  readonly selectedKey?: string;
}

const CLOSED: ApprovalModalSnapshot = Object.freeze({ open: false });

export class ApprovalModalStore extends ExternalStore<ApprovalModalSnapshot> {
  constructor() {
    super(CLOSED);
  }

  /** 唤起弹窗（可带选中组 key：时间线系统行/自动弹窗定位到具体请求）。 */
  summon(selectedKey?: string): void {
    this.setSnapshot({ open: true, ...(selectedKey === undefined ? {} : { selectedKey }) });
  }

  /** 稍后处理：收起弹窗（不清选中态，再次唤起回到原组）。 */
  minimize(): void {
    this.setSnapshot({ ...this.snapshot, open: false });
  }

  /** 选中清单中的某组（弹窗保持开合状态不变）。 */
  select(key: string): void {
    this.setSnapshot({ ...this.snapshot, selectedKey: key });
  }
}
