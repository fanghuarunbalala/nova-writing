/** Routes redacted Runtime facts through Policy review into Nudge service ports. */
import {
  OUTPUT_EVENT_TYPE,
  type OutputEventSnapshot,
} from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  NUDGE_ACKNOWLEDGEMENT_SOURCE,
  type NudgeAcknowledgementPort,
} from "./NudgeAcknowledgementPort.js";
import type { NudgeConditionPort } from "./NudgeConditionPort.js";
import type {
  NudgeAcknowledgementReference,
  NudgeConditionReference,
} from "./NudgeProtocol.js";

export const NUDGE_RUNTIME_OBSERVATION_SOURCE = {
  toolResult: "tool_result",
  approvalDecision: "approval_decision",
  subagentTerminal: "subagent_terminal",
} as const;

export type NudgeRuntimeObservationSource =
  (typeof NUDGE_RUNTIME_OBSERVATION_SOURCE)[keyof typeof NUDGE_RUNTIME_OBSERVATION_SOURCE];

export interface NudgeEventAcknowledgementEffect {
  readonly kind: "acknowledge";
  readonly nudgeId: string;
  readonly targetRunId: string;
  readonly acknowledgementRef: NudgeAcknowledgementReference;
  readonly reasonId?: string;
}

export interface NudgeEventConditionEffect {
  readonly kind: "resolve_condition";
  readonly nudgeId: string;
  readonly targetRunId: string;
  readonly conditionRef: NudgeConditionReference;
  readonly currentTurnNumber?: number;
  readonly childConversationId?: string;
}

export type NudgeRuntimeEventEffect =
  | NudgeEventAcknowledgementEffect
  | NudgeEventConditionEffect;

export interface NudgeRuntimeEventPolicy {
  review(input: {
    readonly source: NudgeRuntimeObservationSource;
    readonly event: OutputEventSnapshot;
  }): readonly NudgeRuntimeEventEffect[];
}

export interface NudgeRuntimeEventBridgeOptions {
  readonly acknowledgementPort: NudgeAcknowledgementPort;
  readonly conditionPort: NudgeConditionPort;
  readonly policy: NudgeRuntimeEventPolicy;
  readonly logger?: Logger;
}

export interface NudgeRuntimeEventBridgeReceipt {
  readonly eventId: string;
  readonly conversationId: string;
  readonly runId: string;
  readonly source: NudgeRuntimeObservationSource;
  readonly effectCount: number;
}

export class NudgeRuntimeEventBridge {
  private readonly acknowledgementPort: NudgeAcknowledgementPort;
  private readonly conditionPort: NudgeConditionPort;
  private readonly policy: NudgeRuntimeEventPolicy;
  private readonly logger: Logger;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: NudgeRuntimeEventBridgeOptions) {
    this.acknowledgementPort = options.acknowledgementPort;
    this.conditionPort = options.conditionPort;
    this.policy = options.policy;
    this.logger = (options.logger ?? noopLogger).child({
      component: "nudge_runtime_event_bridge",
    });
  }

  async observe(event: OutputEventSnapshot): Promise<NudgeRuntimeEventBridgeReceipt | undefined> {
    const captured = captureEvent(event);
    const source = resolveSource(captured);
    if (!source) return undefined;
    const effects = captureEffects(this.policy.review({ source, event: captured }));
    return this.serialize(async () => {
      for (const effect of effects) {
        assertEffectOwnership(effect, captured, source);
        if (effect.kind === "acknowledge") {
          await this.acknowledgementPort.acknowledge({
            nudgeId: effect.nudgeId,
            targetRunId: effect.targetRunId,
            acknowledgementRef: effect.acknowledgementRef,
            source: source === NUDGE_RUNTIME_OBSERVATION_SOURCE.toolResult
              ? NUDGE_ACKNOWLEDGEMENT_SOURCE.toolResult
              : source === NUDGE_RUNTIME_OBSERVATION_SOURCE.approvalDecision
                ? NUDGE_ACKNOWLEDGEMENT_SOURCE.approvalDecision
                : NUDGE_ACKNOWLEDGEMENT_SOURCE.subagentTerminal,
            ...(effect.reasonId === undefined ? {} : { reasonId: effect.reasonId }),
            acknowledgedAt: captured.timestamp,
          });
        } else {
          await this.conditionPort.resolve({
            nudgeId: effect.nudgeId,
            targetRunId: effect.targetRunId,
            conditionRef: effect.conditionRef,
            evaluatedAt: captured.timestamp,
            ...(effect.currentTurnNumber === undefined
              ? {}
              : { currentTurnNumber: effect.currentTurnNumber }),
          });
        }
      }
      const receipt = Object.freeze({
        eventId: captured.id,
        conversationId: captured.conversationId,
        runId: captured.runId!,
        source,
        effectCount: effects.length,
      });
      this.logger.info("runtime.nudge.event_observed", receipt);
      return receipt;
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

function captureEvent(event: OutputEventSnapshot): OutputEventSnapshot {
  if (
    event === null ||
    typeof event !== "object" ||
    !nonBlank(event.id) ||
    !nonBlank(event.conversationId) ||
    !nonBlank(event.eventType) ||
    !nonBlank(event.runId) ||
    !isTimestamp(event.timestamp) ||
    event.payload === null ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) throw new Error("Invalid Runtime event observation");
  return Object.freeze({ ...event, payload: Object.freeze({ ...event.payload }) });
}

function resolveSource(
  event: OutputEventSnapshot,
): NudgeRuntimeObservationSource | undefined {
  if (
    event.eventType === OUTPUT_EVENT_TYPE.toolTraceRecorded &&
    event.payload.stage === "execution_completed"
  ) return NUDGE_RUNTIME_OBSERVATION_SOURCE.toolResult;
  if (event.eventType === OUTPUT_EVENT_TYPE.toolApprovalResolved) {
    return NUDGE_RUNTIME_OBSERVATION_SOURCE.approvalDecision;
  }
  if (
    event.eventType === OUTPUT_EVENT_TYPE.subagentCompleted ||
    event.eventType === OUTPUT_EVENT_TYPE.subagentFailed ||
    event.eventType === OUTPUT_EVENT_TYPE.subagentCancelled
  ) return NUDGE_RUNTIME_OBSERVATION_SOURCE.subagentTerminal;
  return undefined;
}

function captureEffects(value: readonly NudgeRuntimeEventEffect[]): readonly NudgeRuntimeEventEffect[] {
  if (!Array.isArray(value)) throw new Error("Invalid Nudge event effects");
  return Object.freeze(value.map((effect) => {
    if (!effect || typeof effect !== "object") throw new Error("Invalid Nudge event effect");
    const nudgeId = requireNonBlank(effect.nudgeId);
    const targetRunId = requireNonBlank(effect.targetRunId);
    if (effect.kind === "acknowledge") {
      return Object.freeze({
        kind: effect.kind,
        nudgeId,
        targetRunId,
        acknowledgementRef: captureReference(effect.acknowledgementRef),
        ...(effect.reasonId === undefined
          ? {}
          : { reasonId: requireNonBlank(effect.reasonId) }),
      });
    }
    if (effect.kind !== "resolve_condition") throw new Error("Invalid Nudge event effect");
    return Object.freeze({
      kind: effect.kind,
      nudgeId,
      targetRunId,
      conditionRef: captureReference(effect.conditionRef),
      ...(effect.currentTurnNumber === undefined
        ? {}
        : { currentTurnNumber: requirePositiveInteger(effect.currentTurnNumber) }),
      ...(effect.childConversationId === undefined
        ? {}
        : { childConversationId: requireNonBlank(effect.childConversationId) }),
    });
  }));
}

function assertEffectOwnership(
  effect: NudgeRuntimeEventEffect,
  event: OutputEventSnapshot,
  source: NudgeRuntimeObservationSource,
): void {
  if (effect.targetRunId !== event.runId) throw new Error("Nudge event Run ownership is invalid");
  if (source !== NUDGE_RUNTIME_OBSERVATION_SOURCE.subagentTerminal) {
    if (effect.kind === "resolve_condition" && effect.childConversationId !== undefined) {
      throw new Error("Nudge child ownership is invalid");
    }
    return;
  }
  const childConversationId = event.payload.childConversationId;
  if (
    typeof childConversationId !== "string" ||
    childConversationId === event.conversationId ||
    effect.kind !== "resolve_condition" ||
    effect.childConversationId !== childConversationId
  ) throw new Error("Nudge child ownership is invalid");
}

function captureReference(value: unknown): { readonly id: string; readonly version: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
  const record = value as Record<string, unknown>;
  return Object.freeze({
    id: requireNonBlank(record.id),
    version: requireNonBlank(record.version),
  });
}

function requireNonBlank(value: unknown): string {
  if (!nonBlank(value)) throw new Error("Invalid Nudge event identity");
  return value;
}

function requirePositiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error();
  return value as number;
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
