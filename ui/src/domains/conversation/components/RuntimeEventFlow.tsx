/**
 * RuntimeEventFlow
 *
 * 对话内"本轮时序"（原型 .evt-flow）：按家族（agent/system/novel）分色的
 * 事件行列表，默认折叠，可展开查看。数据来自 core 投影的脱敏事件摘要。
 *
 * In-chat runtime event flow (prototype .evt-flow): family-colored event rows,
 * collapsed by default. Data comes from redacted event summaries in the core
 * projection.
 * memo 包裹：events 引用稳定即零重渲染。
 */
import { memo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Icon } from "../../../shared/primitives/Icon.js";
import type { ConversationEventView } from "../projection/ConversationTimelineItem.js";
import styles from "./RuntimeEventFlow.module.css";

export interface RuntimeEventFlowProps {
  readonly events: readonly ConversationEventView[];
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export const RuntimeEventFlow = memo(function RuntimeEventFlow({ events }: RuntimeEventFlowProps) {
  const [expanded, setExpanded] = useState(false);
  if (events.length === 0) return null;
  return (
    <section className={styles.flow} data-expanded={expanded || undefined}>
      <button
        type="button"
        className={styles.head}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label={expanded ? "收起本轮时序" : "展开本轮时序"}
      >
        <span className={styles.title}>本轮时序</span>
        <span className={styles.count}>{events.length} 条事件</span>
        <Icon icon={expanded ? ChevronUp : ChevronDown} size="sm" />
      </button>
      {expanded ? (
        <ol className={styles.rows}>
          {events.map((event) => (
            <li key={event.sequence} className={[styles.row, styles[event.family]].join(" ")}>
              <time className={styles.time}>{formatTime(event.timestamp)}</time>
              <code className={styles.name}>{event.eventType}</code>
              {event.summary !== undefined ? (
                <span className={styles.desc}>{event.summary}</span>
              ) : null}
              {event.outcome === "failed" ? (
                <span className={styles.failed}>失败</span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
});
