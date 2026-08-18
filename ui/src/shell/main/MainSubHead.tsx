/**
 * MainSubHead
 *
 * 主区子头部：标题 + sub + 返回按钮 + 视图级动作。
 */
import { ArrowLeft } from "lucide-react";
import { Icon } from "../../shared/primitives/Icon.js";
import { IconButton } from "../../shared/primitives/IconButton.js";
import type { ReactNode } from "react";
import styles from "./MainSubHead.module.css";

export interface MainSubHeadProps {
  readonly title: string;
  readonly sub?: string;
  /** 当前选中项名称/状态（demo .subCtx，标题右侧；string 或状态 chip 等节点） */
  readonly context?: ReactNode;
  readonly onBack?: () => void;
  readonly actions?: ReactNode;
}

export function MainSubHead({ title, sub, context, onBack, actions }: MainSubHeadProps) {
  return (
    <div className={styles.subhead}>
      {onBack !== undefined ? (
        <IconButton label="返回" size="sm" onClick={onBack}>
          <Icon icon={ArrowLeft} size="sm" />
        </IconButton>
      ) : null}
      <div className={styles.text}>
        <h2 className={styles.title}>{title}</h2>
        {sub !== undefined ? <span className={styles.sub}>{sub}</span> : null}
      </div>
      {context !== undefined && context !== "" ? (
        <span className={styles.context}>{context}</span>
      ) : null}
      {actions !== undefined ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
