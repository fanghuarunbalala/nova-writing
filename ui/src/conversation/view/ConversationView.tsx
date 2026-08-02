/** Hook-connected read-only Conversation screen for GUI and Web. */
import { useConversationProjection } from "../useConversationProjection.js";
import { ConversationProjectionView } from "./ConversationProjectionView.js";
import type {
  ConversationCardProjectorRegistry,
  ConversationCardRendererRegistry,
} from "../../card/index.js";

export interface ConversationViewProps {
  readonly conversationId: string;
  readonly diagnostics?: boolean;
  readonly cardProjectors?: ConversationCardProjectorRegistry;
  readonly cardRenderers?: ConversationCardRendererRegistry;
}

export function ConversationView({
  conversationId,
  diagnostics,
  cardProjectors,
  cardRenderers,
}: ConversationViewProps) {
  const result = useConversationProjection(conversationId, { cardProjectors });
  return (
    <ConversationProjectionView
      result={result}
      diagnostics={diagnostics}
      cardRenderers={cardRenderers}
    />
  );
}
