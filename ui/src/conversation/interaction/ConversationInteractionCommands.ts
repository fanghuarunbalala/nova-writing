/** Unified InputEvent construction behind one scenario command surface. */
import {
  ApprovalDecisionInputEvent,
  ClearContextInputEvent,
  CompactContextInputEvent,
  StopInputEvent,
  UserMessageInputEvent,
  type InputEvent,
  type InputReceipt,
} from "@novel/core";
import type {
  AssistantMessageScenario,
  ConversationInteractionCommands,
} from "./ConversationInteractionTypes.js";

export interface CreateConversationInteractionCommandsOptions {
  readonly conversationId: string;
  readonly enqueue: (event: InputEvent) => Promise<InputReceipt>;
}

export function createConversationInteractionCommands(
  options: CreateConversationInteractionCommandsOptions,
): ConversationInteractionCommands {
  const { conversationId, enqueue } = options;
  const commands: ConversationInteractionCommands = Object.freeze({
    send: (text: string) =>
      enqueue(new UserMessageInputEvent({ conversationId, text })),
    stop: () => enqueue(new StopInputEvent({ conversationId })),
    decideApproval: ({
      approvalRequestId,
      decision,
      argumentDigest,
    }: {
      readonly approvalRequestId: string;
      readonly decision: "approved" | "rejected";
      readonly argumentDigest: `sha256:${string}`;
    }) =>
      enqueue(
        new ApprovalDecisionInputEvent({
          conversationId,
          approvalRequestId,
          decision,
          argumentDigest,
        }),
      ),
    retryMessage: (scenario: AssistantMessageScenario) =>
      enqueue(
        new UserMessageInputEvent({
          conversationId,
          text: scenario.userText,
        }),
      ),
    editAndResend: (text: string) =>
      enqueue(new UserMessageInputEvent({ conversationId, text })),
    clearContext: () => enqueue(new ClearContextInputEvent({ conversationId })),
    compactContext: () => enqueue(new CompactContextInputEvent({ conversationId })),
  });
  return commands;
}
