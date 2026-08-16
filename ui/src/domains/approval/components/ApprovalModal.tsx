/**
 * ApprovalModal
 *
 * 审批整体弹窗（demo 方案 A / app-redesign-demo v0.8）：审批是阻塞的
 * （挂起时不能发送）→ 弹窗即「必须先决策」。左清单 = 审批组列表
 * （一组 = 一次请求及其重试，最新在前），右详情 = ApprovalGroupDetail；
 * 底部「全部批准」批量决策；「稍后处理」/ESC/遮罩收起（会话仍挂起，
 * 由 挂起提示条 / 状态行 / 工具行 唤回）。处理完不在时间线留过往记录。
 */
import { useEffect, useMemo } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, Clock, ShieldCheck, X } from "lucide-react";
import { Button } from "../../../shared/primitives/Button.js";
import { Icon } from "../../../shared/primitives/Icon.js";
import type { ToastKind } from "../../../shared/state/ToastStore.js";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import type { ApprovalEntityResolver } from "../approvalEntityResolver.js";
import {
  APPROVAL_STATUS_LABEL,
  groupApprovals,
  isExitComposeGroup,
  type ApprovalGroup,
} from "../approvalGroups.js";
import { inferOperation, operationGlyph } from "../paramLabels.js";
import type { ApprovalModalStore } from "../ApprovalModalStore.js";
import type { ApprovalStore } from "../ApprovalStore.js";
import { ApprovalGroupDetail } from "./ApprovalGroupDetail.js";
import styles from "./ApprovalModal.module.css";

/** 清单项 diff 符号 class（exit 组固定 » 强调色）。 */
function itemGlyphClass(group: ApprovalGroup): string | undefined {
  if (isExitComposeGroup(group)) return styles.itemGlyphExit;
  const op = inferOperation(group.approvals[0]?.toolCalls[0]?.toolName ?? "");
  return op === "add"
    ? styles.itemGlyphAdd
    : op === "edit"
      ? styles.itemGlyphEdit
      : op === "delete"
        ? styles.itemGlyphDel
        : "";
}

function itemGlyphText(group: ApprovalGroup): string {
  if (isExitComposeGroup(group)) return "»";
  const op = inferOperation(group.approvals[0]?.toolCalls[0]?.toolName ?? "");
  return operationGlyph(op ?? "") ?? "";
}

function itemPillClass(status: string): string | undefined {
  switch (status) {
    case "pending":
      return styles.itemPillPending;
    case "approved":
      return styles.itemPillApproved;
    case "edited":
      return styles.itemPillEdited;
    default:
      return styles.itemPillRejected;
  }
}

export interface ApprovalModalProps {
  readonly store: ApprovalStore;
  readonly modalStore: ApprovalModalStore;
  /** 会话化：只展示该会话的审批（缺省全量）。 */
  readonly conversationId?: string;
  /** 删除/编辑目标实体内容解析器（宿主注入）。 */
  readonly resolveEntity?: ApprovalEntityResolver;
  readonly onNotify?: (kind: ToastKind, text: string) => void;
}

export function ApprovalModal({
  store,
  modalStore,
  conversationId,
  resolveEntity,
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

  if (!modalSnapshot.open) return null;

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) minimize(); }}>
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
            <span className={styles.spacer} />
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
            <aside className={styles.list} aria-label="审批清单">
              <div className={styles.listScroll}>
                {groups.length === 0 ? (
                  <div className={styles.listEmpty}>暂无审批请求</div>
                ) : (
                  groups.map((group) => (
                    <button
                      type="button"
                      key={group.key}
                      className={[
                        styles.listItem,
                        selected?.key === group.key ? styles.listItemActive : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => modalStore.select(group.key)}
                    >
                      <span
                        className={[styles.itemGlyph, itemGlyphClass(group)].filter(Boolean).join(" ")}
                      >
                        {itemGlyphText(group)}
                      </span>
                      <span className={styles.itemText}>
                        <span className={styles.itemTitle}>{group.title}</span>
                        <span className={styles.itemMeta}>
                          {group.approvals
                            .flatMap((approval) =>
                              approval.toolCalls.map((tc) => tc.toolName.split(/(?=[A-Z])/).pop() ?? tc.toolName),
                            )
                            .join(" · ")}
                        </span>
                      </span>
                      <span className={[styles.itemPill, itemPillClass(group.status)].join(" ")}>
                        {APPROVAL_STATUS_LABEL[group.status]}
                      </span>
                    </button>
                  ))
                )}
              </div>
              <div className={styles.listFoot}>
                <Button
                  variant="secondary"
                  size="sm"
                  className={styles.listFootButton}
                  disabled={pendingGroups.length === 0}
                  leadingIcon={<Icon icon={Check} size="sm" />}
                  onClick={approveAll}
                >
                  全部批准（{pendingGroups.length}）
                </Button>
              </div>
            </aside>
            <section className={styles.detail}>
              {selected === undefined ? (
                <div className={styles.detailEmpty}>暂无审批请求</div>
              ) : (
                <ApprovalGroupDetail
                  key={selected.key}
                  group={selected}
                  store={store}
                  resolveEntity={resolveEntity}
                />
              )}
            </section>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
