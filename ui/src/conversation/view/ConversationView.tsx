/** Hook-connected read-only Conversation screen for GUI and Web. */
import { useConversationProjection } from "../useConversationProjection.js";
import { ConversationTimeline } from "./ConversationTimeline.js";

export interface ConversationViewProps {
  readonly conversationId: string;
  readonly diagnostics?: boolean;
}

export function ConversationView({ conversationId, diagnostics }: ConversationViewProps) {
  const result = useConversationProjection(conversationId);
  const controllerState = result.snapshot.controller?.state ?? result.snapshot.state;
  const runtimePresence = result.snapshot.controller?.runtimePresence;
  return (
    <section className="novel-conversation-view" data-controller-state={controllerState}>
      <header className="novel-conversation-header">
        <span>Conversation</span>
        {runtimePresence !== undefined ? (
          <span className="novel-runtime-presence" data-runtime-state={runtimePresence.state}>
            Runtime {runtimePresence.state}
          </span>
        ) : null}
      </header>
      <ConversationTimeline projection={result.snapshot.projection} diagnostics={diagnostics} />
    </section>
  );
}
