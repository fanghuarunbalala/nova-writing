/** Assistant draft or terminal Conversation timeline entry. */
import type { AssistantMessageProjection } from "@novel/core";
import { TimelineTimestamp } from "./TimelineTimestamp.js";

const STATUS_LABELS = {
  streaming: "生成中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已停止",
} as const;

export function AssistantMessageItem({ message }: { readonly message: AssistantMessageProjection }) {
  return (
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
            <details className="novel-thinking-block" key={`thinking-${index}`}>
              <summary>{content.redacted === true ? "思考摘要" : "思考过程"}</summary>
              <div>{content.thinking}</div>
            </details>
          ),
        )}
        {message.status === "streaming" ? (
          <span className="novel-streaming-cursor" aria-label="助手正在生成">
            ●
          </span>
        ) : null}
        {message.status === "failed" ? (
          <p className="novel-message-notice" role="status">
            本轮生成失败{message.failureCode !== undefined ? `：${message.failureCode}` : ""}
          </p>
        ) : null}
        {message.status === "cancelled" ? (
          <p className="novel-message-notice" role="status">本轮生成已停止</p>
        ) : null}
      </div>
    </article>
  );
}
