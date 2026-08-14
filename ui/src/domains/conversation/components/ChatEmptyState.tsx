/**
 * ChatEmptyState
 *
 * 无对话时的引导空态：kicker + 图标 + 标题 + 说明 + 示例指令 chips + 新建动作。
 */
import { Feather, Plus } from "lucide-react";
import { Button } from "../../../shared/primitives/Button.js";
import { Icon } from "../../../shared/primitives/Icon.js";
import styles from "./ChatEmptyState.module.css";

export interface ChatEmptyStateProps {
  readonly onCreate?: () => void;
}

const EXAMPLES: readonly string[] = [
  "起草第一卷的开场场景",
  "把雨夜码头这场戏改写出两个版本",
  "为林夏建立角色档案",
  "梳理当前大纲，找出没有正文的单元",
];

export function ChatEmptyState({ onCreate }: ChatEmptyStateProps) {
  return (
    <div className={styles.empty}>
      <span className={styles.kicker}>Novel Agent</span>
      <span className={styles.iconWrap} aria-hidden="true">
        <Icon icon={Feather} size="lg" />
      </span>
      <h3>开始一段新的创作</h3>
      <p>描述你想推进的任务：起草场景、修订正文、推进大纲节点。Agent 会生成草稿与提议，供你审批后落库。</p>
      <div className={styles.examples} aria-hidden="true">
        {EXAMPLES.map((example) => (
          <span key={example} className={styles.example}>{example}</span>
        ))}
      </div>
      {onCreate !== undefined ? (
        <Button variant="primary" leadingIcon={<Icon icon={Plus} size="sm" />} onClick={onCreate}>
          新建对话
        </Button>
      ) : null}
    </div>
  );
}
