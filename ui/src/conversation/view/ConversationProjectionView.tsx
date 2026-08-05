/** Presentational Conversation view driven by one shared Hook result. */
import type { ConversationProjectionHookResult } from "../useConversationProjection.js";
import type {
  ConversationCardDescriptor,
  ConversationCardRendererRegistry,
} from "../../card/index.js";
import { ConversationConnectionStatus } from "./ConversationConnectionStatus.js";
import { ConversationRuntimeStatusView } from "./ConversationRuntimeStatusView.js";
import { ConversationTimeline } from "./ConversationTimeline.js";
import { useConversationInteraction } from "../interaction/index.js";

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
  const interaction = useConversationInteraction(result, runtimeFailureCode);
  return (
    <section className="novel-conversation-view" data-controller-state={controllerState}>
      <header className="novel-conversation-header">
        <span>Conversation</span>
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
        onRetryMessage={(assistantMessageId) => {
          const scenario = interaction.scenarios.find(
            (candidate) =>
              candidate.kind === "assistant-message" &&
              candidate.assistantMessageId === assistantMessageId,
          );
          if (scenario !== undefined && scenario.kind === "assistant-message") {
            void interaction.commands.retryMessage(scenario);
          }
        }}
        onResendUser={(eventId) => {
          const scenario = interaction.scenarios.find(
            (candidate) =>
              candidate.kind === "user-message" && candidate.eventId === eventId,
          );
          if (scenario !== undefined && scenario.kind === "user-message") {
            void interaction.commands.editAndResend(scenario.text);
          }
        }}
        onDecideApproval={(approvalRequestId, argumentDigest, decision) => {
          void interaction.commands.decideApproval({
            approvalRequestId,
            argumentDigest,
            decision,
          });
        }}
      />
      <div className="novel-runtime-status-anchor">
        <ConversationRuntimeStatusView
          status={interaction.runtime.status}
          failureCode={interaction.runtime.failureCode}
          onRetry={onRuntimeRetry}
          onStop={
            interaction.runtime.canStop
              ? interaction.commands.stop
              : onRuntimeStop
          }
          onOpenSettings={onRuntimeOpenSettings}
        />
      </div>
    </section>
  );
}
