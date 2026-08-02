/** Async reference Store enforcing immutable Checkpoint activation and attempt dedupe. */
import {
  canonicalStringifyJson,
  isJsonValue,
  type JsonValue,
} from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  CONTEXT_COMPACTION_OUTCOME,
  type ContextCompactionAttemptIdentity,
} from "./ContextCompactionProtocol.js";
import {
  captureContextCompactionAssessment,
  captureContextCompactionAttemptIdentity,
} from "./ContextCompactionProtocolValidator.js";
import { captureContextCheckpoint } from "./ContextCheckpointValidator.js";
import type { ContextCheckpoint } from "./ContextCheckpoint.js";
import type {
  ContextCheckpointStore,
  ContextCompactionAttemptFailureRequest,
  ContextCompactionAttemptFinalization,
  ContextCompactionAttemptReservation,
  ContextCompactionFailureResult,
  ContextCompactionFinalizationResult,
} from "./ContextCheckpointStore.js";
import {
  CONTEXT_CHECKPOINT_STORE_FAILURE,
  ContextCheckpointStoreError,
  type ContextCheckpointStoreFailure,
} from "./ContextCheckpointStoreErrors.js";
import {
  CONTEXT_COMPACTION_ATTEMPT_FAILURE,
  CONTEXT_COMPACTION_ATTEMPT_STATUS,
  CONTEXT_COMPACTION_RESERVATION_OUTCOME,
  type ContextCompactionAttemptFailure,
  type ContextCompactionAttemptRecord,
  type ContextCompactionReservationResult,
} from "./ContextCompactionManagerProtocol.js";

const ATTEMPT_FAILURES = new Set(
  Object.values(CONTEXT_COMPACTION_ATTEMPT_FAILURE),
);

export interface InMemoryContextCheckpointStoreOptions {
  readonly logger?: Logger;
}

export class InMemoryContextCheckpointStore implements ContextCheckpointStore {
  private readonly activeCheckpoints = new Map<string, ContextCheckpoint>();
  private readonly checkpoints = new Map<string, ContextCheckpoint>();
  private readonly attempts = new Map<string, ContextCompactionAttemptRecord>();
  private readonly logger: Logger;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: InMemoryContextCheckpointStoreOptions = {}) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "in_memory_context_checkpoint_store",
    });
  }

  getActive(conversationId: string): Promise<ContextCheckpoint | undefined> {
    return this.run(() => {
      if (!isNonBlank(conversationId)) {
        throw this.failure(
          CONTEXT_CHECKPOINT_STORE_FAILURE.invalidConversation,
        );
      }
      return this.activeCheckpoints.get(conversationId);
    });
  }

  reserveAttempt(
    request: ContextCompactionAttemptReservation,
  ): Promise<ContextCompactionReservationResult> {
    return this.run(() => {
      let captured: ContextCompactionAttemptRecord;
      try {
        const identity = captureContextCompactionAttemptIdentity(request?.identity);
        const runId = requireNonBlank(request?.runId);
        const providerCallId = requireNonBlank(request?.providerCallId);
        const requestedAt = requireTimestamp(request?.requestedAt);
        const expectedParentCheckpointId = captureOptionalNonBlank(
          request?.expectedParentCheckpointId,
        );
        const active = this.activeCheckpoints.get(identity.conversationId);
        if ((active?.id ?? undefined) !== expectedParentCheckpointId) {
          throw this.failure(
            CONTEXT_CHECKPOINT_STORE_FAILURE.activationConflict,
            identity.conversationId,
            expectedParentCheckpointId,
          );
        }
        captured = Object.freeze({
          identity,
          runId,
          providerCallId,
          requestedAt,
          ...(expectedParentCheckpointId === undefined
            ? {}
            : { expectedParentCheckpointId }),
          status: CONTEXT_COMPACTION_ATTEMPT_STATUS.reserved,
        });
      } catch (error) {
        if (error instanceof ContextCheckpointStoreError) throw error;
        throw this.failure(
          CONTEXT_CHECKPOINT_STORE_FAILURE.invalidReservation,
          captureConversationId(request?.identity),
        );
      }

      const key = attemptKey(captured.identity);
      const existing = this.attempts.get(key);
      if (existing !== undefined) {
        this.logger.debug("runtime.context.compaction_attempt_duplicate", {
          conversationId: existing.identity.conversationId,
          runId: captured.runId,
          providerCallId: captured.providerCallId,
          attemptStatus: existing.status,
        });
        return Object.freeze({
          outcome: CONTEXT_COMPACTION_RESERVATION_OUTCOME.duplicate,
          attempt: existing,
        });
      }
      this.attempts.set(key, captured);
      this.logger.info("runtime.context.compaction_attempt_reserved", {
        conversationId: captured.identity.conversationId,
        runId: captured.runId,
        providerCallId: captured.providerCallId,
      });
      return Object.freeze({
        outcome: CONTEXT_COMPACTION_RESERVATION_OUTCOME.reserved,
        attempt: captured,
      });
    });
  }

  finalizeAttempt(
    request: ContextCompactionAttemptFinalization,
  ): Promise<ContextCompactionFinalizationResult> {
    return this.run(() => {
      let identity: ContextCompactionAttemptIdentity;
      let assessment: ReturnType<typeof captureContextCompactionAssessment>;
      let checkpoint: ContextCheckpoint | undefined;
      try {
        identity = captureContextCompactionAttemptIdentity(request?.identity);
        assessment = captureContextCompactionAssessment(request?.assessment);
        checkpoint =
          request?.checkpoint === undefined
            ? undefined
            : captureContextCheckpoint(request.checkpoint);
        assertFinalizationShape(identity, assessment, checkpoint);
      } catch {
        throw this.failure(
          CONTEXT_CHECKPOINT_STORE_FAILURE.invalidFinalization,
          captureConversationId(request?.identity),
          captureCheckpointId(request?.checkpoint),
        );
      }

      const key = attemptKey(identity);
      const existing = this.attempts.get(key);
      if (existing === undefined) {
        throw this.failure(
          CONTEXT_CHECKPOINT_STORE_FAILURE.attemptNotReserved,
          identity.conversationId,
          checkpoint?.id,
        );
      }
      if (existing.status === CONTEXT_COMPACTION_ATTEMPT_STATUS.completed) {
        const storedCheckpoint =
          existing.assessment?.checkpointId === undefined
            ? undefined
            : this.checkpoints.get(existing.assessment.checkpointId);
        if (
          !sameFinalization(existing, assessment, checkpoint) ||
          (checkpoint !== undefined &&
            (storedCheckpoint === undefined ||
              !sameJson(storedCheckpoint, checkpoint)))
        ) {
          throw this.failure(
            CONTEXT_CHECKPOINT_STORE_FAILURE.attemptConflict,
            identity.conversationId,
            checkpoint?.id,
          );
        }
        return Object.freeze({
          attempt: existing,
          ...(storedCheckpoint === undefined
            ? {}
            : { checkpoint: storedCheckpoint }),
          unchanged: true,
        });
      }
      if (existing.status !== CONTEXT_COMPACTION_ATTEMPT_STATUS.reserved) {
        throw this.failure(
          CONTEXT_CHECKPOINT_STORE_FAILURE.attemptConflict,
          identity.conversationId,
          checkpoint?.id,
        );
      }
      const active = this.activeCheckpoints.get(identity.conversationId);
      if ((active?.id ?? undefined) !== existing.expectedParentCheckpointId) {
        throw this.failure(
          CONTEXT_CHECKPOINT_STORE_FAILURE.activationConflict,
          identity.conversationId,
          checkpoint?.id,
        );
      }
      if (
        checkpoint !== undefined &&
        (checkpoint.parentCheckpointId ?? undefined) !==
          existing.expectedParentCheckpointId
      ) {
        throw this.failure(
          CONTEXT_CHECKPOINT_STORE_FAILURE.activationConflict,
          identity.conversationId,
          checkpoint.id,
        );
      }

      if (checkpoint !== undefined) {
        const stored = this.checkpoints.get(checkpoint.id);
        if (stored !== undefined && !sameJson(stored, checkpoint)) {
          throw this.failure(
            CONTEXT_CHECKPOINT_STORE_FAILURE.checkpointConflict,
            identity.conversationId,
            checkpoint.id,
          );
        }
        this.checkpoints.set(checkpoint.id, checkpoint);
      }
      const completed = Object.freeze({
        ...existing,
        status: CONTEXT_COMPACTION_ATTEMPT_STATUS.completed,
        completedAt: assessment.completedAt,
        assessment,
      });
      this.attempts.set(key, completed);
      if (checkpoint !== undefined) {
        this.activeCheckpoints.set(identity.conversationId, checkpoint);
      }
      this.logger.info("runtime.context.compaction_attempt_finalized", {
        conversationId: identity.conversationId,
        runId: existing.runId,
        providerCallId: existing.providerCallId,
        outcome: assessment.outcome,
        checkpointActivated: checkpoint !== undefined,
      });
      return Object.freeze({
        attempt: completed,
        ...(checkpoint === undefined ? {} : { checkpoint }),
        unchanged: false,
      });
    });
  }

  failAttempt(
    request: ContextCompactionAttemptFailureRequest,
  ): Promise<ContextCompactionFailureResult> {
    return this.run(() => {
      let identity: ContextCompactionAttemptIdentity;
      let failure: ContextCompactionAttemptFailure;
      let completedAt: string;
      try {
        identity = captureContextCompactionAttemptIdentity(request?.identity);
        if (!ATTEMPT_FAILURES.has(request?.failure as never)) throw new Error();
        failure = request.failure;
        completedAt = requireTimestamp(request.completedAt);
      } catch {
        throw this.failure(
          CONTEXT_CHECKPOINT_STORE_FAILURE.invalidFailure,
          captureConversationId(request?.identity),
        );
      }

      const key = attemptKey(identity);
      const existing = this.attempts.get(key);
      if (existing === undefined) {
        throw this.failure(
          CONTEXT_CHECKPOINT_STORE_FAILURE.attemptNotReserved,
          identity.conversationId,
        );
      }
      if (existing.status === CONTEXT_COMPACTION_ATTEMPT_STATUS.failed) {
        if (existing.failure !== failure || existing.completedAt !== completedAt) {
          throw this.failure(
            CONTEXT_CHECKPOINT_STORE_FAILURE.attemptConflict,
            identity.conversationId,
          );
        }
        return Object.freeze({ attempt: existing, unchanged: true });
      }
      if (existing.status !== CONTEXT_COMPACTION_ATTEMPT_STATUS.reserved) {
        throw this.failure(
          CONTEXT_CHECKPOINT_STORE_FAILURE.attemptConflict,
          identity.conversationId,
        );
      }
      const failed = Object.freeze({
        ...existing,
        status: CONTEXT_COMPACTION_ATTEMPT_STATUS.failed,
        completedAt,
        failure,
      });
      this.attempts.set(key, failed);
      this.logger.info("runtime.context.compaction_attempt_failed", {
        conversationId: identity.conversationId,
        runId: existing.runId,
        providerCallId: existing.providerCallId,
        failure,
      });
      return Object.freeze({ attempt: failed, unchanged: false });
    });
  }

  private failure(
    failure: ContextCheckpointStoreFailure,
    conversationId?: string,
    checkpointId?: string,
  ): ContextCheckpointStoreError {
    return new ContextCheckpointStoreError(
      failure,
      conversationId,
      checkpointId,
    );
  }

  private run<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function assertFinalizationShape(
  identity: ContextCompactionAttemptIdentity,
  assessment: ReturnType<typeof captureContextCompactionAssessment>,
  checkpoint?: ContextCheckpoint,
): void {
  if (assessment.conversationId !== identity.conversationId) throw new Error();
  const unreducible = assessment.outcome === CONTEXT_COMPACTION_OUTCOME.unreducible;
  if (unreducible !== (checkpoint === undefined)) throw new Error();
  if (checkpoint === undefined) return;
  if (
    checkpoint.conversationId !== identity.conversationId ||
    checkpoint.sourceDigest !== identity.sourceDigest ||
    checkpoint.compactorId !== identity.compactorId ||
    checkpoint.compactorVersion !== identity.compactorVersion ||
    assessment.checkpointId !== checkpoint.id ||
    assessment.tokenEstimateBefore !== checkpoint.tokenEstimateBefore ||
    assessment.tokenEstimateAfter !== checkpoint.tokenEstimateAfter
  ) {
    throw new Error();
  }
}

function sameFinalization(
  attempt: ContextCompactionAttemptRecord,
  assessment: ReturnType<typeof captureContextCompactionAssessment>,
  checkpoint?: ContextCheckpoint,
): boolean {
  return (
    attempt.assessment !== undefined &&
    sameJson(attempt.assessment, assessment) &&
    (assessment.checkpointId ?? undefined) === (checkpoint?.id ?? undefined)
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  if (!isJsonValue(left) || !isJsonValue(right)) return false;
  return (
    canonicalStringifyJson(left as JsonValue) ===
    canonicalStringifyJson(right as JsonValue)
  );
}

function attemptKey(identity: ContextCompactionAttemptIdentity): string {
  return canonicalStringifyJson(identity as unknown as JsonValue);
}

function requireNonBlank(value: unknown): string {
  if (!isNonBlank(value)) throw new Error();
  return value;
}

function captureOptionalNonBlank(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return requireNonBlank(value);
}

function requireTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error();
  }
  return value;
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function captureConversationId(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const conversationId = (value as Record<string, unknown>).conversationId;
  return isNonBlank(conversationId) ? conversationId : undefined;
}

function captureCheckpointId(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const checkpointId = (value as Record<string, unknown>).id;
  return isNonBlank(checkpointId) ? checkpointId : undefined;
}
