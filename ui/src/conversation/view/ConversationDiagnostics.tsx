/** Payload-free Event descriptors available only in explicit diagnostics mode. */
import type { ConversationEventDescriptor } from "@novel/core";

export function ConversationDiagnostics({ events }: { readonly events: readonly ConversationEventDescriptor[] }) {
  return (
    <details className="novel-conversation-diagnostics">
      <summary>事件诊断（{events.length}）</summary>
      <ol>
        {events.map((event) => (
          <li key={`${event.sequence}:${event.eventId}`}>
            <span>#{event.sequence}</span> <code>{event.eventType}</code>{" "}
            <span>{event.direction}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
