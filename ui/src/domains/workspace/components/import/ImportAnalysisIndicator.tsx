/**
 * ImportAnalysisIndicator：导入解构进度浮标（工作台右下角）。
 * analyzing 显示百分比进度条；failed 显示原因与「重试」；analyzed/none 不渲染。
 */
import { BookOpenCheck, RotateCcw, TriangleAlert } from "lucide-react";
import { Icon } from "../../../../shared/primitives/Icon.js";
import { Button } from "../../../../shared/primitives/Button.js";
import { useExternalStore } from "../../../../shared/state/useExternalStore.js";
import type { ProjectImportStatusStore } from "../../import/ProjectImportStatusStore.js";
import styles from "./ProjectImportDialog.module.css";

export interface ImportAnalysisIndicatorProps {
  readonly store: ProjectImportStatusStore;
}

export function ImportAnalysisIndicator({ store }: ImportAnalysisIndicatorProps) {
  const snapshot = useExternalStore(store);
  const progress = snapshot.progress;
  if (progress === undefined || progress.status === "none" || progress.status === "analyzed") {
    return null;
  }
  const retryActions = (
    <div className={styles.indicatorActions}>
      <Button
        variant="secondary"
        size="sm"
        loading={snapshot.retrying}
        leadingIcon={<Icon icon={RotateCcw} size="xs" />}
        onClick={() => void store.retry()}
      >
        重试解构
      </Button>
    </div>
  );
  if (progress.status === "analyzing") {
    const stalled = progress.stalled === true;
    return (
      <div className={styles.indicator} role="status">
        <span className={styles.indicatorTitle}>
          <Icon icon={stalled ? TriangleAlert : BookOpenCheck} size="xs" />
          {stalled ? "导入解构疑似卡住" : "导入解构进行中"}
        </span>
        <div className={styles.indicatorBar}>
          <div
            className={styles.indicatorFill}
            style={{ width: `${progress.indeterminate ? 8 : Math.max(progress.percent, 4)}%` }}
          />
        </div>
        <span className={styles.indicatorBody}>
          {stalled
            ? "解构会话超过 10 分钟无进展（网络或模型端点停滞、或应用中途关闭）。正文与章卷不受影响，可重试解构。"
            : progress.indeterminate
              ? "已启动，正在通读导入书稿…"
              : `已覆盖 ${progress.coveredBatches}/${progress.totalBatches} 批（${progress.percent}%）· 已建 ${progress.unitCount} 个大纲单元`}
          {!stalled ? " 大纲 / 人物 / 地点正在渐进生成，可随时开始对话。" : ""}
        </span>
        {stalled ? retryActions : null}
      </div>
    );
  }
  return (
    <div className={styles.indicator} role="alert">
      <span className={styles.indicatorTitle}>
        <Icon icon={TriangleAlert} size="xs" />
        导入解构未完成
      </span>
      <span className={styles.indicatorBody}>
        {progress.statusReason ?? "解构会话中断。"}正文与章卷已导入完毕，重试只补解构（大纲 / 人物 / 地点）。
      </span>
      {retryActions}
    </div>
  );
}
