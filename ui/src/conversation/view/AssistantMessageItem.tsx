/** Assistant draft or terminal Conversation timeline entry. */
import type { AssistantMessageProjection } from "@novel/core";
import { useState } from "react";
import { THINKING_BLOCK_STYLES } from "../../theme/ThinkingBlockStyles.js";
import { TimelineTimestamp } from "./TimelineTimestamp.js";

const STATUS_LABELS = {
  streaming: "生成中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已停止",
} as const;

export function AssistantMessageItem({
  message,
  onRetry,
}: {
  readonly message: AssistantMessageProjection;
  readonly onRetry?: () => void;
}) {
  const [expandedThinking, setExpandedThinking] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const toggleThinking = (index: number): void => {
    setExpandedThinking((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };
  return (
    <>
      <style>{THINKING_BLOCK_STYLES}</style>
      <article
        className="novel-message novel-assistant-message"
        data-message-status={message.status}
        data-sequence={message.startedSequence}
      >
        <header className="novel-message-header">
          <span>助手</span>
          <TimelineTimestamp timestamp={message.timestamp} />
          <span className="novel-status-token">{STATUS_LABELS[message.status]}</span>
        </header>
        <div className="novel-assistant-content">
          {message.content.map((content, index) =>
            content.type === "text" ? (
              <div className="novel-message-text" key={`text-${index}`}>
                {content.text}
              </div>
            ) : (
              <ThinkingBlock
                content={content}
                expanded={expandedThinking.has(index)}
                key={`thinking-${index}`}
                onToggle={() => toggleThinking(index)}
                streaming={message.status === "streaming"}
              />
            ),
          )}
          {message.status === "streaming" ? (
            <span className="novel-streaming-cursor" aria-label="助手正在生成">
              ●
            </span>
          ) : null}
          {message.status === "failed" ? (
            <p className="novel-message-notice" role="status">
              本轮生成失败
              {message.failureCode !== undefined ? `：${message.failureCode}` : ""}
            </p>
          ) : null}
          {message.status === "cancelled" ? (
            <p className="novel-message-notice" role="status">本轮生成已停止</p>
          ) : null}
          {(message.status === "failed" || message.status === "cancelled") &&
          onRetry !== undefined ? (
            <button className="novel-connection-action" type="button" onClick={onRetry}>
              重试
            </button>
          ) : null}
        </div>
      </article>
    </>
  );
}

function ThinkingBlock({
  content,
  expanded,
  onToggle,
  streaming,
}: {
  readonly content: Extract<
    AssistantMessageProjection["content"][number],
    { readonly type: "thinking" }
  >;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly streaming: boolean;
}) {
  return (
    <div
      className="novel-thinking-block"
      data-expanded={expanded}
      data-streaming={streaming}
    >
      <button
        aria-expanded={expanded}
        className="novel-thinking-toggle"
        type="button"
        onClick={onToggle}
      >
        <span>{content.redacted === true ? "思考摘要" : "思考过程"}</span>
        <span className="novel-thinking-chevron" aria-hidden="true">
          ›
        </span>
      </button>
      <div className={`novel-thinking-content ${expanded ? "expanded" : "collapsed"}`}>
        {content.thinking}
      </div>
    </div>
  );
}
