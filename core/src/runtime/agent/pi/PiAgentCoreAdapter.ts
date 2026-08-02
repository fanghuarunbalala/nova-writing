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
import { isExecutionCancellationReason } from "../../execution/ExecutionCancellationReason.js";
import type {
  NudgeProviderCallCoordinator,
  PreparedNudgeProviderCall,
} from "../../nudge/index.js";
import {
  coreRuntimeMessageSchemaRegistry,
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

export class PiAgentCoreAdapter implements AgentRuntimeAdapter {
  private readonly agent: PiAgentCoreClient;
  private readonly messageConverter: PiRuntimeMessageConverter;
  private readonly eventBridge: PiAgentEventBridge;
  private readonly messageSchemaRegistry: RuntimeMessageSchemaRegistry;
  private readonly nudgeProviderCalls?: NudgeProviderCallCoordinator;
  private readonly dispatchAwareStreamFunction?: PiDispatchAwareStreamFunction;
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
    this.dispatchAwareStreamFunction = options.dispatchAwareStreamFunction;
    this.providerCallIdFactory =
      options.providerCallIdFactory ?? new RandomPiProviderCallIdFactory();
    this.providerCallClock = options.providerCallClock ?? systemPiProviderCallClock;
    if (
      (this.nudgeProviderCalls === undefined) !==
      (this.dispatchAwareStreamFunction === undefined)
    ) {
      throw this.fail(PI_AGENT_CORE_ADAPTER_FAILURE.invalidRequest);
    }
    if (this.nudgeProviderCalls && this.dispatchAwareStreamFunction) {
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
      active.phase = "executing";
      if (captured.invocation.kind === AGENT_RUNTIME_INVOCATION_KIND.prompt) {
        await this.agent.prompt([...converted.prompt]);
      } else {
        await this.agent.continue();
      }
      if (active.providerDispatchProtocolError !== undefined) {
        throw active.providerDispatchProtocolError;
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

  private async streamProviderCall(
    model: Parameters<StreamFn>[0],
    context: Parameters<StreamFn>[1],
    options: Parameters<StreamFn>[2],
  ): Promise<Awaited<ReturnType<StreamFn>>> {
    const active = this.activeRun;
    const coordinator = this.nudgeProviderCalls;
    const delegate = this.dispatchAwareStreamFunction;
    if (
      !active ||
      active.phase !== "executing" ||
      active.turnNumber < 1 ||
      !coordinator ||
      !delegate
    ) {
      throw active
        ? this.rememberProviderDispatchFailure(active)
        : this.fail(PI_AGENT_CORE_ADAPTER_FAILURE.providerDispatchProtocol);
    }

    active.providerCallOrdinal += 1;
    const requestedAt = this.providerCallClock.now();
    const providerCallId = this.providerCallIdFactory.create({
      conversationId: active.request.conversationId,
      runId: active.request.runId,
      turnNumber: active.turnNumber,
      providerCallOrdinal: active.providerCallOrdinal,
    });
    let prepared: PreparedNudgeProviderCall | undefined;
    try {
      prepared = await coordinator.prepare({
        conversationId: active.request.conversationId,
        runId: active.request.runId,
        providerCallId,
        targetTurnNumber: active.turnNumber,
        requestedAt,
      });
    } catch {
      throw this.rememberProviderDispatchFailure(active);
    }

    const lifecycle = createDispatchLifecycle(prepared);
    const hooks: PiProviderDispatchHooks = Object.freeze({
      onDispatched: async (dispatchedAt = this.providerCallClock.now()) => {
        if (!prepared) return;
        if (lifecycle.state === "dispatched") return;
        if (lifecycle.state !== "pending") {
          throw this.rememberProviderDispatchFailure(active);
        }
        lifecycle.state = "dispatched";
        try {
          await coordinator.confirmDispatched(prepared, dispatchedAt);
        } catch {
          throw this.rememberProviderDispatchFailure(active);
        }
      },
      onFailedBeforeDispatch: async (failedAt = this.providerCallClock.now()) => {
        if (!prepared) return;
        if (lifecycle.state === "released") return;
        if (lifecycle.state !== "pending") {
          throw this.rememberProviderDispatchFailure(active);
        }
        lifecycle.state = "released";
        try {
          await coordinator.releaseBeforeDispatch(prepared, failedAt);
        } catch {
          throw this.rememberProviderDispatchFailure(active);
        }
      },
    });

    const providerContext = prepared
      ? {
          ...context,
          systemPrompt: appendSystemPromptOverlay(
            context.systemPrompt ?? "",
            prepared.overlay.content,
          ),
        }
      : context;
    let response: Awaited<ReturnType<StreamFn>>;
    try {
      response = await delegate(model, providerContext, options, hooks);
    } catch (error) {
      if (prepared && lifecycle.state === "pending") {
        lifecycle.state = "released";
        try {
          await coordinator.releaseBeforeDispatch(
            prepared,
            this.providerCallClock.now(),
          );
        } catch {
          throw this.rememberProviderDispatchFailure(active);
        }
      }
      throw error;
    }

    if (prepared) {
      const originalResult = response.result.bind(response);
      let guardedResult: ReturnType<typeof originalResult> | undefined;
      response.result = () => {
        guardedResult ??= (async () => {
          const result = await originalResult();
          if (lifecycle.state === "pending") {
            lifecycle.state = "released";
            await coordinator.releaseBeforeDispatch(
              prepared,
              this.providerCallClock.now(),
            );
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

function appendSystemPromptOverlay(base: string, overlay: string): string {
  return base.length === 0 ? overlay : `${base}\n\n${overlay}`;
}
