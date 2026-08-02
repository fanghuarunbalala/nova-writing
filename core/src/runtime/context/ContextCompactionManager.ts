/** Coordinates one deterministic Compaction attempt without deleting canonical history. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  CONTEXT_COMPACTION_OUTCOME,
  CONTEXT_UNREDUCIBLE_REASON,
  type ContextCompactionAssessment,
  type ContextCompactionAttemptIdentity,
  type ContextUnreducibleReason,
} from "./ContextCompactionProtocol.js";
import {
  captureContextCompactionAssessment,
  captureContextCompactionAttemptIdentity,
} from "./ContextCompactionProtocolValidator.js";
import {
  CONTEXT_CHECKPOINT_SCHEMA_VERSION,
  type ContextCheckpoint,
} from "./ContextCheckpoint.js";
import type { ContextCheckpointStore } from "./ContextCheckpointStore.js";
import { captureContextCheckpoint } from "./ContextCheckpointValidator.js";
import {
  CONTEXT_COMPACTION_ATTEMPT_FAILURE,
  CONTEXT_COMPACTION_MANAGER_DISPOSITION,
  CONTEXT_COMPACTION_RESERVATION_OUTCOME,
  type ContextCheckpointIdFactory,
  type ContextCheckpointSemanticValidator,
  type ContextCompactionAttemptFailure,
  type ContextCompactionClock,
  type ContextCompactionHasher,
  type ContextCompactionManagerResult,
  type ContextCompactionSource,
  type ContextCompactionSourceProvider,
  type ContextCompactor,
  type ContextCompactorResult,
} from "./ContextCompactionManagerProtocol.js";
import {
  canonicalizeContextCheckpointContent,
  canonicalizeContextCompactionSource,
  captureCanonicalSha256Digest,
  captureContextCompactionSource,
  captureContextCompactorResult,
  collectPinnedMessageIds,
} from "./ContextCompactionManagerProtocolValidator.js";
import {
  CONTEXT_COMPACTION_MANAGER_FAILURE,
  ContextCompactionManagerError,
  type ContextCompactionManagerFailure,
} from "./ContextCompactionManagerErrors.js";
import type { ContextCompactionEffect } from "../policy/RuntimePolicyProtocol.js";
import { captureContextCompactionEffect } from "../policy/RuntimePolicyProtocolValidator.js";

export class RandomContextCheckpointIdFactory
  implements ContextCheckpointIdFactory
{
  create(): string {
    return `context_checkpoint_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
  }
}

export class SystemContextCompactionClock implements ContextCompactionClock {
  now(): string {
    return new Date().toISOString();
  }
}

export interface ContextCompactionManagerOptions {
  readonly conversationId: string;
  readonly store: ContextCheckpointStore;
  readonly sourceProvider: ContextCompactionSourceProvider;
  readonly compactor: ContextCompactor;
  readonly hasher: ContextCompactionHasher;
  readonly semanticValidator?: ContextCheckpointSemanticValidator;
  readonly checkpointIdFactory?: ContextCheckpointIdFactory;
  readonly clock?: ContextCompactionClock;
  readonly logger?: Logger;
}

export class ContextCompactionManager {
  private readonly conversationId: string;
  private readonly store: ContextCheckpointStore;
  private readonly sourceProvider: ContextCompactionSourceProvider;
  private readonly compactor: ContextCompactor;
  private readonly hasher: ContextCompactionHasher;
  private readonly semanticValidator?: ContextCheckpointSemanticValidator;
  private readonly checkpointIdFactory: ContextCheckpointIdFactory;
  private readonly clock: ContextCompactionClock;
  private readonly logger: Logger;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: ContextCompactionManagerOptions) {
    if (
      !isNonBlank(options?.conversationId) ||
      !isNonBlank(options?.compactor?.id) ||
      !isNonBlank(options?.compactor?.version) ||
      options?.hasher?.algorithm !== "sha256"
    ) {
      throw new TypeError("Context Compaction Manager options are invalid");
    }
    this.conversationId = options.conversationId;
    this.store = options.store;
    this.sourceProvider = options.sourceProvider;
    this.compactor = options.compactor;
    this.hasher = options.hasher;
    this.semanticValidator = options.semanticValidator;
    this.checkpointIdFactory =
      options.checkpointIdFactory ?? new RandomContextCheckpointIdFactory();
    this.clock = options.clock ?? new SystemContextCompactionClock();
    this.logger = (options.logger ?? noopLogger).child({
      component: "context_compaction_manager",
      conversationId: this.conversationId,
      compactorId: this.compactor.id,
      compactorVersion: this.compactor.version,
    });
  }

  async compact(
    effect: ContextCompactionEffect,
  ): Promise<ContextCompactionManagerResult> {
    let capturedEffect: ContextCompactionEffect;
    try {
      capturedEffect = captureContextCompactionEffect(effect);
      if (capturedEffect.conversationId !== this.conversationId) throw new Error();
    } catch {
      const error = this.failure(
        CONTEXT_COMPACTION_MANAGER_FAILURE.invalidEffect,
        effect,
      );
      this.logFailure(error);
      throw error;
    }
    return this.serialize(() => this.compactSerialized(capturedEffect));
  }

  async drain(): Promise<void> {
    await this.tail;
  }

  private async compactSerialized(
    effect: ContextCompactionEffect,
  ): Promise<ContextCompactionManagerResult> {
    const activeCheckpoint = await this.loadActiveCheckpoint(effect);
    const source = await this.loadSource(effect, activeCheckpoint);
    const sourceDigest = await this.resolveSourceDigest(
      effect,
      source,
      activeCheckpoint,
    );
    const identity = captureContextCompactionAttemptIdentity({
      conversationId: this.conversationId,
      sourceDigest,
      compactorId: this.compactor.id,
      compactorVersion: this.compactor.version,
    });
    const reservation = await this.reserveAttempt(
      effect,
      identity,
      activeCheckpoint,
    );
    if (reservation.outcome === CONTEXT_COMPACTION_RESERVATION_OUTCOME.duplicate) {
      this.logger.debug("runtime.context.compaction_duplicate_suppressed", {
        runId: effect.runId,
        providerCallId: effect.providerCallId,
        attemptStatus: reservation.attempt.status,
      });
      return Object.freeze({
        disposition: CONTEXT_COMPACTION_MANAGER_DISPOSITION.duplicate,
        attempt: reservation.attempt,
        ...(reservation.attempt.assessment === undefined
          ? {}
          : { assessment: reservation.attempt.assessment }),
      });
    }

    this.logger.info("runtime.context.compaction_started", {
      runId: effect.runId,
      providerCallId: effect.providerCallId,
      tokenEstimateBefore: effect.pressure.estimate.totalInputTokens,
      irreducibleFloorTokens: effect.pressure.irreducibleFloor.totalTokens,
    });
    if (
      effect.pressure.irreducibleFloor.totalTokens >= effect.hardAdmissionTokens
    ) {
      const assessment = await this.createAssessment(
        effect,
        identity,
        effect.pressure.irreducibleFloor.totalTokens,
        undefined,
        resolveIrreducibleFloorReason(effect),
      );
      return this.finalizeUnreducible(effect, identity, assessment);
    }

    let candidate: unknown;
    try {
      candidate = await this.compactor.compact({
        effect,
        source,
        sourceDigest,
        ...(activeCheckpoint === undefined ? {} : { activeCheckpoint }),
      });
    } catch {
      await this.recordAttemptFailure(
        effect,
        identity,
        CONTEXT_COMPACTION_ATTEMPT_FAILURE.compactorFailed,
      );
      const error = this.failure(
        CONTEXT_COMPACTION_MANAGER_FAILURE.compactorFailed,
        effect,
      );
      this.logFailure(error);
      throw error;
    }
    let result: ContextCompactorResult;
    try {
      result = captureContextCompactorResult(candidate, {
        effect,
        source,
        ...(activeCheckpoint === undefined ? {} : { activeCheckpoint }),
      });
    } catch {
      await this.recordAttemptFailure(
        effect,
        identity,
        CONTEXT_COMPACTION_ATTEMPT_FAILURE.resultInvalid,
      );
      const error = this.failure(
        CONTEXT_COMPACTION_MANAGER_FAILURE.resultInvalid,
        effect,
      );
      this.logFailure(error);
      throw error;
    }

    const provisionalAssessment = classifyCompaction(effect, result.tokenEstimateAfter);
    if (provisionalAssessment.outcome === CONTEXT_COMPACTION_OUTCOME.unreducible) {
      const assessment = await this.createAssessment(
        effect,
        identity,
        result.tokenEstimateAfter,
        undefined,
        CONTEXT_UNREDUCIBLE_REASON.compactionInsufficient,
      );
      return this.finalizeUnreducible(effect, identity, assessment);
    }

    const checkpoint = await this.createCheckpoint(
      effect,
      identity,
      source,
      result,
      activeCheckpoint,
    );
    const assessment = await this.createAssessment(
      effect,
      identity,
      result.tokenEstimateAfter,
      checkpoint.id,
    );
    await this.validateSemantics(
      effect,
      identity,
      source,
      checkpoint,
      activeCheckpoint,
    );
    try {
      const finalized = await this.store.finalizeAttempt({
        identity,
        assessment,
        checkpoint,
      });
      this.logger.info("runtime.context.compaction_completed", {
        runId: effect.runId,
        providerCallId: effect.providerCallId,
        outcome: assessment.outcome,
        tokenEstimateAfter: assessment.tokenEstimateAfter,
        checkpointId: checkpoint.id,
      });
      return Object.freeze({
        disposition: CONTEXT_COMPACTION_MANAGER_DISPOSITION.activated,
        attempt: finalized.attempt,
        assessment,
        checkpoint: finalized.checkpoint ?? checkpoint,
      });
    } catch {
      const error = this.failure(
        CONTEXT_COMPACTION_MANAGER_FAILURE.attemptFinalizationFailed,
        effect,
      );
      this.logFailure(error);
      throw error;
    }
  }

  private async loadActiveCheckpoint(
    effect: ContextCompactionEffect,
  ): Promise<ContextCheckpoint | undefined> {
    try {
      const checkpoint = await this.store.getActive(this.conversationId);
      return checkpoint === undefined
        ? undefined
        : captureContextCheckpoint(checkpoint);
    } catch {
      const error = this.failure(
        CONTEXT_COMPACTION_MANAGER_FAILURE.activeCheckpointFailed,
        effect,
      );
      this.logFailure(error);
      throw error;
    }
  }

  private async loadSource(
    effect: ContextCompactionEffect,
    activeCheckpoint?: ContextCheckpoint,
  ): Promise<ContextCompactionSource> {
    let source: unknown;
    try {
      source = await this.sourceProvider.load({
        effect,
        ...(activeCheckpoint === undefined ? {} : { activeCheckpoint }),
      });
    } catch {
      const error = this.failure(
        CONTEXT_COMPACTION_MANAGER_FAILURE.sourceFailed,
        effect,
      );
      this.logFailure(error);
      throw error;
    }
    try {
      const captured = captureContextCompactionSource(source, activeCheckpoint);
      if (captured.conversationId !== this.conversationId) throw new Error();
      return captured;
    } catch {
      const error = this.failure(
        CONTEXT_COMPACTION_MANAGER_FAILURE.sourceInvalid,
        effect,
      );
      this.logFailure(error);
      throw error;
    }
  }

  private async resolveSourceDigest(
    effect: ContextCompactionEffect,
    source: ContextCompactionSource,
    activeCheckpoint?: ContextCheckpoint,
  ): Promise<string> {
    const pinnedMessageIds = collectPinnedMessageIds(source.pinnedGroups);
    if (
      activeCheckpoint !== undefined &&
      source.messages.length === 0 &&
      arraysEqual(activeCheckpoint.pinnedMessageIds, pinnedMessageIds)
    ) {
      return activeCheckpoint.sourceDigest;
    }
    try {
      return captureCanonicalSha256Digest(
        await this.hasher.digest(
          canonicalizeContextCompactionSource(source, activeCheckpoint),
        ),
      );
    } catch {
      const error = this.failure(
        CONTEXT_COMPACTION_MANAGER_FAILURE.sourceDigestFailed,
        effect,
      );
      this.logFailure(error);
      throw error;
    }
  }

  private async reserveAttempt(
    effect: ContextCompactionEffect,
    identity: ContextCompactionAttemptIdentity,
    activeCheckpoint?: ContextCheckpoint,
  ) {
    try {
      return await this.store.reserveAttempt({
        identity,
        runId: effect.runId,
        providerCallId: effect.providerCallId,
        requestedAt: effect.requestedAt,
        ...(activeCheckpoint === undefined
          ? {}
          : { expectedParentCheckpointId: activeCheckpoint.id }),
      });
    } catch {
      const error = this.failure(
        CONTEXT_COMPACTION_MANAGER_FAILURE.attemptReservationFailed,
        effect,
      );
      this.logFailure(error);
      throw error;
    }
  }

  private async createCheckpoint(
    effect: ContextCompactionEffect,
    identity: ContextCompactionAttemptIdentity,
    source: ContextCompactionSource,
    result: ContextCompactorResult,
    activeCheckpoint?: ContextCheckpoint,
  ): Promise<ContextCheckpoint> {
    let checkpointId: string;
    try {
      checkpointId = requireNonBlank(
        this.checkpointIdFactory.create({
          conversationId: this.conversationId,
          sourceDigest: identity.sourceDigest,
          compactorId: identity.compactorId,
          compactorVersion: identity.compactorVersion,
        }),
      );
    } catch {
      await this.recordAttemptFailure(
        effect,
        identity,
        CONTEXT_COMPACTION_ATTEMPT_FAILURE.checkpointInvalid,
      );
      const error = this.failure(
        CONTEXT_COMPACTION_MANAGER_FAILURE.checkpointIdFailed,
        effect,
      );
      this.logFailure(error);
      throw error;
    }
    const createdAt = await this.captureNow(
      effect,
      identity,
      CONTEXT_COMPACTION_ATTEMPT_FAILURE.checkpointInvalid,
    );
    const unsigned: Omit<ContextCheckpoint, "contentDigest"> = {
      schemaVersion: CONTEXT_CHECKPOINT_SCHEMA_VERSION,
      id: checkpointId,
      conversationId: this.conversationId,
      ...(activeCheckpoint === undefined
        ? {}
        : { parentCheckpointId: activeCheckpoint.id }),
      sourceStartSequence: source.sourceStartSequence,
      sourceEndSequence: source.sourceEndSequence,
      coveredThroughSequence: source.sourceEndSequence,
      sourceDigest: identity.sourceDigest,
      summary: result.summary,
      facts: result.facts,
      decisions: result.decisions,
      constraints: result.constraints,
      unresolvedTasks: result.unresolvedTasks,
      pinnedMessageIds: result.pinnedMessageIds,
      recentWindowStartSequence: result.recentWindowStartSequence,
      tokenEstimateBefore: effect.pressure.estimate.totalInputTokens,
      tokenEstimateAfter: result.tokenEstimateAfter,
      compactorId: identity.compactorId,
      compactorVersion: identity.compactorVersion,
      createdAt,
    };
    let contentDigest: string;
    try {
      contentDigest = captureCanonicalSha256Digest(
        await this.hasher.digest(canonicalizeContextCheckpointContent(unsigned)),
      );
    } catch {
      await this.recordAttemptFailure(
        effect,
        identity,
        CONTEXT_COMPACTION_ATTEMPT_FAILURE.checkpointDigestFailed,
      );
      const error = this.failure(
        CONTEXT_COMPACTION_MANAGER_FAILURE.checkpointDigestFailed,
        effect,
      );
      this.logFailure(error);
      throw error;
    }

    let checkpoint: ContextCheckpoint;
    try {
      checkpoint = captureContextCheckpoint({ ...unsigned, contentDigest });
    } catch {
      await this.recordAttemptFailure(
        effect,
        identity,
        CONTEXT_COMPACTION_ATTEMPT_FAILURE.checkpointInvalid,
      );
      const error = this.failure(
        CONTEXT_COMPACTION_MANAGER_FAILURE.checkpointInvalid,
        effect,
      );
      this.logFailure(error);
      throw error;
    }
    try {
      const recomputed = captureCanonicalSha256Digest(
        await this.hasher.digest(
          canonicalizeContextCheckpointContent(stripContentDigest(checkpoint)),
        ),
      );
      if (recomputed !== checkpoint.contentDigest) throw new Error();
    } catch {
      await this.recordAttemptFailure(
        effect,
        identity,
        CONTEXT_COMPACTION_ATTEMPT_FAILURE.checkpointDigestFailed,
      );
      const error = this.failure(
        CONTEXT_COMPACTION_MANAGER_FAILURE.checkpointDigestFailed,
        effect,
      );
      this.logFailure(error);
      throw error;
    }
    return checkpoint;
  }

  private async createAssessment(
    effect: ContextCompactionEffect,
    identity: ContextCompactionAttemptIdentity,
    tokenEstimateAfter: number,
    checkpointId?: string,
    unreducibleReason?: ContextUnreducibleReason,
  ): Promise<ContextCompactionAssessment> {
    const completedAt = await this.captureNow(
      effect,
      identity,
      CONTEXT_COMPACTION_ATTEMPT_FAILURE.resultInvalid,
    );
    const classification = classifyCompaction(effect, tokenEstimateAfter);
    try {
      return captureContextCompactionAssessment({
        conversationId: this.conversationId,
        runId: effect.runId,
        providerCallId: effect.providerCallId,
        outcome: classification.outcome,
        tokenEstimateBefore: effect.pressure.estimate.totalInputTokens,
        tokenEstimateAfter,
        irreducibleFloorTokens: effect.pressure.irreducibleFloor.totalTokens,
        targetTokens: effect.targetTokens,
        compactionRequestTokens: effect.compactionRequestTokens,
        hardAdmissionTokens: effect.hardAdmissionTokens,
        minimumSavingsTokens: effect.minimumSavingsTokens,
        targetAchieved: classification.targetAchieved,
        meaningfulReduction: classification.meaningfulReduction,
        ...(checkpointId === undefined ? {} : { checkpointId }),
        ...(unreducibleReason === undefined ? {} : { unreducibleReason }),
        completedAt,
      });
    } catch {
      await this.recordAttemptFailure(
        effect,
        identity,
        CONTEXT_COMPACTION_ATTEMPT_FAILURE.resultInvalid,
      );
      const error = this.failure(
        CONTEXT_COMPACTION_MANAGER_FAILURE.resultInvalid,
        effect,
      );
      this.logFailure(error);
      throw error;
    }
  }

  private async validateSemantics(
    effect: ContextCompactionEffect,
    identity: ContextCompactionAttemptIdentity,
    source: ContextCompactionSource,
    checkpoint: ContextCheckpoint,
    activeCheckpoint?: ContextCheckpoint,
  ): Promise<void> {
    if (this.semanticValidator === undefined) return;
    try {
      await this.semanticValidator.validate({
        effect,
        source,
        checkpoint,
        ...(activeCheckpoint === undefined ? {} : { activeCheckpoint }),
      });
    } catch {
      await this.recordAttemptFailure(
        effect,
        identity,
        CONTEXT_COMPACTION_ATTEMPT_FAILURE.semanticValidationFailed,
      );
      const error = this.failure(
        CONTEXT_COMPACTION_MANAGER_FAILURE.semanticValidationFailed,
        effect,
      );
      this.logFailure(error);
      throw error;
    }
  }

  private async finalizeUnreducible(
    effect: ContextCompactionEffect,
    identity: ContextCompactionAttemptIdentity,
    assessment: ContextCompactionAssessment,
  ): Promise<ContextCompactionManagerResult> {
    try {
      const finalized = await this.store.finalizeAttempt({
        identity,
        assessment,
      });
      this.logger.info("runtime.context.compaction_completed", {
        runId: effect.runId,
        providerCallId: effect.providerCallId,
        outcome: assessment.outcome,
        tokenEstimateAfter: assessment.tokenEstimateAfter,
        checkpointActivated: false,
      });
      return Object.freeze({
        disposition: CONTEXT_COMPACTION_MANAGER_DISPOSITION.unreducible,
        attempt: finalized.attempt,
        assessment,
      });
    } catch {
      const error = this.failure(
        CONTEXT_COMPACTION_MANAGER_FAILURE.attemptFinalizationFailed,
        effect,
      );
      this.logFailure(error);
      throw error;
    }
  }

  private async recordAttemptFailure(
    effect: ContextCompactionEffect,
    identity: ContextCompactionAttemptIdentity,
    failure: ContextCompactionAttemptFailure,
  ): Promise<void> {
    let completedAt: string;
    try {
      completedAt = requireTimestamp(this.clock.now());
    } catch {
      this.logger.error("runtime.context.compaction_failure_record_skipped", {
        runId: effect.runId,
        providerCallId: effect.providerCallId,
        failure,
        reason: CONTEXT_COMPACTION_MANAGER_FAILURE.clockFailed,
      });
      return;
    }
    try {
      await this.store.failAttempt({ identity, failure, completedAt });
    } catch {
      this.logger.error("runtime.context.compaction_failure_record_skipped", {
        runId: effect.runId,
        providerCallId: effect.providerCallId,
        failure,
        reason: CONTEXT_COMPACTION_MANAGER_FAILURE.attemptFinalizationFailed,
      });
    }
  }

  private async captureNow(
    effect: ContextCompactionEffect,
    identity?: ContextCompactionAttemptIdentity,
    attemptFailure?: ContextCompactionAttemptFailure,
  ): Promise<string> {
    try {
      return requireTimestamp(this.clock.now());
    } catch {
      if (identity !== undefined && attemptFailure !== undefined) {
        await this.recordAttemptFailure(effect, identity, attemptFailure);
      }
      const error = this.failure(
        CONTEXT_COMPACTION_MANAGER_FAILURE.clockFailed,
        effect,
      );
      this.logFailure(error);
      throw error;
    }
  }

  private failure(
    failure: ContextCompactionManagerFailure,
    effect?: Partial<ContextCompactionEffect>,
  ): ContextCompactionManagerError {
    return new ContextCompactionManagerError(
      failure,
      this.conversationId,
      captureNonBlank(effect?.runId),
      captureNonBlank(effect?.providerCallId),
    );
  }

  private logFailure(error: ContextCompactionManagerError): void {
    this.logger.error("runtime.context.compaction_failed", {
      failure: error.failure,
      conversationId: error.conversationId,
      ...(error.runId ? { runId: error.runId } : {}),
      ...(error.providerCallId
        ? { providerCallId: error.providerCallId }
        : {}),
    });
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

function classifyCompaction(
  effect: ContextCompactionEffect,
  tokenEstimateAfter: number,
): Readonly<{
  outcome: ContextCompactionAssessment["outcome"];
  targetAchieved: boolean;
  meaningfulReduction: boolean;
}> {
  const tokenEstimateBefore = effect.pressure.estimate.totalInputTokens;
  const targetAchieved = tokenEstimateAfter <= effect.targetTokens;
  const savings = tokenEstimateBefore - tokenEstimateAfter;
  const meaningfulReduction =
    tokenEstimateAfter < tokenEstimateBefore &&
    (savings >= effect.minimumSavingsTokens ||
      tokenEstimateAfter === effect.pressure.irreducibleFloor.totalTokens ||
      targetAchieved);
  const outcome =
    tokenEstimateAfter >= effect.hardAdmissionTokens || !meaningfulReduction
      ? CONTEXT_COMPACTION_OUTCOME.unreducible
      : targetAchieved
        ? CONTEXT_COMPACTION_OUTCOME.targetMet
        : tokenEstimateAfter < effect.compactionRequestTokens
          ? CONTEXT_COMPACTION_OUTCOME.reduced
          : CONTEXT_COMPACTION_OUTCOME.degraded;
  return Object.freeze({ outcome, targetAchieved, meaningfulReduction });
}

function resolveIrreducibleFloorReason(
  effect: ContextCompactionEffect,
): ContextUnreducibleReason {
  const floor = effect.pressure.irreducibleFloor;
  if (floor.currentInputTokens >= effect.hardAdmissionTokens) {
    return CONTEXT_UNREDUCIBLE_REASON.currentInputTooLarge;
  }
  if (floor.baseSystemPromptTokens >= effect.hardAdmissionTokens) {
    return CONTEXT_UNREDUCIBLE_REASON.basePromptTooLarge;
  }
  if (floor.toolSchemaTokens >= effect.hardAdmissionTokens) {
    return CONTEXT_UNREDUCIBLE_REASON.toolSchemaTooLarge;
  }
  if (floor.transientMessageTokens >= effect.hardAdmissionTokens) {
    return CONTEXT_UNREDUCIBLE_REASON.transientContextTooLarge;
  }
  return CONTEXT_UNREDUCIBLE_REASON.pinnedContextTooLarge;
}

function stripContentDigest(
  checkpoint: ContextCheckpoint,
): Omit<ContextCheckpoint, "contentDigest"> {
  const { contentDigest: _contentDigest, ...unsigned } = checkpoint;
  return unsigned;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function requireNonBlank(value: unknown): string {
  const captured = captureNonBlank(value);
  if (captured === undefined) throw new Error();
  return captured;
}

function captureNonBlank(value: unknown): string | undefined {
  return isNonBlank(value) ? value : undefined;
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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
