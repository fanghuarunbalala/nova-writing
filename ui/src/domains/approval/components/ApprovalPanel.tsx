/**
 * ApprovalPanel
 *
 * 精简审批面板：列出审批视图（pending/resolved），待批准项提供批准/拒绝。
 * 实体解析/diff 行/上下文树延后（Phase 4 审批流）。
 */
import { Button } from "../../../shared/primitives/Button.js";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import type { ApprovalStore } from "../ApprovalStore.js";
import styles from "./ApprovalPanel.module.css";

export interface ApprovalPanelProps {
  readonly store: ApprovalStore;
  readonly drawerOpen?: boolean;
  readonly onToggleDrawer?: (open: boolean) => void;
}

export function ApprovalPanel({ store, drawerOpen = false }: ApprovalPanelProps) {
  const snapshot = useExternalStore(store);
  return (
    <div className={[styles.panel, drawerOpen ? styles.drawerOpen : ""].filter(Boolean).join(" ")}>
      <nav className={styles.list}>
        <div className={styles.dirHead}>
          审批队列
          <span className={styles.cnt}>{snapshot.approvals.length}</span>
        </div>
        {snapshot.approvals.length === 0 ? (
          <div className={styles.empty}>暂无审批请求</div>
        ) : (
          snapshot.approvals.map((approval) => (
            <div key={approval.requestId} className={styles.row}>
              <span className={styles.rowTitle}>{approval.toolName}</span>
              <span className={styles.meta}>{approval.status}</span>
              {approval.status === "pending" ? (
                <div className={styles.actions}>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void store.decide(approval.requestId, "approved")}
                  >
                    批准
                  </Button>
                  <Button
                    variant="ghost-danger"
                    size="sm"
                    onClick={() => void store.decide(approval.requestId, "rejected")}
                  >
                    拒绝
                  </Button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </nav>
    </div>
  );
}
