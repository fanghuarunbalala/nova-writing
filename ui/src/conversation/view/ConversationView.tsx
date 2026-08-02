/** Hook-connected read-only Conversation screen for GUI and Web. */
import { useConversationProjection } from "../useConversationProjection.js";
import { ConversationProjectionView } from "./ConversationProjectionView.js";

export interface ConversationViewProps {
  readonly conversationId: string;
  readonly diagnostics?: boolean;
}

export function ConversationView({ conversationId, diagnostics }: ConversationViewProps) {
  const result = useConversationProjection(conversationId);
  return <ConversationProjectionView result={result} diagnostics={diagnostics} />;
}
