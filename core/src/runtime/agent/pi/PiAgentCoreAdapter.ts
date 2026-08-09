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
import type { ComposeModeSnapshot } from "../../compose/index.js";
import {
  RUNTIME_POLICY_PHASE,
  type RuntimeEffectCoordinator,
  type RuntimePolicyContext,
  type RuntimePolicyEngine,
  type RuntimePolicyRuntimeSignals,
  type RuntimePolicyState,
} from "../../policy/index.js";
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

export interface PiRuntimeSignalsProvider {
  readonly compose?: () => Promise<ComposeModeSnapshot>;
  readonly todos?: () => Promise<
    Readonly<{ inProgressCount: number; lastUpdatedRunId?: string }> | undefined
  >;
}

export interface PiAgentCoreAdapterOptions {
  agent: PiAgentCoreClient;
  messageConverter: PiRuntimeMessageConverter;
  eventBridge: PiAgentEventBridge;
  messageSchemaRegistry?: RuntimeMessageSchemaRegistry;
  contextProjectionProviderCalls?: ContextProjectionProviderCallCoordinator;
  checkpointApplications?: ContextCheckpointApplicationCoordinator;
  dispatchAwareStreamFunction?: PiDispatchAwareStreamFunction;
  /** 域 runtime 信号源（compose/todo），由装配侧注入；policy 引擎据此求值。 */
  runtimeSignals?: PiRuntimeSignalsProvider;
  policyEngine?: RuntimePolicyEngine;
  effectCoordinator?: RuntimeEffectCoordinator;
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
  /** 本 run 已附加的 reminder（按 reminderId 键、插序），作为瞬态 overlay 注入每次 provider call。 */
  runReminders: Map<string, ActiveRunReminder>;
  turnNumber: number;
  providerCallOrdinal: number;
}

type PiTerminalStopReason =
  | "stop"
  | "length"
  | "toolUse"
  | "error"
  | "aborted";

/** 本 run 已附加的 reminder（瞬态 overlay 回放凭据，不入 journal/canonical）。 */
interface ActiveRunReminder {
  readonly kind: string;
  readonly content: string;
  readonly order: number;
}

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
  private readonly contextProjectionProviderCalls?: ContextProjectionProviderCallCoordinator;
  private readonly checkpointApplications?: ContextCheckpointApplicationCoordinator;
  private readonly dispatchAwareStreamFunction?: PiDispatchAwareStreamFunction;
  private readonly runtimeSignals?: PiRuntimeSignalsProvider;
  private readonly policyEngine?: RuntimePolicyEngine;
  private readonly effectCoordinator?: RuntimeEffectCoordinator;
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
    this.contextProjectionProviderCalls = options.contextProjectionProviderCalls;
    this.checkpointApplications = options.checkpointApplications;
    this.dispatchAwareStreamFunction = options.dispatchAwareStreamFunction;
    this.runtimeSignals = options.runtimeSignals;
    this.policyEngine = options.policyEngine;
    this.effectCoordinator = options.effectCoordinator;
    this.baseStreamFunction = this.agent.streamFunction;
    this.providerCallIdFactory =
      options.providerCallIdFactory ?? new RandomPiProviderCallIdFactory();
    this.providerCallClock = options.providerCallClock ?? systemPiProviderCallClock;
    // checkpoint 上下文投影需要 dispatch hooks（confirmDispatched）。dispatchAwareStreamFunction
    // 可独立于 checkpoint 存在——它是 Pi provider 的真实执行器（PiProviderExecutionFactory
    // 装配），无 checkpoint 时其 hooks 为空操作。
    // Checkpoint context projection requires dispatch hooks (confirmDispatched). The
    // dispatch-aware stream function may exist on its own — it is the real Pi provider
    // dispatcher; without checkpoint applications its hooks are no-ops.
    const hasDispatchAwareStreamFunction =
      this.dispatchAwareStreamFunction !== undefined;
    if (
      this.checkpointApplications !== undefined &&
      !hasDispatchAwareStreamFunction
    ) {
      throw this.fail(PI_AGENT_CORE_ADAPTER_FAILURE.invalidRequest);
    }
    if (
      (this.policyEngine === undefined) !==
      (this.effectCoordinator === undefined)
    ) {
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
      this.policyEngine !== undefined ||
      hasDispatchAwareStreamFunction
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
      runReminders: new Map(),
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
      // 用户取消期间：provider 被 abort 后可能残留桥错误（如 stopping turn 上的
      // message_start 竞态）。取消结局由 resolveOutcome 统一落为 cancelled，吞掉桥
      // 错误即可避免 conversation 崩溃；debug 级、不含原始 error 内容（脱敏）。
      if (active.cancelRequested) {
        this.logger.debug("runtime.agent.event_barrier_deferred_cancellation", {
          conversationId: active.request.conversationId,
          runId: active.request.runId,
        });
        return;
      }
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
   * 把本 run 已附加的 reminders 构造成瞬态 system.reminder 消息并转换为 Pi 消息。
   * Builds transient system.reminder messages from the run's attached reminders and
   * converts them to Pi messages for this provider call only (never persisted).
   */
  private async buildTransientReminderMessages(
    reminders: ReadonlyMap<string, ActiveRunReminder>,
    request: CapturedAgentRuntimeStreamRequest,
  ): Promise<readonly AgentMessage[]> {
    const baseOrder = request.context.messages.length + 1;
    const timestamp =
      request.context.messages.length > 0
        ? request.context.messages[request.context.messages.length - 1]!.timestamp
        : "1970-01-01T00:00:00.000Z";
    const snapshots: RuntimeMessageSnapshot[] = [];
    let index = 0;
    for (const reminder of reminders.values()) {
      index += 1;
      snapshots.push({
        id: `message:transient:${request.runId}:${baseOrder + index}`,
        conversationId: request.conversationId,
        role: "system",
        messageType: CORE_RUNTIME_MESSAGE_TYPE.systemReminder,
        schemaVersion: RUNTIME_MESSAGE_SCHEMA_VERSION,
        timestamp,
        runId: request.runId,
        payload: {
          kind: reminder.kind,
          content: reminder.content,
          order: reminder.order,
        },
      });
    }
    if (snapshots.length === 0) return [];
    return this.messageConverter.convert({
      conversationId: request.conversationId,
      runId: request.runId,
      purpose: PI_RUNTIME_MESSAGE_CONVERSION_PURPOSE.prompt,
      messages: snapshots,
    });
  }

  /**
   * 对本次 provider call 求值 runtime policies 并执行其效果。
   * providerCallCount 取本 run 内 provider call 序号（与 cooldown 参考值同源）。
   */
  private async evaluateRuntimePolicies(
    active: ActivePiRun,
    providerCallId: string,
    evaluatedAt: string,
  ): Promise<void> {
    const runtimeSignals: RuntimePolicyRuntimeSignals = {
      providerCallCount: active.providerCallOrdinal,
      ...(this.runtimeSignals?.compose
        ? { compose: await this.runtimeSignals.compose() }
        : {}),
      ...(this.runtimeSignals?.todos
        ? { todos: await this.runtimeSignals.todos() }
        : {}),
    };
    const context: RuntimePolicyContext = {
      phase: RUNTIME_POLICY_PHASE.beforeProviderCall,
      conversationId: active.request.conversationId,
      runId: active.request.runId,
      providerCallId,
      evaluatedAt,
      runtimeSignals,
    };
    const state: RuntimePolicyState = {
      conversationId: active.request.conversationId,
    };
    const effects = this.policyEngine!.evaluate(context, state);
    const receipt = await this.effectCoordinator!.execute({ context, effects });
    // 同 run 注入：本次调用附加的 reminder 记入 runReminders，后续每次 provider call
    // 尾部作为瞬态 system.reminder 回放（不入 journal/canonical/state.messages）。
    // In-run injection: attach this call's reminders into runReminders so later
    // provider calls replay them as transient system.reminder overlay.
    for (const attachment of receipt.attachedReminders) {
      active.runReminders.set(attachment.reminderId, {
        kind: attachment.kind,
        content: attachment.content,
        order: attachment.order,
      });
    }
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
    const projectionCoordinator = this.contextProjectionProviderCalls;
    const checkpointApplications = this.checkpointApplications;
    const dispatchDelegate = this.dispatchAwareStreamFunction;
    if (
      !active ||
      active.phase !== "executing" ||
      active.turnNumber < 1 ||
      (!projectionCoordinator &&
        !this.policyEngine &&
        !this.dispatchAwareStreamFunction) ||
      (checkpointApplications !== undefined && dispatchDelegate === undefined)
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
    // policy 引擎先行：求值 + 执行效果（system_reminder_attach → 持久化事件 +
    // runReminders 注入）。触发后的当次及后续 provider call 尾部都会带上瞬态 overlay。
    if (this.policyEngine && this.effectCoordinator) {
      try {
        await this.evaluateRuntimePolicies(active, providerCallId, requestedAt);
      } catch {
        throw this.rememberProviderDispatchFailure(active);
      }
    }

    const checkpointId = pendingProjection?.result.projection.checkpointId;
    let dispatchSettled = false;
    const hooks: PiProviderDispatchHooks = Object.freeze({
      onDispatched: async (dispatchedAt = this.providerCallClock.now()) => {
        if (dispatchSettled) return;
        dispatchSettled = true;
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
        } catch {
          throw this.rememberProviderDispatchFailure(active);
        }
      },
      onFailedBeforeDispatch: async () => {
        if (dispatchSettled) return;
        dispatchSettled = true;
      },
    });

    // systemPrompt 恒为 base（投影与 reminders 均不再拼入 system prompt）；
    // reminders 作为瞬态 system.reminder 消息注入本次 provider 调用的消息数组尾部，
    // 不进 canonical、不落 state.messages（保持敏感内容脱敏、prefill 前缀稳定）。
    // The system prompt always stays the base; reminders are injected as transient
    // system.reminder messages at the tail of this provider call only, never
    // persisted or written to agent.state.messages (keeping prefill prefix stable).
    const projectedSystemPrompt =
      pendingProjection?.result.context.systemPrompt ?? context.systemPrompt ?? "";
    let transientReminderMessages: readonly AgentMessage[] = [];
    if (active.runReminders.size > 0) {
      transientReminderMessages = await this.buildTransientReminderMessages(
        active.runReminders,
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
      throw error;
    } finally {
      if (active.pendingContextProjection === pendingProjection) {
        active.pendingContextProjection = undefined;
      }
    }

    if (checkpointApplications && checkpointId) {
      const originalResult = response.result.bind(response);
      let guardedResult: ReturnType<typeof originalResult> | undefined;
      response.result = () => {
        guardedResult ??= (async () => {
          const result = await originalResult();
          if (!dispatchSettled) {
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
      hasReminderOverlay: active.runReminders.size > 0,
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
