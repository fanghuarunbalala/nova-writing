/** Presentational Conversation view driven by one shared Hook result. */
import type { ConversationProjectionHookResult } from "../useConversationProjection.js";
import type {
  ConversationCardDescriptor,
  ConversationCardRendererRegistry,
} from "../../card/index.js";
import { ConversationConnectionStatus } from "./ConversationConnectionStatus.js";
import { ConversationTimeline } from "./ConversationTimeline.js";
import { useConversationInteraction } from "../interaction/index.js";

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
  const interaction = useConversationInteraction(result);
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
    </section>
  );
}
