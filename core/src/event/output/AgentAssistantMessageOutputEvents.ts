/** Public Core Assistant draft OutputEvents used by every client surface. */
import { AgentOutputEvent } from "./AgentOutputEvent.js";
import { OUTPUT_EVENT_TYPE } from "./OutputEventType.js";
import type { OutputEventOptions } from "./OutputEventOptions.js";
import {
  AgentAssistantMessageCancelledPayload,
  AgentAssistantMessageCompletedPayload,
  AgentAssistantMessageDeltaPayload,
  AgentAssistantMessageFailedPayload,
  AgentAssistantMessageStartedPayload,
  type AgentAssistantMessageCompletedPayloadOptions,
  type AgentAssistantMessageDeltaPayloadOptions,
  type AssistantMessageFailureCode,
} from "./payload/AgentAssistantMessagePayloads.js";

interface AgentAssistantMessageEventIdentity {
  runId: string;
  turnId: string;
}

type AgentAssistantMessageBaseOptions = Omit<
  OutputEventOptions,
  "runId" | "turnId"
> &
  AgentAssistantMessageEventIdentity;

export type AgentAssistantMessageStartedOutputEventOptions =
  AgentAssistantMessageBaseOptions & {
    assistantMessageId: string;
  };

export class AgentAssistantMessageStartedOutputEvent extends AgentOutputEvent {
  constructor(options: AgentAssistantMessageStartedOutputEventOptions) {
    const identity = captureIdentity(options);
    super(
      "assistant.message.started",
      new AgentAssistantMessageStartedPayload(options.assistantMessageId),
      { ...options, ...identity },
    );
  }

  override getEventType(): string {
    return OUTPUT_EVENT_TYPE.agentAssistantMessageStarted;
  }
}

export type AgentAssistantMessageDeltaOutputEventOptions =
  AgentAssistantMessageBaseOptions & AgentAssistantMessageDeltaPayloadOptions;

export class AgentAssistantMessageDeltaOutputEvent extends AgentOutputEvent {
  constructor(options: AgentAssistantMessageDeltaOutputEventOptions) {
    const identity = captureIdentity(options);
    super(
      "assistant.message.delta",
      new AgentAssistantMessageDeltaPayload(options),
      { ...options, ...identity },
    );
  }

  override getEventType(): string {
    return OUTPUT_EVENT_TYPE.agentAssistantMessageDelta;
  }
}

export type AgentAssistantMessageCompletedOutputEventOptions =
  AgentAssistantMessageBaseOptions & AgentAssistantMessageCompletedPayloadOptions;

export class AgentAssistantMessageCompletedOutputEvent extends AgentOutputEvent {
  constructor(options: AgentAssistantMessageCompletedOutputEventOptions) {
    const identity = captureIdentity(options);
    super(
      "assistant.message.completed",
      new AgentAssistantMessageCompletedPayload(options),
      { ...options, ...identity },
    );
  }

  override getEventType(): string {
    return OUTPUT_EVENT_TYPE.agentAssistantMessageCompleted;
  }
}

export type AgentAssistantMessageFailedOutputEventOptions =
  AgentAssistantMessageBaseOptions & {
    assistantMessageId: string;
    failureCode: AssistantMessageFailureCode;
  };

export class AgentAssistantMessageFailedOutputEvent extends AgentOutputEvent {
  constructor(options: AgentAssistantMessageFailedOutputEventOptions) {
    const identity = captureIdentity(options);
    super(
      "assistant.message.failed",
      new AgentAssistantMessageFailedPayload(
        options.assistantMessageId,
        options.failureCode,
      ),
      { ...options, ...identity },
    );
  }

  override getEventType(): string {
    return OUTPUT_EVENT_TYPE.agentAssistantMessageFailed;
  }
}

export type AgentAssistantMessageCancelledOutputEventOptions =
  AgentAssistantMessageBaseOptions & {
    assistantMessageId: string;
  };

export class AgentAssistantMessageCancelledOutputEvent extends AgentOutputEvent {
  constructor(options: AgentAssistantMessageCancelledOutputEventOptions) {
    const identity = captureIdentity(options);
    super(
      "assistant.message.cancelled",
      new AgentAssistantMessageCancelledPayload(options.assistantMessageId),
      { ...options, ...identity },
    );
  }

  override getEventType(): string {
    return OUTPUT_EVENT_TYPE.agentAssistantMessageCancelled;
  }
}

function captureIdentity(
  options: AgentAssistantMessageEventIdentity,
): AgentAssistantMessageEventIdentity {
  assertNonBlank("Run ID", options.runId);
  assertNonBlank("Turn ID", options.turnId);
  return Object.freeze({ runId: options.runId, turnId: options.turnId });
}

function assertNonBlank(label: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
}
