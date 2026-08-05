/**
 * ThinkBlock
 *
 * 思考过程块：虚线线框包裹，默认只显示最后 3 行（不足全显示），
 * 展开按钮切换；streaming 时边框有柔和渐变描边动画。
 */
import { useState } from "react";
import { Icon } from "../../../shared/primitives/Icon.js";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ThinkLineData } from "../projection/ConversationTimelineItem.js";
import { ThinkLine } from "./ThinkLine.js";
import styles from "./ThinkBlock.module.css";

const PREVIEW_LINE_COUNT = 3;

export interface ThinkBlockProps {
  readonly lines: readonly ThinkLineData[];
  readonly expanded: boolean;
  readonly streaming?: boolean;
  readonly onToggle: () => void;
}

export function ThinkBlock({ lines, expanded, streaming = false, onToggle }: ThinkBlockProps) {
  const [internalExpanded, setInternalExpanded] = useState(expanded);
  const isExpanded = expanded || internalExpanded;
  const visibleLines =
    isExpanded || lines.length <= PREVIEW_LINE_COUNT
      ? lines
      : lines.slice(lines.length - PREVIEW_LINE_COUNT);
  const collapsible = lines.length > PREVIEW_LINE_COUNT;

  return (
    <div
      className={[styles.block, streaming ? styles.streaming : ""].filter(Boolean).join(" ")}
      data-expanded={isExpanded || undefined}
    >
      <div className={styles.header}>
        <span className={styles.kicker}>思考</span>
        {collapsible ? (
          <button
            type="button"
            className={styles.toggle}
            onClick={() => {
              setInternalExpanded((value) => !value);
              onToggle();
            }}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "收起思考" : "展开思考"}
          >
            <Icon icon={isExpanded ? ChevronUp : ChevronDown} size="sm" />
            <span>{isExpanded ? "收起" : `展开全部 ${lines.length} 行`}</span>
          </button>
        ) : null}
      </div>
      <div className={styles.lines}>
        {visibleLines.map((line) => (
          <ThinkLine key={line.id} line={line} />
        ))}
      </div>
    </div>
  );
}
