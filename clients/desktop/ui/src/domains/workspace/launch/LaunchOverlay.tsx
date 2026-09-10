/**
 * LaunchOverlay：打开 / 切换工作区的全屏分步加载遮罩（demo loadingMask 对齐）。
 *
 * 渐变光球（grad-flow + loading-bob）+ 标题 + mono 步骤清单逐个点亮（✓ 弹入）。
 * 进入 booting 阶段淡出（dialog-fade-out 0.25s），与工作台 boot-in 叠化。
 * 由 LaunchProgressStore 驱动（真实进度 + 保底节奏）。
 */
import { Check } from "lucide-react";
import { Icon } from "../../../shared/primitives/Icon.js";
import type { LaunchProgressSnapshot } from "./LaunchProgressStore.js";
import styles from "./LaunchOverlay.module.css";

export interface LaunchOverlayProps {
  readonly snapshot: LaunchProgressSnapshot;
}

export function LaunchOverlay({ snapshot }: LaunchOverlayProps) {
  const leaving = snapshot.phase === "booting";
  return (
    <div
      className={leaving ? `${styles.mask} ${styles.leaving}` : styles.mask}
      role="status"
      aria-live="polite"
      aria-label={snapshot.title}
    >
      <div className={styles.card}>
        <span className={styles.orb} aria-hidden="true" />
        <div className={styles.title}>{snapshot.title}</div>
        <div className={styles.steps}>
          {snapshot.steps.map((step) => (
            <div
              key={step.label}
              className={step.lit ? `${styles.step} ${styles.on}` : styles.step}
            >
              <span className={styles.tick} aria-hidden="true">
                <Icon icon={Check} size="xs" />
              </span>
              {step.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
