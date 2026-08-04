/** User-authored Conversation timeline entry. */
import type { UserMessageProjection } from "@novel/core";
import { TimelineTimestamp } from "./TimelineTimestamp.js";

export function UserMessageItem({
  message,
  onResend,
}: {
  readonly message: UserMessageProjection;
  readonly onResend?: () => void;
}) {
  return (
    <article className="novel-message novel-user-message" data-sequence={message.sequence}>
      <header className="novel-message-header">
        <span>你</span>
        <TimelineTimestamp timestamp={message.timestamp} />
      </header>
      <div className="novel-message-text">{message.text}</div>
      {onResend !== undefined ? (
        <button className="novel-connection-action" type="button" onClick={onResend}>
          重发
        </button>
      ) : null}
    </article>
  );
}
