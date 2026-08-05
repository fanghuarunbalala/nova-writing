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
  readonly onBack?: () => void;
  readonly actions?: ReactNode;
}

export function MainSubHead({ title, sub, onBack, actions }: MainSubHeadProps) {
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
      {actions !== undefined ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
