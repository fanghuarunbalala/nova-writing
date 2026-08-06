/**
 * Internal adapter from Core Agent Runtime contracts to Pi Agent Core.
 *
 * Pi owns transient model execution; canonical Messages, lifecycle identity,
 * persistence barriers, and cancellation intent remain owned by Core.
 */
import type {
  AgentEvent,
  AgentMessage,
  StreamFn,
} from "@earendil-works/pi-agent-core";
import {
  canonicalStringifyJson,
  type JsonValue,
} from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type {
  ContextCheckpointApplicationCoordinator,
  ContextProjectionProviderCallCoordinator,
  ContextProjectionProviderCallResult,
} from "../../context/index.js";
import { isExecutionCancellationReason } from "../../execution/ExecutionCancellationReason.js";
import type {
  NudgeProviderCallCoordinator,
  PreparedNudgeProviderCall,
} from "../../nudge/index.js";
import {
  coreRuntimeMessageSchemaRegistry,
  CORE_RUNTIME_MESSAGE_TYPE,
  RUNTIME_MESSAGE_SCHEMA_VERSION,
  type RuntimeMessageSchemaRegistry,
  type RuntimeMessageSnapshot,
} from "../../message/index.js";
import {
  AGENT_RUNTIME_INVOCATION_KIND,
  AGENT_RUNTIME_OUTCOME,
  type AgentRuntimeAdapter,
  type AgentRuntimeCancelRequest,
  type AgentRuntimeOutcome,
  type AgentRuntimeStreamRequest,
  type AgentRuntimeStreamResult,
} from "../AgentRuntimeAdapter.js";
import type { PiAgentCoreClient } from "./PiAgentCoreClient.js";
import {
  PI_AGENT_CORE_ADAPTER_FAILURE,
  PiAgentCoreAdapterError,
  type PiAgentCoreAdapterFailure,
} from "./PiAgentCoreAdapterErrors.js";
import type { PiAgentEventBridge } from "./PiAgentEventBridge.js";
import {
  RandomPiProviderCallIdFactory,
  systemPiProviderCallClock,
  type PiDispatchAwareStreamFunction,
  type PiProviderCallClock,
  type PiProviderCallIdFactory,
  type PiProviderDispatchHooks,
} from "./PiDispatchAwareStreamFunction.js";
import {
  PI_RUNTIME_MESSAGE_CONVERSION_PURPOSE,
  type PiRuntimeMessageConverter,
} from "./PiRuntimeMessageConverter.js";

export interface PiAgentCoreAdapterOptions {
  agent: PiAgentCoreClient;
  messageConverter: PiRuntimeMessageConverter;
  eventBridge: PiAgentEventBridge;
  messageSchemaRegistry?: RuntimeMessageSchemaRegistry;
  nudgeProviderCalls?: NudgeProviderCallCoordinator;
  contextProjectionProviderCalls?: ContextProjectionProviderCallCoordinator;
  checkpointApplications?: ContextCheckpointApplicationCoordinator;
  dispatchAwareStreamFunction?: PiDispatchAwareStreamFunction;
  providerCallIdFactory?: PiProviderCallIdFactory;
  providerCallClock?: PiProviderCallClock;
  logger?: Logger;
}

interface ActivePiRun {
  readonly request: CapturedAgentRuntimeStreamRequest;
  readonly settled: Promise<void>;
  readonly resolveSettled: () => void;
  phase: "preparing" | "executing" | "settling";
  cancelRequested: boolean;
  sawAgentEnd: boolean;
  terminalStopReason?: PiTerminalStopReason;
  eventBarrierError?: PiAgentCoreAdapterError;
  providerDispatchProtocolError?: PiAgentCoreAdapterError;
  contextProjectionError?: PiAgentCoreAdapterError;
  canonicalRuntimeMessages?: readonly RuntimeMessageSnapshot[];
  canonicalPiMessages?: readonly AgentMessage[];
  pendingContextProjection?: PreparedPiContextProjection;
  turnNumber: number;
  providerCallOrdinal: number;
}

type PiTerminalStopReason =
  | "stop"
  | "length"
  | "toolUse"
  | "error"
  | "aborted";

interface CapturedAgentRuntimeStreamRequest extends AgentRuntimeStreamRequest {
  readonly context: AgentRuntimeStreamRequest["context"] & {
    readonly messages: readonly RuntimeMessageSnapshot[];
  };
}

interface PreparedPiContextProjection {
  readonly providerCallId: string;
  readonly result: ContextProjectionProviderCallResult;
}

export class PiAgentCoreAdapter implements AgentRuntimeAdapter {
  private readonly agent: PiAgentCoreClient;
  private readonly messageConverter: PiRuntimeMessageConverter;
  private readonly eventBridge: PiAgentEventBridge;
  private readonly messageSchemaRegistry: RuntimeMessageSchemaRegistry;
  private readonly nudgeProviderCalls?: NudgeProviderCallCoordinator;
  private readonly contextProjectionProviderCalls?: ContextProjectionProviderCallCoordinator;
  private readonly checkpointApplications?: ContextCheckpointApplicationCoordinator;
  private readonly dispatchAwareStreamFunction?: PiDispatchAwareStreamFunction;
  private readonly baseStreamFunction: StreamFn;
  private readonly providerCallIdFactory: PiProviderCallIdFactory;
  private readonly providerCallClock: PiProviderCallClock;
  private readonly logger: Logger;
  private activeRun?: ActivePiRun;

  constructor(options: PiAgentCoreAdapterOptions) {
    this.agent = options.agent;
    this.messageConverter = options.messageConverter;
    this.eventBridge = options.eventBridge;
    this.messageSchemaRegistry =
      options.messageSchemaRegistry ?? coreRuntimeMessageSchemaRegistry;
    this.logger = (options.logger ?? noopLogger).child({
      component: "pi_agent_core_adapter",
    });
    this.nudgeProviderCalls = options.nudgeProviderCalls;
    this.contextProjectionProviderCalls = options.contextProjectionProviderCalls;
    this.checkpointApplications = options.checkpointApplications;
    this.dispatchAwareStreamFunction = options.dispatchAwareStreamFunction;
    this.baseStreamFunction = this.agent.streamFunction;
    this.providerCallIdFactory =
      options.providerCallIdFactory ?? new RandomPiProviderCallIdFactory();
    this.providerCallClock = options.providerCallClock ?? systemPiProviderCallClock;
    const requiresDispatchHooks =
      this.nudgeProviderCalls !== undefined ||
      this.checkpointApplications !== undefined;
    if (requiresDispatchHooks !== (this.dispatchAwareStreamFunction !== undefined)) {
      throw this.fail(PI_AGENT_CORE_ADAPTER_FAILURE.invalidRequest);
    }
    if (this.checkpointApplications && !this.contextProjectionProviderCalls) {
      throw this.fail(PI_AGENT_CORE_ADAPTER_FAILURE.invalidRequest);
    }
    if (
      this.contextProjectionProviderCalls !== undefined &&
      this.agent.transformContext !== undefined
    ) {
      throw this.fail(PI_AGENT_CORE_ADAPTER_FAILURE.invalidRequest);
    }
    if (this.contextProjectionProviderCalls !== undefined) {
      this.agent.transformContext = (messages, signal) =>
        this.transformProviderContext(messages, signal);
    }
    if (
      this.contextProjectionProviderCalls !== undefined ||
      requiresDispatchHooks
    ) {
      this.agent.streamFunction = (model, context, streamOptions) =>
        this.streamProviderCall(model, context, streamOptions);
    }
    this.agent.subscribe((event, signal) => this.handlePiEvent(event, signal));
  }

  async stream(request: AgentRuntimeStreamRequest): Promise<AgentRuntimeStreamResult> {
    let captured: CapturedAgentRuntimeStreamRequest;
    try {
      captured = this.captureStreamRequest(request);
    } catch (error) {
      throw this.normalizeFailure(
        error,
        PI_AGENT_CORE_ADAPTER_FAILURE.invalidRequest,
        request,
      );
    }

    if (this.activeRun !== undefined) {
      throw this.fail(
        PI_AGENT_CORE_ADAPTER_FAILURE.activeRun,
        captured.conversationId,
        captured.runId,
      );
    }

    const settlement = createSettlement();
    const active: ActivePiRun = {
      request: captured,
      settled: settlement.promise,
      resolveSettled: settlement.resolve,
      phase: "preparing",
      cancelRequested: false,
      sawAgentEnd: false,
      turnNumber: 0,
      providerCallOrdinal: 0,
    };
    this.activeRun = active;
    this.logger.info("runtime.agent.stream_started", {
      conversationId: captured.conversationId,
      runId: captured.runId,
      invocationKind: captured.invocation.kind,
      contextMessageCount: captured.context.messages.length,
      promptMessageCount:
        captured.invocation.kind === AGENT_RUNTIME_INVOCATION_KIND.prompt
          ? captured.invocation.messages.length
          : 0,
    });

    try {
      const converted = await this.convertMessages(captured);
      if (active.cancelRequested) {
        const result = this.createResult(captured, AGENT_RUNTIME_OUTCOME.cancelled);
        this.logger.info("runtime.agent.stream_completed", {
          conversationId: captured.conversationId,
          runId: captured.runId,
          outcome: result.outcome,
        });
        return result;
      }

      this.agent.state.systemPrompt = captured.context.systemPrompt;
      this.agent.state.messages = [...converted.context];
      active.canonicalRuntimeMessages = Object.freeze([
        ...captured.context.messages,
        ...(captured.invocation.kind === AGENT_RUNTIME_INVOCATION_KIND.prompt
          ? captured.invocation.messages
          : []),
      ]);
      active.canonicalPiMessages = Object.freeze([
        ...converted.context,
        ...converted.prompt,
      ]);
      active.phase = "executing";
      if (captured.invocation.kind === AGENT_RUNTIME_INVOCATION_KIND.prompt) {
        await this.agent.prompt([...converted.prompt]);
      } else {
        await this.agent.continue();
      }
      if (active.providerDispatchProtocolError !== undefined) {
        throw active.providerDispatchProtocolError;
      }
      if (active.contextProjectionError !== undefined) {
        throw active.contextProjectionError;
      }
      if (active.eventBarrierError !== undefined) throw active.eventBarrierError;
      if (!active.sawAgentEnd || active.terminalStopReason === undefined) {
        throw this.fail(
          PI_AGENT_CORE_ADAPTER_FAILURE.invalidResult,
          captured.conversationId,
          captured.runId,
        );
      }

      const outcome = this.resolveOutcome(active);
      const result = this.createResult(captured, outcome);
      this.logger.info("runtime.agent.stream_completed", {
        conversationId: captured.conversationId,
        runId: captured.runId,
        outcome,
      });
      return result;
    } catch (error) {
      throw this.normalizeFailure(
        error,
        active.eventBarrierError !== undefined
          ? PI_AGENT_CORE_ADAPTER_FAILURE.eventBarrier
          : PI_AGENT_CORE_ADAPTER_FAILURE.execution,
        captured,
      );
    } finally {
      active.pendingContextProjection = undefined;
      active.resolveSettled();
      if (this.activeRun === active) this.activeRun = undefined;
    }
  }

  async cancel(request: AgentRuntimeCancelRequest): Promise<void> {
    const identity = captureCancelIdentity(request);
    if (identity === undefined) {
      throw this.fail(PI_AGENT_CORE_ADAPTER_FAILURE.invalidRequest);
    }

    const active = this.activeRun;
    if (active === undefined) {
      this.logger.debug("runtime.agent.cancel_ignored", {
        ...identity,
        reason: request.reason,
        state: "idle",
      });
      return;
    }
    if (
      active.request.conversationId !== identity.conversationId ||
      active.request.runId !== identity.runId
    ) {
      throw this.fail(
        PI_AGENT_CORE_ADAPTER_FAILURE.cancellationConflict,
        identity.conversationId,
        identity.runId,
      );
    }
    if (active.sawAgentEnd || active.phase === "settling") {
      await active.settled;
      this.logger.debug("runtime.agent.cancel_ignored", {
        ...identity,
        reason: request.reason,
        state: "settling",
      });
      return;
    }

    active.cancelRequested = true;
    this.logger.info("runtime.agent.cancel_started", {
      ...identity,
      reason: request.reason,
      hasTurn: request.turnId !== undefined,
    });
    if (active.phase === "executing") {
      this.agent.abort();
      await this.waitForIdle(identity);
    }
    await active.settled;
    this.logger.info("runtime.agent.cancel_completed", {
      ...identity,
      reason: request.reason,
    });
  }

  private async handlePiEvent(event: AgentEvent, signal: AbortSignal): Promise<void> {
    const active = this.activeRun;
    if (active === undefined) {
      throw this.fail(PI_AGENT_CORE_ADAPTER_FAILURE.eventBarrier);
    }
    if (active.eventBarrierError !== undefined) throw active.eventBarrierError;

    if (event.type === "turn_start") {
      active.turnNumber += 1;
    }
    if (event.type === "turn_end" && event.message.role === "assistant") {
      active.terminalStopReason = event.message.stopReason;
    }
    if (event.type === "agent_end") {
      active.sawAgentEnd = true;
      active.phase = "settling";
    }

    this.logger.debug("runtime.agent.event_received", {
      conversationId: active.request.conversationId,
      runId: active.request.runId,
      eventType: event.type,
    });
    try {
      await this.eventBridge.handle({
        conversationId: active.request.conversationId,
        runId: active.request.runId,
        event,
        signal,
      });
    } catch {
      const failure = this.fail(
        PI_AGENT_CORE_ADAPTER_FAILURE.eventBarrier,
        active.request.conversationId,
        active.request.runId,
      );
      active.eventBarrierError = failure;
      throw failure;
    }
  }

  private async convertMessages(
    request: CapturedAgentRuntimeStreamRequest,
  ): Promise<{
    readonly context: readonly AgentMessage[];
    readonly prompt: readonly AgentMessage[];
  }> {
    try {
      const context = await this.messageConverter.convert({
        conversationId: request.conversationId,
        runId: request.runId,
        purpose: PI_RUNTIME_MESSAGE_CONVERSION_PURPOSE.context,
        messages: request.context.messages,
      });
      const prompt =
        request.invocation.kind === AGENT_RUNTIME_INVOCATION_KIND.prompt
          ? await this.messageConverter.convert({
              conversationId: request.conversationId,
              runId: request.runId,
              purpose: PI_RUNTIME_MESSAGE_CONVERSION_PURPOSE.prompt,
              messages: request.invocation.messages,
            })
          : [];
      if (!Array.isArray(context) || !Array.isArray(prompt)) {
        throw new TypeError("Pi Runtime Message converter returned a non-array");
      }
      if (
        this.contextProjectionProviderCalls !== undefined &&
        (context.length !== request.context.messages.length ||
          prompt.length !==
            (request.invocation.kind === AGENT_RUNTIME_INVOCATION_KIND.prompt
              ? request.invocation.messages.length
              : 0))
      ) {
        throw new TypeError(
          "Context Projection requires one Pi Message per canonical Runtime Message",
        );
      }
      return Object.freeze({
        context: Object.freeze([...context]),
        prompt: Object.freeze([...prompt]),
      });
    } catch (error) {
      throw this.normalizeFailure(
        error,
        PI_AGENT_CORE_ADAPTER_FAILURE.messageConversion,
        request,
      );
    }
  }

  /**
   * 把 nudge 构造成瞬态 system.reminder 消息并转换为 Pi 消息。
   * Builds a transient system.reminder message from nudge content and converts it
   * to a Pi message for this provider call only (never persisted).
   */
  private async buildTransientReminderMessages(
    content: string,
    request: CapturedAgentRuntimeStreamRequest,
  ): Promise<readonly AgentMessage[]> {
    const order = request.context.messages.length + 1;
    const timestamp =
      request.context.messages.length > 0
        ? request.context.messages[request.context.messages.length - 1]!.timestamp
        : "1970-01-01T00:00:00.000Z";
    const snapshot: RuntimeMessageSnapshot = {
      id: `message:transient:${request.runId}:${order}`,
      conversationId: request.conversationId,
      role: "system",
      messageType: CORE_RUNTIME_MESSAGE_TYPE.systemReminder,
      schemaVersion: RUNTIME_MESSAGE_SCHEMA_VERSION,
      timestamp,
      runId: request.runId,
      payload: {
        kind: "nudge",
        content,
        order,
      },
    };
    return this.messageConverter.convert({
      conversationId: request.conversationId,
      runId: request.runId,
      purpose: PI_RUNTIME_MESSAGE_CONVERSION_PURPOSE.prompt,
      messages: [snapshot],
    });
  }

  private async transformProviderContext(
    messages: AgentMessage[],
    _signal?: AbortSignal,
  ): Promise<AgentMessage[]> {
    const active = this.activeRun;
    const coordinator = this.contextProjectionProviderCalls;
    if (
      !active ||
      active.phase !== "executing" ||
      active.turnNumber < 1 ||
      !coordinator ||
      !active.canonicalRuntimeMessages ||
      !active.canonicalPiMessages ||
      active.pendingContextProjection !== undefined
    ) {
      if (active) this.rememberContextProjectionFailure(active);
      return [...messages];
    }

    const canonicalCount = active.canonicalPiMessages.length;
    if (
      messages.length < canonicalCount ||
      active.canonicalRuntimeMessages.length !== canonicalCount ||
      active.canonicalPiMessages.some(
        (message, index) => messages[index] !== message,
      )
    ) {
      this.rememberContextProjectionFailure(active);
      return [...messages];
    }

    try {
      active.providerCallOrdinal += 1;
      const providerCallId = this.providerCallIdFactory.create({
        conversationId: active.request.conversationId,
        runId: active.request.runId,
        turnNumber: active.turnNumber,
        providerCallOrdinal: active.providerCallOrdinal,
      });
      const result = await coordinator.prepare({
        conversationId: active.request.conversationId,
        runId: active.request.runId,
        providerCallId,
        baseSystemPrompt: active.request.context.systemPrompt,
        canonicalMessages: active.canonicalRuntimeMessages,
        transientMessageCount: messages.length - canonicalCount,
      });
      const selectedIds = new Set(
        result.context.messages.map((message) => message.id),
      );
      const projectedCanonical = active.canonicalPiMessages.filter(
        (_message, index) =>
          selectedIds.has(active.canonicalRuntimeMessages![index]!.id),
      );
      // 投影新增的 compact_summary 等 system.reminder 消息不在 canonical 转换结果里，
      // 需单独转换并插入（保持前缀稳定、不污染 state.messages）。
      // Projection-added system.reminder messages (e.g. compact_summary) are not in
      // the canonical Pi conversion; convert them separately and insert them without
      // touching agent.state.messages.
      const canonicalIds = new Set(
        active.canonicalRuntimeMessages.map((message) => message.id),
      );
      const extraReminderMessages = result.context.messages.filter(
        (message) => !canonicalIds.has(message.id),
      );
      let extraReminderPi: readonly AgentMessage[] = [];
      if (extraReminderMessages.length > 0) {
        extraReminderPi = await this.messageConverter.convert({
          conversationId: active.request.conversationId,
          runId: active.request.runId,
          purpose: PI_RUNTIME_MESSAGE_CONVERSION_PURPOSE.context,
          messages: extraReminderMessages,
        });
      }
      active.pendingContextProjection = Object.freeze({
        providerCallId,
        result,
      });
      this.logger.debug("runtime.agent.context_projection_prepared", {
        conversationId: active.request.conversationId,
        runId: active.request.runId,
        providerCallId,
        turnNumber: active.turnNumber,
        providerCallOrdinal: active.providerCallOrdinal,
        projectedCanonicalMessageCount: projectedCanonical.length,
        transientMessageCount: messages.length - canonicalCount,
        checkpointId: result.projection.checkpointId ?? "none",
        degradationLevel: result.projection.degradationLevel,
      });
      return [
        ...projectedCanonical,
        ...extraReminderPi,
        ...messages.slice(canonicalCount),
      ];
    } catch {
      this.rememberContextProjectionFailure(active);
      return [...messages];
    }
  }

  private async streamProviderCall(
    model: Parameters<StreamFn>[0],
    context: Parameters<StreamFn>[1],
    options: Parameters<StreamFn>[2],
  ): Promise<Awaited<ReturnType<StreamFn>>> {
    const active = this.activeRun;
    const nudgeCoordinator = this.nudgeProviderCalls;
    const projectionCoordinator = this.contextProjectionProviderCalls;
    const checkpointApplications = this.checkpointApplications;
    const dispatchDelegate = this.dispatchAwareStreamFunction;
    if (
      !active ||
      active.phase !== "executing" ||
      active.turnNumber < 1 ||
      (!nudgeCoordinator && !projectionCoordinator) ||
      ((nudgeCoordinator !== undefined || checkpointApplications !== undefined) &&
        dispatchDelegate === undefined)
    ) {
      throw active
        ? this.rememberProviderDispatchFailure(active)
        : this.fail(PI_AGENT_CORE_ADAPTER_FAILURE.providerDispatchProtocol);
    }

    if (active.contextProjectionError !== undefined) {
      throw active.contextProjectionError;
    }
    const pendingProjection = active.pendingContextProjection;
    if (projectionCoordinator && !pendingProjection) {
      throw this.rememberContextProjectionFailure(active);
    }
    if (!projectionCoordinator) active.providerCallOrdinal += 1;
    const providerCallId = pendingProjection?.providerCallId ??
      this.providerCallIdFactory.create({
        conversationId: active.request.conversationId,
        runId: active.request.runId,
        turnNumber: active.turnNumber,
        providerCallOrdinal: active.providerCallOrdinal,
      });
    const requestedAt = this.providerCallClock.now();
    let prepared: PreparedNudgeProviderCall | undefined;
    if (nudgeCoordinator) {
      try {
        prepared = await nudgeCoordinator.prepare({
          conversationId: active.request.conversationId,
          runId: active.request.runId,
          providerCallId,
          targetTurnNumber: active.turnNumber,
          requestedAt,
        });
      } catch {
        throw this.rememberProviderDispatchFailure(active);
      }
    }

    const lifecycle = createDispatchLifecycle(prepared);
    const checkpointId = pendingProjection?.result.projection.checkpointId;
    let dispatchSettled = false;
    const hooks: PiProviderDispatchHooks = Object.freeze({
      onDispatched: async (dispatchedAt = this.providerCallClock.now()) => {
        if (dispatchSettled) return;
        if (prepared && lifecycle.state !== "pending") {
          throw this.rememberProviderDispatchFailure(active);
        }
        dispatchSettled = true;
        if (prepared) lifecycle.state = "dispatched";
        try {
          if (checkpointApplications && checkpointId) {
            await checkpointApplications.confirmDispatched({
              conversationId: active.request.conversationId,
              runId: active.request.runId,
              providerCallId,
              checkpointId,
              dispatchedAt,
            });
          }
          if (prepared) {
            await nudgeCoordinator!.confirmDispatched(prepared, dispatchedAt);
          }
        } catch {
          throw this.rememberProviderDispatchFailure(active);
        }
      },
      onFailedBeforeDispatch: async (failedAt = this.providerCallClock.now()) => {
        if (dispatchSettled) return;
        dispatchSettled = true;
        if (!prepared) return;
        if (lifecycle.state === "released") return;
        if (lifecycle.state !== "pending") {
          throw this.rememberProviderDispatchFailure(active);
        }
        lifecycle.state = "released";
        try {
          await nudgeCoordinator!.releaseBeforeDispatch(prepared, failedAt);
        } catch {
          throw this.rememberProviderDispatchFailure(active);
        }
      },
    });

    // systemPrompt 恒为 base（投影与 nudge 均不再拼入 system prompt）；
    // nudge 作为瞬态 system.reminder 消息注入本次 provider 调用的消息数组，
    // 不进 canonical、不落 state.messages（保持敏感内容脱敏）。
    // The system prompt always stays the base; nudges are injected as transient
    // system.reminder messages into this provider call only, never persisted or
    // written to agent.state.messages (keeping sensitive content redacted).
    const projectedSystemPrompt =
      pendingProjection?.result.context.systemPrompt ?? context.systemPrompt ?? "";
    let transientReminderMessages: readonly AgentMessage[] = [];
    if (prepared) {
      transientReminderMessages = await this.buildTransientReminderMessages(
        prepared.overlay.content,
        active.request,
      );
    }
    const transientMessages = transientReminderMessages as readonly unknown[];
    const providerContext = {
      ...context,
      systemPrompt: projectedSystemPrompt,
      ...(transientMessages.length > 0
        ? {
            messages: [
              ...context.messages,
              ...transientMessages,
            ] as typeof context.messages,
          }
        : {}),
    };
    let response: Awaited<ReturnType<StreamFn>>;
    try {
      response = dispatchDelegate
        ? await dispatchDelegate!(model, providerContext, options, hooks)
        : await this.baseStreamFunction(model, providerContext, options);
    } catch (error) {
      if (prepared && lifecycle.state === "pending") {
        lifecycle.state = "released";
        try {
          await nudgeCoordinator!.releaseBeforeDispatch(
            prepared,
            this.providerCallClock.now(),
          );
        } catch {
          throw this.rememberProviderDispatchFailure(active);
        }
      }
      throw error;
    } finally {
      if (active.pendingContextProjection === pendingProjection) {
        active.pendingContextProjection = undefined;
      }
    }

    if (prepared || (checkpointApplications && checkpointId)) {
      const originalResult = response.result.bind(response);
      let guardedResult: ReturnType<typeof originalResult> | undefined;
      response.result = () => {
        guardedResult ??= (async () => {
          const result = await originalResult();
          if (!dispatchSettled) {
            if (prepared) {
              lifecycle.state = "released";
              await nudgeCoordinator!.releaseBeforeDispatch(
                prepared,
                this.providerCallClock.now(),
              );
            }
            throw this.rememberProviderDispatchFailure(active);
          }
          return result;
        })();
        return guardedResult;
      };
    }
    this.logger.debug("runtime.agent.provider_call_prepared", {
      conversationId: active.request.conversationId,
      runId: active.request.runId,
      providerCallId,
      turnNumber: active.turnNumber,
      providerCallOrdinal: active.providerCallOrdinal,
      hasNudgeOverlay: prepared !== undefined,
      hasCheckpointOverlay:
        pendingProjection?.result.checkpointOverlay !== undefined,
    });
    return response;
  }

  private captureStreamRequest(
    request: AgentRuntimeStreamRequest,
  ): CapturedAgentRuntimeStreamRequest {
    const conversationId = captureNonBlank(request?.conversationId);
    const runId = captureNonBlank(request?.runId);
    if (
      conversationId === undefined ||
      runId === undefined ||
      request.context === null ||
      typeof request.context !== "object" ||
      request.context.conversationId !== conversationId ||
      request.context.runId !== runId ||
      typeof request.context.systemPrompt !== "string" ||
      !Array.isArray(request.context.messages)
    ) {
      throw new TypeError("Agent Runtime stream request is invalid");
    }

    const seenIds = new Set<string>();
    const contextMessages = this.captureMessages(
      request.context.messages,
      conversationId,
      seenIds,
    );
    let invocation: CapturedAgentRuntimeStreamRequest["invocation"];
    if (request.invocation?.kind === AGENT_RUNTIME_INVOCATION_KIND.continue) {
      if (contextMessages.length === 0) {
        throw new TypeError("Continue invocation requires context Messages");
      }
      invocation = Object.freeze({ kind: AGENT_RUNTIME_INVOCATION_KIND.continue });
    } else if (request.invocation?.kind === AGENT_RUNTIME_INVOCATION_KIND.prompt) {
      if (!Array.isArray(request.invocation.messages) || request.invocation.messages.length === 0) {
        throw new TypeError("Prompt invocation requires Messages");
      }
      invocation = Object.freeze({
        kind: AGENT_RUNTIME_INVOCATION_KIND.prompt,
        messages: this.captureMessages(
          request.invocation.messages,
          conversationId,
          seenIds,
        ),
      });
    } else {
      throw new TypeError("Agent Runtime invocation is invalid");
    }

    return Object.freeze({
      conversationId,
      runId,
      context: Object.freeze({
        conversationId,
        runId,
        systemPrompt: request.context.systemPrompt,
        messages: contextMessages,
      }),
      invocation,
    });
  }

  private captureMessages(
    messages: readonly RuntimeMessageSnapshot[],
    conversationId: string,
    seenIds: Set<string>,
  ): readonly RuntimeMessageSnapshot[] {
    const captured = messages.map((message) => {
      const validated = this.messageSchemaRegistry.validateSnapshot(message);
      if (validated.conversationId !== conversationId || seenIds.has(validated.id)) {
        throw new TypeError("Agent Runtime Message identity is invalid");
      }
      seenIds.add(validated.id);
      return deepFreeze(
        JSON.parse(
          canonicalStringifyJson(validated as unknown as JsonValue),
        ) as RuntimeMessageSnapshot,
      );
    });
    return Object.freeze(captured);
  }

  private resolveOutcome(active: ActivePiRun): AgentRuntimeOutcome {
    if (active.cancelRequested) return AGENT_RUNTIME_OUTCOME.cancelled;
    if (
      active.terminalStopReason === "error" ||
      active.terminalStopReason === "aborted" ||
      this.agent.state.errorMessage !== undefined
    ) {
      return AGENT_RUNTIME_OUTCOME.failed;
    }
    return AGENT_RUNTIME_OUTCOME.completed;
  }

  private createResult(
    request: RuntimeIdentity,
    outcome: AgentRuntimeOutcome,
  ): AgentRuntimeStreamResult {
    return Object.freeze({
      conversationId: request.conversationId,
      runId: request.runId,
      outcome,
    });
  }

  private async waitForIdle(identity: RuntimeIdentity): Promise<void> {
    try {
      await this.agent.waitForIdle();
    } catch (error) {
      throw this.normalizeFailure(
        error,
        PI_AGENT_CORE_ADAPTER_FAILURE.cancellation,
        identity,
      );
    }
  }

  private normalizeFailure(
    error: unknown,
    fallback: PiAgentCoreAdapterFailure,
    identity?: Partial<RuntimeIdentity>,
  ): PiAgentCoreAdapterError {
    if (error instanceof PiAgentCoreAdapterError) return error;
    return this.fail(fallback, identity?.conversationId, identity?.runId);
  }

  private rememberProviderDispatchFailure(
    active: ActivePiRun,
  ): PiAgentCoreAdapterError {
    active.providerDispatchProtocolError ??= this.fail(
      PI_AGENT_CORE_ADAPTER_FAILURE.providerDispatchProtocol,
      active.request.conversationId,
      active.request.runId,
    );
    return active.providerDispatchProtocolError;
  }

  private rememberContextProjectionFailure(
    active: ActivePiRun,
  ): PiAgentCoreAdapterError {
    active.contextProjectionError ??= this.fail(
      PI_AGENT_CORE_ADAPTER_FAILURE.contextProjection,
      active.request.conversationId,
      active.request.runId,
    );
    return active.contextProjectionError;
  }

  private fail(
    failure: PiAgentCoreAdapterFailure,
    conversationId?: string,
    runId?: string,
  ): PiAgentCoreAdapterError {
    this.logger.error("runtime.agent.operation_failed", {
      failure,
      ...(conversationId !== undefined ? { conversationId } : {}),
      ...(runId !== undefined ? { runId } : {}),
    });
    return new PiAgentCoreAdapterError(failure, conversationId, runId);
  }
}

interface RuntimeIdentity {
  readonly conversationId: string;
  readonly runId: string;
}

function captureCancelIdentity(
  request: AgentRuntimeCancelRequest,
): RuntimeIdentity | undefined {
  const conversationId = captureNonBlank(request?.conversationId);
  const runId = captureNonBlank(request?.runId);
  const turnId = request?.turnId;
  if (
    conversationId === undefined ||
    runId === undefined ||
    !isExecutionCancellationReason(request?.reason) ||
    (turnId !== undefined && captureNonBlank(turnId) === undefined)
  ) {
    return undefined;
  }
  return Object.freeze({ conversationId, runId });
}

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function createSettlement(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return Object.freeze({ promise, resolve });
}

interface DispatchLifecycle {
  state: "inactive" | "pending" | "dispatched" | "released";
}

function createDispatchLifecycle(
  prepared: PreparedNudgeProviderCall | undefined,
): DispatchLifecycle {
  return { state: prepared ? "pending" : "inactive" };
}
