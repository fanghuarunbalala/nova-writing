/**
 * ApprovalModal
 *
 * 审批整体弹窗（demo 方案 A / app-redesign-demo v0.8）：审批是阻塞的
 * （挂起时不能发送）→ 弹窗即「必须先决策」。左清单 = 审批组列表
 * （一组 = 一次请求及其重试，最新在前），右详情 = ApprovalGroupDetail；
 * 底部「全部批准」批量决策；「稍后处理」/ESC/遮罩收起（会话仍挂起，
 * 由 挂起提示条 / 状态行 / 工具行 唤回）。处理完不在时间线留过往记录。
 */
import { useEffect, useMemo, useRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, Clock, ShieldCheck, X } from "lucide-react";
import { Button } from "../../../shared/primitives/Button.js";
import { Icon } from "../../../shared/primitives/Icon.js";
import type { ToastKind } from "../../../shared/state/ToastStore.js";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import type {
  ApprovalEntityResolver,
  ApprovalIdNameResolver,
} from "../approvalEntityResolver.js";
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

/**
 * 渲染期 diff：与上一帧相比刚决策（pending → 已决）或新增（非首帧）的组 key。
 * 首帧（prev 为空）全部不脉冲——弹窗打开不能整列闪；条目按 key 持久 DOM，
 * 挂上 listItemPulse 类即在既有节点上触发 appr-in 动画（demo .apListItem.pulse）。
 */
export function diffPulseKeys(
  groups: readonly { readonly key: string; readonly status: string }[],
  prev: ReadonlyMap<string, string>,
): Set<string> {
  const pulsed = new Set<string>();
  for (const group of groups) {
    const before = prev.get(group.key);
    if (before === undefined) {
      if (prev.size > 0) pulsed.add(group.key);
    } else if (before === "pending" && group.status !== "pending") {
      pulsed.add(group.key);
    }
  }
  return pulsed;
}

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

  // 决策脉冲：与上一帧组状态 diff（effect 提交后回写 ref，渲染期读旧值判定变化）
  const prevStatusRef = useRef<ReadonlyMap<string, string>>(new Map());
  const pulseKeys = diffPulseKeys(groups, prevStatusRef.current);
  useEffect(() => {
    prevStatusRef.current = new Map(groups.map((group) => [group.key, group.status]));
  }, [groups]);

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
                        pulseKeys.has(group.key) ? styles.listItemPulse : "",
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
                            .flatMap((approval) => approval.toolCalls.map((tc) => tc.toolName))
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
