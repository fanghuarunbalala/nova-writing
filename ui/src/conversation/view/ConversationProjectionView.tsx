/** Presentational Conversation view driven by one shared Hook result. */
import type { ConversationProjectionHookResult } from "../useConversationProjection.js";
import type {
  ConversationCardDescriptor,
  ConversationCardRendererRegistry,
} from "../../card/index.js";
import { ConversationConnectionStatus } from "./ConversationConnectionStatus.js";
import { ConversationTimeline } from "./ConversationTimeline.js";

export interface ConversationProjectionViewProps {
  readonly result: ConversationProjectionHookResult;
  readonly diagnostics?: boolean;
  readonly cards?: readonly ConversationCardDescriptor[];
  readonly cardRenderers?: ConversationCardRendererRegistry;
  readonly onOpenCardInspector?: (card: ConversationCardDescriptor) => void;
}

export function ConversationProjectionView({
  result,
  diagnostics,
  cards = result.snapshot.cards.cards,
  cardRenderers,
  onOpenCardInspector,
}: ConversationProjectionViewProps) {
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
      {controllerState !== "live" ? (
        <ConversationConnectionStatus snapshot={result.snapshot} resume={result.resume} />
      ) : null}
      <ConversationTimeline
        projection={result.snapshot.projection}
        diagnostics={diagnostics}
        cards={cards}
        cardRenderers={cardRenderers}
        onOpenCardInspector={onOpenCardInspector}
      />
    </section>
  );
}
