/**
 * ApprovalModal
 *
 * 审批整体弹窗（app-redesign-demo v0.8 单栏化）：审批是阻塞的（挂起时不能
 * 发送）→ 弹窗即「必须先决策」。单详情 = ApprovalGroupDetail（滚动区 + 决策
 * 底脚）；多组时头部「上一项/下一项」导航 + 位置指示，「全部批准」批量决策
 * （>1 待决时显示）；「稍后处理」/ESC/遮罩收起（会话仍挂起，由 挂起提示条 /
 * 状态行 / 工具行 唤回）。处理完不在时间线留过往记录。
 */
import { useEffect, useMemo } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, ChevronLeft, ChevronRight, Clock, ShieldCheck, X } from "lucide-react";
import { Button } from "../../../shared/primitives/Button.js";
import { Icon } from "../../../shared/primitives/Icon.js";
import type { ToastKind } from "../../../shared/state/ToastStore.js";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import type {
  ApprovalEntityResolver,
  ApprovalIdNameResolver,
} from "../approvalEntityResolver.js";
import { groupApprovals } from "../approvalGroups.js";
import type { ApprovalModalStore } from "../ApprovalModalStore.js";
import type { ApprovalStore } from "../ApprovalStore.js";
import { ApprovalGroupDetail } from "./ApprovalGroupDetail.js";
import styles from "./ApprovalModal.module.css";

export interface ApprovalModalProps {
  readonly store: ApprovalStore;
  readonly modalStore: ApprovalModalStore;
  /** 会话化：只展示该会话的审批（缺省全量）。 */
  readonly conversationId?: string;
  /** 删除/编辑目标实体内容解析器（宿主注入）。 */
  readonly resolveEntity?: ApprovalEntityResolver;
  /** id → 实体名称映射解析器（宿主注入；id 引用字段与 leaf chips 显示名称）。 */
  readonly resolveIdNames?: ApprovalIdNameResolver;
  readonly onNotify?: (kind: ToastKind, text: string) => void;
}

export function ApprovalModal({
  store,
  modalStore,
  conversationId,
  resolveEntity,
  resolveIdNames,
  onNotify,
}: ApprovalModalProps) {
  const snapshot = useExternalStore(store);
  const modalSnapshot = useExternalStore(modalStore);

  const approvals = useMemo(
    () =>
      conversationId === undefined
        ? snapshot.approvals
        : snapshot.approvals.filter((approval) => approval.conversationId === conversationId),
    [snapshot.approvals, conversationId],
  );
  const groups = useMemo(() => groupApprovals(approvals), [approvals]);
  const pendingGroups = groups.filter((group) => group.status === "pending");

  // 选中组：显式选中 key → 最新待审组 → 首组；key 失效时回写 store 保持一致
  const selected =
    groups.find((group) => group.key === modalSnapshot.selectedKey) ??
    pendingGroups[0] ??
    groups[0];
  useEffect(() => {
    if (selected !== undefined && modalSnapshot.selectedKey !== selected.key) {
      modalStore.select(selected.key);
    }
  }, [selected, modalSnapshot.selectedKey, modalStore]);

  const selectedIndex =
    selected === undefined ? -1 : groups.findIndex((group) => group.key === selected.key);
  const goto = (delta: number): void => {
    if (groups.length === 0) return;
    const next = (selectedIndex + delta + groups.length) % groups.length;
    modalStore.select(groups[next]!.key);
  };

  const approveAll = (): void => {
    for (const group of pendingGroups) {
      for (const approval of group.approvals) {
        if (approval.status === "pending") {
          void store.decide(approval.requestId, "approved");
        }
      }
    }
  };

  const minimize = (): void => {
    modalStore.minimize();
    if (pendingGroups.length > 0) {
      onNotify?.("info", "已稍后处理——顶部提示条 · 状态行 · 工具行均可唤回审批弹窗");
    }
  };

  // 开合交给 radix（open 受控）：closed 时 Presence 播完 sheet-out 再卸载，
  // 退出中重开自动取消——无需自写 closing 定时器（demo .closing 的 radix 等价物）
  return (
    <DialogPrimitive.Root open={modalSnapshot.open} onOpenChange={(open) => { if (!open) minimize(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={styles.overlay} />
        <DialogPrimitive.Content className={styles.modal} aria-describedby={undefined}>
          <div className={styles.head}>
            <span className={styles.headIcon}>
              <Icon icon={ShieldCheck} size="md" />
            </span>
            <DialogPrimitive.Title className={styles.headTitle}>
              审批 · 本轮工具调用
            </DialogPrimitive.Title>
            <span
              className={[styles.count, pendingGroups.length === 0 ? styles.countZero : ""]
                .filter(Boolean)
                .join(" ")}
            >
              {pendingGroups.length === 0 ? "全部处理完" : `${pendingGroups.length} 项待决`}
            </span>
            {groups.length > 1 && (
              <span className={styles.nav}>
                <button
                  type="button"
                  className={styles.navButton}
                  aria-label="上一项"
                  onClick={() => goto(-1)}
                >
                  <Icon icon={ChevronLeft} size="sm" />
                </button>
                <span className={styles.navPos}>
                  {selectedIndex + 1}/{groups.length}
                </span>
                <button
                  type="button"
                  className={styles.navButton}
                  aria-label="下一项"
                  onClick={() => goto(1)}
                >
                  <Icon icon={ChevronRight} size="sm" />
                </button>
              </span>
            )}
            <span className={styles.spacer} />
            {pendingGroups.length > 1 && (
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Icon icon={Check} size="sm" />}
                onClick={approveAll}
              >
                全部批准（{pendingGroups.length}）
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<Icon icon={Clock} size="sm" />}
              onClick={minimize}
            >
              稍后处理
            </Button>
            <DialogPrimitive.Close className={styles.close} aria-label="收起弹窗（稍后处理）">
              <Icon icon={X} size="sm" />
            </DialogPrimitive.Close>
          </div>
          <div className={styles.bodyArea}>
            <section className={styles.detail}>
              {selected === undefined ? (
                <div className={styles.detailEmpty}>暂无审批请求</div>
              ) : (
                <ApprovalGroupDetail
                  key={selected.key}
                  group={selected}
                  store={store}
                  resolveEntity={resolveEntity}
                  resolveIdNames={resolveIdNames}
                />
              )}
            </section>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
