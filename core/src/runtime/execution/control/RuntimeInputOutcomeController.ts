/** Persistence-first controller for one terminal Runtime outcome per InputEvent. */
import {
  captureDurableInputEventReference,
  type DurableInputEventReference,
} from "../../../event/input/DurableInputEventReference.js";
import {
  OUTPUT_EVENT_TYPE,
  RuntimeInputProcessedPayload,
  RuntimeInputProcessedOutputEvent,
  type RuntimeInputProcessedPayloadOptions,
  type RuntimeInputProcessingOutcome,
} from "../../../event/output/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { RuntimeEventIdFactory } from "../event/RuntimeEventIdFactory.js";
import type {
  RuntimeEventAppendReceipt,
  RuntimeEventSink,
} from "../event/RuntimeEventSink.js";
import {
  RuntimeInputOutcomeConflictError,
  RuntimeInputOutcomeControllerStateError,
  RuntimeInputOutcomePendingCommitError,
} from "./RuntimeInputOutcomeControllerErrors.js";

export interface RuntimeInputOutcomeClock {
  now(): string;
}

export class SystemRuntimeInputOutcomeClock implements RuntimeInputOutcomeClock {
  now(): string {
    return new Date().toISOString();
  }
}

export interface RuntimeInputOutcomeMetadata {
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly runId?: string;
  readonly turnId?: string;
}

export type RecordRuntimeInputOutcomeOptions = RuntimeInputProcessedPayloadOptions &
  RuntimeInputOutcomeMetadata & {
    readonly inputEvent: DurableInputEventReference;
  };

export interface RuntimeInputOutcomeCommit {
  readonly inputEvent: DurableInputEventReference;
  readonly outcome: RuntimeInputProcessingOutcome;
  readonly receipt: RuntimeEventAppendReceipt;
}

export interface PendingRuntimeInputOutcomeSnapshot {
  readonly eventId: string;
  readonly eventType: string;
  readonly inputEvent: DurableInputEventReference;
  readonly outcome: RuntimeInputProcessingOutcome;
}

export interface RuntimeInputOutcomeControllerOptions {
  conversationId: string;
  eventIdFactory: RuntimeEventIdFactory;
  eventSink: RuntimeEventSink;
  clock?: RuntimeInputOutcomeClock;
  logger?: Logger;
}

interface CapturedOutcomeRequest {
  readonly inputEvent: DurableInputEventReference;
  readonly payload: RuntimeInputProcessedPayloadOptions;
  readonly metadata: RuntimeInputOutcomeMetadata;
  readonly fingerprint: string;
}

interface PendingCommit {
  readonly event: RuntimeInputProcessedOutputEvent;
  readonly request: CapturedOutcomeRequest;
}

interface CompletedCommit {
  readonly fingerprint: string;
  readonly commit: RuntimeInputOutcomeCommit;
}

export class RuntimeInputOutcomeController {
  private readonly conversationId: string;
  private readonly eventIdFactory: RuntimeEventIdFactory;
  private readonly eventSink: RuntimeEventSink;
  private readonly clock: RuntimeInputOutcomeClock;
  private readonly logger: Logger;
  private readonly completed = new Map<string, CompletedCommit>();
  private tail: Promise<void> = Promise.resolve();
  private pending?: PendingCommit;

  constructor(options: RuntimeInputOutcomeControllerOptions) {
    assertNonBlank(options.conversationId, "conversation_id_invalid");
    this.conversationId = options.conversationId;
    this.eventIdFactory = options.eventIdFactory;
    this.eventSink = options.eventSink;
    this.clock = options.clock ?? new SystemRuntimeInputOutcomeClock();
    this.logger = (options.logger ?? noopLogger).child({
      component: "runtime_input_outcome_controller",
      conversationId: this.conversationId,
    });
  }

  getPendingCommit(): PendingRuntimeInputOutcomeSnapshot | undefined {
    if (this.pending === undefined) return undefined;
    return Object.freeze({
      eventId: this.pending.event.id,
      eventType: this.pending.event.getEventType(),
      inputEvent: this.pending.request.inputEvent,
      outcome: this.pending.request.payload.outcome,
    });
  }

  hasCompleted(inputEventId: string): boolean {
    return this.completed.has(inputEventId);
  }

  record(options: RecordRuntimeInputOutcomeOptions): Promise<RuntimeInputOutcomeCommit> {
    return this.serialize(async () => {
      this.assertNoPending();
      const request = captureRequest(options);
      const completed = this.completed.get(request.inputEvent.id);
      if (completed !== undefined) {
        if (completed.fingerprint !== request.fingerprint) {
          throw new RuntimeInputOutcomeConflictError(request.inputEvent.id);
        }
        this.logger.debug("runtime.input.outcome_reused", {
          inputEventId: request.inputEvent.id,
          inputEventType: request.inputEvent.eventType,
          inputSequence: request.inputEvent.sequence,
          outcome: completed.commit.outcome,
          eventId: completed.commit.receipt.eventId,
          sequence: completed.commit.receipt.sequence,
        });
        return completed.commit;
      }

      const event = this.createEvent(request);
      const pending = Object.freeze({ event, request });
      this.pending = pending;
      return this.flushPending(pending);
    });
  }

  retryPending(): Promise<RuntimeInputOutcomeCommit> {
    return this.serialize(async () => {
      if (this.pending === undefined) {
        throw new RuntimeInputOutcomeControllerStateError("no_pending_commit");
      }
      return this.flushPending(this.pending);
    });
  }

  private createEvent(request: CapturedOutcomeRequest): RuntimeInputProcessedOutputEvent {
    return new RuntimeInputProcessedOutputEvent({
      conversationId: this.conversationId,
      id: this.eventIdFactory.create({
        conversationId: this.conversationId,
        eventType: OUTPUT_EVENT_TYPE.runtimeInputProcessed,
        scope: "input",
        inputEventId: request.inputEvent.id,
        ordinal: 0,
      }),
      timestamp: this.clock.now(),
      inputEvent: request.inputEvent,
      ...request.payload,
      ...(request.metadata.correlationId !== undefined
        ? { correlationId: request.metadata.correlationId }
        : {}),
      ...(request.metadata.causationId !== undefined
        ? { causationId: request.metadata.causationId }
        : {}),
      ...(request.metadata.runId !== undefined ? { runId: request.metadata.runId } : {}),
      ...(request.metadata.turnId !== undefined
        ? { turnId: request.metadata.turnId }
        : {}),
    } as ConstructorParameters<typeof RuntimeInputProcessedOutputEvent>[0]);
  }

  private async flushPending(pending: PendingCommit): Promise<RuntimeInputOutcomeCommit> {
    this.logger.debug("runtime.input.outcome_commit_started", {
      inputEventId: pending.request.inputEvent.id,
      inputEventType: pending.request.inputEvent.eventType,
      inputSequence: pending.request.inputEvent.sequence,
      outcome: pending.request.payload.outcome,
      eventId: pending.event.id,
      eventType: pending.event.getEventType(),
    });
    const receipt = await this.eventSink.append(pending.event);
    const commit = Object.freeze({
      inputEvent: pending.request.inputEvent,
      outcome: pending.request.payload.outcome,
      receipt,
    });
    this.completed.set(pending.request.inputEvent.id, {
      fingerprint: pending.request.fingerprint,
      commit,
    });
    if (this.pending === pending) this.pending = undefined;
    this.logger.info("runtime.input.outcome_commit_completed", {
      inputEventId: pending.request.inputEvent.id,
      inputEventType: pending.request.inputEvent.eventType,
      inputSequence: pending.request.inputEvent.sequence,
      outcome: commit.outcome,
      eventId: pending.event.id,
      eventType: pending.event.getEventType(),
      sequence: receipt.sequence,
      status: receipt.status,
    });
    return commit;
  }

  private assertNoPending(): void {
    if (this.pending !== undefined) throw new RuntimeInputOutcomePendingCommitError();
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function captureRequest(options: RecordRuntimeInputOutcomeOptions): CapturedOutcomeRequest {
  const inputEvent = captureDurableInputEventReference(options.inputEvent);
  const metadata = captureMetadata(options);
  if (options.outcome === "cancelled_before_run" && metadata.runId !== undefined) {
    throw new RuntimeInputOutcomeControllerStateError("cancelled_input_has_run");
  }
  const payload = capturePayload(options);
  return Object.freeze({
    inputEvent,
    payload,
    metadata,
    fingerprint: JSON.stringify([
      inputEvent.id,
      inputEvent.eventType,
      inputEvent.sequence,
      payload.outcome,
      "cancellationReason" in payload ? payload.cancellationReason : null,
      "failureCode" in payload ? payload.failureCode : null,
      metadata.correlationId ?? null,
      metadata.causationId ?? null,
      metadata.runId ?? null,
      metadata.turnId ?? null,
    ]),
  });
}

function capturePayload(
  options: RecordRuntimeInputOutcomeOptions,
): RuntimeInputProcessedPayloadOptions {
  new RuntimeInputProcessedPayload(options);
  if (options.outcome === "cancelled_before_run") {
    return Object.freeze({
      outcome: options.outcome,
      cancellationReason: options.cancellationReason,
    });
  }
  if (options.outcome === "failed") {
    return Object.freeze({
      outcome: options.outcome,
      failureCode: options.failureCode,
    });
  }
  if (options.outcome !== "consumed") {
    throw new RuntimeInputOutcomeControllerStateError("invalid_outcome");
  }
  return Object.freeze({ outcome: options.outcome });
}

function captureMetadata(options: RuntimeInputOutcomeMetadata): RuntimeInputOutcomeMetadata {
  assertOptionalIdentifier(options.correlationId, "correlation_id_invalid");
  assertOptionalIdentifier(options.causationId, "causation_id_invalid");
  assertOptionalIdentifier(options.runId, "run_id_invalid");
  assertOptionalIdentifier(options.turnId, "turn_id_invalid");
  if (options.turnId !== undefined && options.runId === undefined) {
    throw new RuntimeInputOutcomeControllerStateError("turn_without_run");
  }
  return Object.freeze({
    ...(options.correlationId !== undefined
      ? { correlationId: options.correlationId }
      : {}),
    ...(options.causationId !== undefined ? { causationId: options.causationId } : {}),
    ...(options.runId !== undefined ? { runId: options.runId } : {}),
    ...(options.turnId !== undefined ? { turnId: options.turnId } : {}),
  });
}

function assertOptionalIdentifier(value: string | undefined, reason: string): void {
  if (value !== undefined) assertNonBlank(value, reason);
}

function assertNonBlank(value: string, reason: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RuntimeInputOutcomeControllerStateError(reason);
  }
}
