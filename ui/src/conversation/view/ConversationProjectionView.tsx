/** Presentational Conversation view driven by one shared Hook result. */
import type { ConversationProjectionHookResult } from "../useConversationProjection.js";
import type {
  ConversationCardDescriptor,
  ConversationCardRendererRegistry,
} from "../../card/index.js";
import { ConversationConnectionStatus } from "./ConversationConnectionStatus.js";
import { ConversationRuntimeStatusView } from "./ConversationRuntimeStatusView.js";
import { ConversationTimeline } from "./ConversationTimeline.js";
import { useConversationRuntimeStatus } from "../useConversationRuntimeStatus.js";

export interface ConversationProjectionViewProps {
  readonly result: ConversationProjectionHookResult;
  readonly diagnostics?: boolean;
  readonly cards?: readonly ConversationCardDescriptor[];
  readonly cardRenderers?: ConversationCardRendererRegistry;
  readonly onOpenCardInspector?: (card: ConversationCardDescriptor) => void;
  readonly runtimeFailureCode?: string;
  readonly onRuntimeRetry?: () => void;
  readonly onRuntimeStop?: () => void;
  readonly onRuntimeOpenSettings?: () => void;
}

export function ConversationProjectionView({
  result,
  diagnostics,
  cards = result.snapshot.cards.cards,
  cardRenderers,
  onOpenCardInspector,
  runtimeFailureCode,
  onRuntimeRetry,
  onRuntimeStop,
  onRuntimeOpenSettings,
}: ConversationProjectionViewProps) {
  const controllerState = result.snapshot.controller?.state ?? result.snapshot.state;
  const runtimeStatus = useConversationRuntimeStatus(
    result.snapshot,
    runtimeFailureCode,
  );
  return (
    <section className="novel-conversation-view" data-controller-state={controllerState}>
      <header className="novel-conversation-header">
        <span>Conversation</span>
        <ConversationRuntimeStatusView
          status={runtimeStatus.status}
          failureCode={runtimeStatus.failureCode}
          onRetry={onRuntimeRetry}
          onStop={onRuntimeStop}
          onOpenSettings={onRuntimeOpenSettings}
        />
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
