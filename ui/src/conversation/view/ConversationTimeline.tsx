/** Read-only visible timeline derived exclusively from Core projections. */
import type { ConversationProjectionSnapshot } from "@novel/core";
import { AssistantMessageItem } from "./AssistantMessageItem.js";
import { ConversationDiagnostics } from "./ConversationDiagnostics.js";
import { ToolApprovalItem } from "./ToolApprovalItem.js";
import { UserMessageItem } from "./UserMessageItem.js";

export interface ConversationTimelineProps {
  readonly projection: ConversationProjectionSnapshot;
  readonly diagnostics?: boolean;
}

export function ConversationTimeline({ projection, diagnostics = false }: ConversationTimelineProps) {
  return (
    <div className="novel-conversation-timeline" aria-live="polite">
      {projection.timeline.length === 0 ? (
        <div className="novel-conversation-empty">开始你的创作对话</div>
      ) : (
        projection.timeline.map((item) => {
          if (item.kind === "user-message") {
            return <UserMessageItem key={`user:${item.eventId}`} message={item} />;
          }
          if (item.kind === "assistant-message") {
            return <AssistantMessageItem key={`assistant:${item.assistantMessageId}`} message={item} />;
          }
          return <ToolApprovalItem key={`approval:${item.approvalRequestId}`} approval={item} />;
        })
      )}
      {diagnostics ? <ConversationDiagnostics events={projection.events} /> : null}
    </div>
  );
}
