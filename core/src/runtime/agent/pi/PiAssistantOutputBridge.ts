/**
 * Persists Pi Assistant draft start, text/thinking deltas, and terminal state.
 *
 * Tool-call arguments and Provider-specific metadata remain outside this bridge.
 */
import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import {
  AgentAssistantMessageCancelledOutputEvent,
  AgentAssistantMessageCompletedOutputEvent,
  AgentAssistantMessageDeltaOutputEvent,
  AgentAssistantMessageFailedOutputEvent,
  AgentAssistantMessageStartedOutputEvent,
  ASSISTANT_MESSAGE_COMPLETION_REASON,
  ASSISTANT_MESSAGE_DELTA_CHANNEL,
  ASSISTANT_MESSAGE_FAILURE_CODE,
  OUTPUT_EVENT_TYPE,
  type AssistantMessageCompletionReason,
  type AssistantMessageContent,
} from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  TURN_STATUS,
  type RuntimeEventIdFactory,
  type RuntimeEventSink,
  type TurnStateSnapshot,
} from "../../execution/index.js";
import type { PiAgentEventBridge, PiAgentEventBridgeRequest } from "./PiAgentEventBridge.js";
import {
  PI_ASSISTANT_OUTPUT_BRIDGE_FAILURE,
  PiAssistantOutputBridgeError,
  type PiAssistantOutputBridgeFailure,
} from "./PiAssistantOutputBridgeErrors.js";

export interface PiAssistantTurnStateReader {
  getTurnSnapshot(): TurnStateSnapshot | undefined;
}

export interface PiAssistantMessageIdGenerator {
  generate(): string;
}

export class RandomPiAssistantMessageIdGenerator
  implements PiAssistantMessageIdGenerator
{
  generate(): string {
    return `assistant_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
  }
}

export interface PiAssistantOutputClock {
  now(): string;
}

export class SystemPiAssistantOutputClock implements PiAssistantOutputClock {
  now(): string {
    return new Date().toISOString();
  }
}

export interface PiAssistantOutputBridgeOptions {
  conversationId: string;
  turnStateReader: PiAssistantTurnStateReader;
  eventIdFactory: RuntimeEventIdFactory;
  eventSink: RuntimeEventSink;
  messageIdGenerator?: PiAssistantMessageIdGenerator;
  clock?: PiAssistantOutputClock;
  logger?: Logger;
}

interface ActiveAssistantDraft {
  readonly runId: string;
  readonly turnId: string;
  readonly assistantMessageId: string;
  nextDeltaOrdinal: number;
}

type PiAssistantMessage = Extract<AgentMessage, { role: "assistant" }>;

export class PiAssistantOutputBridge implements PiAgentEventBridge {
  private readonly conversationId: string;
  private readonly turnStateReader: PiAssistantTurnStateReader;
  private readonly eventIdFactory: RuntimeEventIdFactory;
  private readonly eventSink: RuntimeEventSink;
  private readonly messageIdGenerator: PiAssistantMessageIdGenerator;
  private readonly clock: PiAssistantOutputClock;
  private readonly logger: Logger;
  private activeDraft?: ActiveAssistantDraft;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: PiAssistantOutputBridgeOptions) {
    assertNonBlank("Conversation ID", options.conversationId);
    this.conversationId = options.conversationId;
    this.turnStateReader = options.turnStateReader;
    this.eventIdFactory = options.eventIdFactory;
    this.eventSink = options.eventSink;
    this.messageIdGenerator =
      options.messageIdGenerator ?? new RandomPiAssistantMessageIdGenerator();
    this.clock = options.clock ?? new SystemPiAssistantOutputClock();
    this.logger = (options.logger ?? noopLogger).child({
      component: "pi_assistant_output_bridge",
      conversationId: this.conversationId,
    });
  }

  handle(request: PiAgentEventBridgeRequest): Promise<void> {
    let captured: PiAgentEventBridgeRequest;
    try {
      captured = captureRequest(request);
    } catch {
      return Promise.reject(
        this.fail(
          PI_ASSISTANT_OUTPUT_BRIDGE_FAILURE.invalidRequest,
          captureNonBlank(request?.runId),
        ),
      );
    }
    return this.serialize(() => this.handleCaptured(captured));
  }

  private async handleCaptured(request: PiAgentEventBridgeRequest): Promise<void> {
    if (request.conversationId !== this.conversationId) {
      throw this.fail(PI_ASSISTANT_OUTPUT_BRIDGE_FAILURE.invalidRequest, request.runId);
    }
    switch (request.event.type) {
      case "message_start":
        if (request.event.message.role === "assistant") {
          await this.startDraft(request.runId);
        }
        return;
      case "message_update":
        if (request.event.message.role === "assistant") {
          await this.appendDelta(request);
        }
        return;
      case "message_end":
        if (request.event.message.role === "assistant") {
          await this.endDraft(request, request.event.message);
        }
        return;
      case "turn_end":
      case "agent_end":
        if (this.activeDraft !== undefined) {
          throw this.fail(
            PI_ASSISTANT_OUTPUT_BRIDGE_FAILURE.draftStillActive,
            request.runId,
            this.activeDraft.turnId,
            this.activeDraft.assistantMessageId,
          );
        }
        return;
      default:
        return;
    }
  }

  private async startDraft(runId: string): Promise<void> {
    if (this.activeDraft !== undefined) {
      throw this.fail(
        PI_ASSISTANT_OUTPUT_BRIDGE_FAILURE.draftAlreadyActive,
        runId,
        this.activeDraft.turnId,
        this.activeDraft.assistantMessageId,
      );
    }
    const turn = this.requireTurn(runId, true, undefined, true);
    const assistantMessageId = this.messageIdGenerator.generate();
    assertNonBlank("Assistant Message ID", assistantMessageId);
    const event = new AgentAssistantMessageStartedOutputEvent({
      id: this.createEventId(
        OUTPUT_EVENT_TYPE.agentAssistantMessageStarted,
        runId,
        turn.turnId,
        0,
      ),
      conversationId: this.conversationId,
      runId,
      turnId: turn.turnId,
      timestamp: this.clock.now(),
      assistantMessageId,
    });
    const receipt = await this.appendEvent(event, runId, turn.turnId, assistantMessageId);
    this.activeDraft = {
      runId,
      turnId: turn.turnId,
      assistantMessageId,
      nextDeltaOrdinal: 0,
    };
    this.logger.info("runtime.agent.assistant_started", {
      runId,
      turnId: turn.turnId,
      assistantMessageId,
      receiptSequence: receipt.sequence,
    });
  }

  private async appendDelta(request: PiAgentEventBridgeRequest): Promise<void> {
    const active = this.requireDraft(request.runId);
    this.requireTurn(request.runId, false, active.turnId);
    if (request.event.type !== "message_update") return;
    const update = request.event.assistantMessageEvent;
    const delta = captureDelta(update);
    if (delta === undefined) return;
    const ordinal = active.nextDeltaOrdinal;
    const event = new AgentAssistantMessageDeltaOutputEvent({
      id: this.createEventId(
        OUTPUT_EVENT_TYPE.agentAssistantMessageDelta,
        request.runId,
        active.turnId,
        ordinal,
      ),
      conversationId: this.conversationId,
      runId: request.runId,
      turnId: active.turnId,
      timestamp: this.clock.now(),
      assistantMessageId: active.assistantMessageId,
      deltaOrdinal: ordinal,
      contentIndex: delta.contentIndex,
      channel: delta.channel,
      delta: delta.delta,
    });
    const receipt = await this.appendEvent(
      event,
      request.runId,
      active.turnId,
      active.assistantMessageId,
    );
    active.nextDeltaOrdinal += 1;
    this.logger.debug("runtime.agent.assistant_delta", {
      runId: request.runId,
      turnId: active.turnId,
      assistantMessageId: active.assistantMessageId,
      deltaOrdinal: ordinal,
      channel: delta.channel,
      receiptSequence: receipt.sequence,
    });
  }

  private async endDraft(
    request: PiAgentEventBridgeRequest,
    message: PiAssistantMessage,
  ): Promise<void> {
    const active = this.requireDraft(request.runId);
    const turn = this.requireTurn(request.runId, false, active.turnId);
    const event = createTerminalEvent({
      conversationId: this.conversationId,
      runId: request.runId,
      turnId: active.turnId,
      assistantMessageId: active.assistantMessageId,
      timestamp: this.clock.now(),
      message,
      cancelled:
        message.stopReason === "aborted" &&
        (request.signal.aborted ||
          turn.status === TURN_STATUS.stopping ||
          turn.status === TURN_STATUS.cancelled),
      eventIdFactory: this.eventIdFactory,
    });
    const receipt = await this.appendEvent(
      event,
      request.runId,
      active.turnId,
      active.assistantMessageId,
    );
    this.activeDraft = undefined;
    this.logger.info("runtime.agent.assistant_terminal", {
      runId: request.runId,
      turnId: active.turnId,
      assistantMessageId: active.assistantMessageId,
      outcome: terminalOutcome(event.getEventType()),
      deltaCount: active.nextDeltaOrdinal,
      receiptSequence: receipt.sequence,
    });
  }

  private requireDraft(runId: string): ActiveAssistantDraft {
    const active = this.activeDraft;
    if (active === undefined) {
      throw this.fail(PI_ASSISTANT_OUTPUT_BRIDGE_FAILURE.draftMissing, runId);
    }
    if (active.runId !== runId) {
      throw this.fail(
        PI_ASSISTANT_OUTPUT_BRIDGE_FAILURE.turnMismatch,
        runId,
        active.turnId,
        active.assistantMessageId,
      );
    }
    return active;
  }

  private requireTurn(
    runId: string,
    requireRunning: boolean,
    expectedTurnId?: string,
    tolerateCancellationState = false,
  ): TurnStateSnapshot {
    const turn = this.turnStateReader.getTurnSnapshot();
    if (turn === undefined) {
      throw this.fail(PI_ASSISTANT_OUTPUT_BRIDGE_FAILURE.turnMissing, runId);
    }
    if (
      turn.runId !== runId ||
      (expectedTurnId !== undefined && turn.turnId !== expectedTurnId)
    ) {
      throw this.fail(
        PI_ASSISTANT_OUTPUT_BRIDGE_FAILURE.turnMismatch,
        runId,
        turn.turnId,
      );
    }
    if (requireRunning && turn.status !== TURN_STATUS.running) {
      // 取消期间：stop 处理器先转 turn→stopping 再 dispatch abort，provider 被 abort 后
      // 的 message_start 到达时 turn 已非 running。startDraft 对 stopping/cancelled 容忍
      // （endDraft 会把 aborted 消息落为 Cancelled 事件）；completed/failed 仍是真实协议
      // 违规，继续抛 turnState。
      const cancellationState =
        turn.status === TURN_STATUS.stopping || turn.status === TURN_STATUS.cancelled;
      if (!(tolerateCancellationState && cancellationState)) {
        throw this.fail(
          PI_ASSISTANT_OUTPUT_BRIDGE_FAILURE.turnState,
          runId,
          turn.turnId,
        );
      }
    }
    return turn;
  }

  private createEventId(
    eventType: string,
    runId: string,
    turnId: string,
    ordinal: number,
  ): string {
    return this.eventIdFactory.create({
      scope: "turn",
      conversationId: this.conversationId,
      eventType,
      runId,
      turnId,
      ordinal,
    });
  }

  private async appendEvent(
    event:
      | AgentAssistantMessageStartedOutputEvent
      | AgentAssistantMessageDeltaOutputEvent
      | AgentAssistantMessageCompletedOutputEvent
      | AgentAssistantMessageFailedOutputEvent
      | AgentAssistantMessageCancelledOutputEvent,
    runId: string,
    turnId: string,
    assistantMessageId: string,
  ) {
    try {
      return await this.eventSink.append(event);
    } catch {
      throw this.fail(
        PI_ASSISTANT_OUTPUT_BRIDGE_FAILURE.eventAppend,
        runId,
        turnId,
        assistantMessageId,
      );
    }
  }

  private fail(
    failure: PiAssistantOutputBridgeFailure,
    runId?: string,
    turnId?: string,
    assistantMessageId?: string,
  ): PiAssistantOutputBridgeError {
    this.logger.error("runtime.agent.assistant_output_failed", {
      failure,
      ...(runId !== undefined ? { runId } : {}),
      ...(turnId !== undefined ? { turnId } : {}),
      ...(assistantMessageId !== undefined ? { assistantMessageId } : {}),
    });
    return new PiAssistantOutputBridgeError(
      failure,
      this.conversationId,
      runId,
      turnId,
      assistantMessageId,
    );
  }

  private serialize(operation: () => Promise<void>): Promise<void> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

interface TerminalEventOptions {
  conversationId: string;
  runId: string;
  turnId: string;
  assistantMessageId: string;
  timestamp: string;
  message: PiAssistantMessage;
  cancelled: boolean;
  eventIdFactory: RuntimeEventIdFactory;
}

function createTerminalEvent(options: TerminalEventOptions) {
  if (options.cancelled) {
    return new AgentAssistantMessageCancelledOutputEvent({
      ...terminalBase(options, OUTPUT_EVENT_TYPE.agentAssistantMessageCancelled),
      assistantMessageId: options.assistantMessageId,
    });
  }
  if (options.message.stopReason === "error" || options.message.stopReason === "aborted") {
    return new AgentAssistantMessageFailedOutputEvent({
      ...terminalBase(options, OUTPUT_EVENT_TYPE.agentAssistantMessageFailed),
      assistantMessageId: options.assistantMessageId,
      failureCode:
        options.message.stopReason === "error"
          ? ASSISTANT_MESSAGE_FAILURE_CODE.providerError
          : ASSISTANT_MESSAGE_FAILURE_CODE.providerAborted,
      ...(options.message.stopReason === "error"
        ? { failureDetail: providerFailureDetail(options.message) }
        : {}),
    });
  }
  return new AgentAssistantMessageCompletedOutputEvent({
    ...terminalBase(options, OUTPUT_EVENT_TYPE.agentAssistantMessageCompleted),
    assistantMessageId: options.assistantMessageId,
    content: captureAssistantContent(options.message),
    completionReason: mapCompletionReason(options.message.stopReason),
    hasToolCalls: options.message.content.some((item) => item.type === "toolCall"),
  });
}

/** 开发阶段：直接展示 provider 原始错误文本（截断）。Raw provider error text, truncated. */
function providerFailureDetail(
  message: { readonly errorMessage?: string },
): string | undefined {
  const text = message.errorMessage ?? "";
  const trimmed = text.trim();
  return trimmed.length === 0 ? undefined : trimmed.slice(0, 240);
}

function terminalBase(options: TerminalEventOptions, eventType: string) {
  return {
    id: options.eventIdFactory.create({
      scope: "turn" as const,
      conversationId: options.conversationId,
      eventType,
      runId: options.runId,
      turnId: options.turnId,
      ordinal: 0,
    }),
    conversationId: options.conversationId,
    runId: options.runId,
    turnId: options.turnId,
    timestamp: options.timestamp,
  };
}

function captureAssistantContent(
  message: PiAssistantMessage,
): readonly AssistantMessageContent[] {
  return Object.freeze(
    message.content.flatMap((item): AssistantMessageContent[] => {
      if (item.type === "text") {
        return [Object.freeze({ type: "text", text: item.text })];
      }
      if (item.type === "thinking") {
        return [
          Object.freeze({
            type: "thinking",
            thinking: item.thinking,
            ...(item.redacted !== undefined ? { redacted: item.redacted } : {}),
          }),
        ];
      }
      return [];
    }),
  );
}

function mapCompletionReason(
  stopReason: Extract<PiAssistantMessage["stopReason"], "stop" | "length" | "toolUse">,
): AssistantMessageCompletionReason {
  if (stopReason === "length") return ASSISTANT_MESSAGE_COMPLETION_REASON.length;
  if (stopReason === "toolUse") return ASSISTANT_MESSAGE_COMPLETION_REASON.toolUse;
  return ASSISTANT_MESSAGE_COMPLETION_REASON.stop;
}

function captureDelta(
  event: Extract<AgentEvent, { type: "message_update" }>["assistantMessageEvent"],
): {
  readonly contentIndex: number;
  readonly channel: "text" | "thinking";
  readonly delta: string;
} | undefined {
  if (event.type === "text_delta" && event.delta.length > 0) {
    return {
      contentIndex: event.contentIndex,
      channel: ASSISTANT_MESSAGE_DELTA_CHANNEL.text,
      delta: event.delta,
    };
  }
  if (event.type === "thinking_delta" && event.delta.length > 0) {
    return {
      contentIndex: event.contentIndex,
      channel: ASSISTANT_MESSAGE_DELTA_CHANNEL.thinking,
      delta: event.delta,
    };
  }
  return undefined;
}

function terminalOutcome(eventType: string): "completed" | "failed" | "cancelled" {
  if (eventType === OUTPUT_EVENT_TYPE.agentAssistantMessageCompleted) return "completed";
  if (eventType === OUTPUT_EVENT_TYPE.agentAssistantMessageCancelled) return "cancelled";
  return "failed";
}

function captureRequest(request: PiAgentEventBridgeRequest): PiAgentEventBridgeRequest {
  if (
    request === null ||
    typeof request !== "object" ||
    typeof request.conversationId !== "string" ||
    request.conversationId.trim().length === 0 ||
    typeof request.runId !== "string" ||
    request.runId.trim().length === 0 ||
    request.event === null ||
    typeof request.event !== "object" ||
    typeof request.event.type !== "string" ||
    request.signal === null ||
    typeof request.signal !== "object" ||
    typeof request.signal.aborted !== "boolean"
  ) {
    throw new TypeError("Pi Assistant output request is invalid");
  }
  return request;
}

function assertNonBlank(label: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
}

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
