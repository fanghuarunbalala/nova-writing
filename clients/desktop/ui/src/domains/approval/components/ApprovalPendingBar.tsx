/**
 * ApprovalPendingBar
 *
 * 审批挂起提示条（demo .apAlertBar）：稍后处理收起弹窗后常驻对话视图顶部，
 * 琥珀胶囊 + 呼吸光晕 + 「立即处理」——点击唤回审批弹窗。
 * 有待决且弹窗未开时显示；全部处理完自动消失。
 */
import { ArrowRight, Hourglass } from "lucide-react";
import { Icon } from "../../../shared/primitives/Icon.js";
import styles from "./ApprovalPendingBar.module.css";

export interface ApprovalPendingBarProps {
  /** 本会话待审批组数 */
  readonly count: number;
  readonly onSummon: () => void;
}

export function ApprovalPendingBar({ count, onSummon }: ApprovalPendingBarProps) {
  return (
    <button
      type="button"
      className={styles.bar}
      onClick={onSummon}
      title="打开审批弹窗"
    >
      <Icon icon={Hourglass} size="sm" />
      <b>审批挂起</b>
      <span>
        · {count} 项待决，会话已暂停——处理完继续
      </span>
      <span className={styles.action}>
        立即处理
        <Icon icon={ArrowRight} size="xs" />
      </span>
    </button>
  );
}
