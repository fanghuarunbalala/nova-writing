/** Pure deterministic selection for one Provider call without state mutation. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  NUDGE_SELECTION_LIMIT,
  PENDING_NUDGE_STATE,
  type NudgeLeaseRequest,
  type PendingNudge,
} from "./NudgeProtocol.js";
import {
  captureNudgeLeaseRequest,
  capturePendingNudge,
  resolveNudgeSelectionLimit,
} from "./NudgeProtocolValidator.js";
import {
  NUDGE_SELECTION_FAILURE,
  NudgeSelectionError,
  type NudgeSelectionFailure,
} from "./NudgeSelectionErrors.js";

export interface NudgeCooldownRecord {
  readonly dedupeKey: string;
  readonly consumedTurnNumber: number;
}

export interface NudgeSelectorOptions {
  readonly logger?: Logger;
}

export class NudgeSelector {
  private readonly logger: Logger;

  constructor(options: NudgeSelectorOptions = {}) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "nudge_selector",
    });
  }

  select(
    candidates: readonly PendingNudge[],
    request: NudgeLeaseRequest,
    cooldowns: readonly NudgeCooldownRecord[] = [],
  ): readonly PendingNudge[] {
    const identity = captureIdentity(request);
    this.logger.debug("runtime.nudge.selection_started", {
      ...identity,
      candidateCount: Array.isArray(candidates) ? candidates.length : 0,
      cooldownCount: Array.isArray(cooldowns) ? cooldowns.length : 0,
    });

    try {
      const capturedRequest = captureNudgeLeaseRequest(request);
      if (!Array.isArray(candidates)) {
        throw this.failure(NUDGE_SELECTION_FAILURE.invalidCandidate, identity);
      }
      if (!Array.isArray(cooldowns)) {
        throw this.failure(NUDGE_SELECTION_FAILURE.invalidCooldown, identity);
      }

      const capturedCandidates = candidates.map((candidate) => {
        try {
          return capturePendingNudge(candidate);
        } catch {
          throw this.failure(NUDGE_SELECTION_FAILURE.invalidCandidate, identity);
        }
      });
      this.assertUniqueCandidates(capturedCandidates, identity);
      const cooldownByKey = this.captureCooldowns(cooldowns, identity);
      const eligible = capturedCandidates
        .filter((candidate) =>
          this.isEligible(candidate, capturedRequest, cooldownByKey),
        )
        .sort(compareCandidates);
      const limit = resolveNudgeSelectionLimit(capturedRequest);
      const selected = selectExclusiveSafe(eligible, limit);

      this.logger.info("runtime.nudge.selection_completed", {
        ...identity,
        eligibleCount: eligible.length,
        selectedCount: selected.length,
        selectionLimit: limit,
      });
      return Object.freeze(selected);
    } catch (error) {
      const normalized =
        error instanceof NudgeSelectionError
          ? error
          : this.failure(NUDGE_SELECTION_FAILURE.invalidRequest, identity);
      this.logger.error("runtime.nudge.selection_failed", {
        ...identity,
        failure: normalized.failure,
      });
      throw normalized;
    }
  }

  private captureCooldowns(
    cooldowns: readonly NudgeCooldownRecord[],
    identity: NudgeSelectionIdentity,
  ): ReadonlyMap<string, number> {
    const captured = new Map<string, number>();
    for (const cooldown of cooldowns) {
      if (!isRecord(cooldown)) {
        throw this.failure(NUDGE_SELECTION_FAILURE.invalidCooldown, identity);
      }
      const dedupeKey = captureNonBlank(cooldown.dedupeKey);
      if (
        !dedupeKey ||
        !Number.isSafeInteger(cooldown.consumedTurnNumber) ||
        cooldown.consumedTurnNumber < 1
      ) {
        throw this.failure(NUDGE_SELECTION_FAILURE.invalidCooldown, identity);
      }
      const previous = captured.get(dedupeKey);
      if (previous === undefined || cooldown.consumedTurnNumber > previous) {
        captured.set(dedupeKey, cooldown.consumedTurnNumber);
      }
    }
    return captured;
  }

  private assertUniqueCandidates(
    candidates: readonly PendingNudge[],
    identity: NudgeSelectionIdentity,
  ): void {
    const ids = new Set<string>();
    const sequences = new Set<number>();
    for (const candidate of candidates) {
      if (ids.has(candidate.id) || sequences.has(candidate.scheduledSequence)) {
        throw this.failure(NUDGE_SELECTION_FAILURE.invalidCandidate, identity);
      }
      ids.add(candidate.id);
      sequences.add(candidate.scheduledSequence);
    }
  }

  private isEligible(
    candidate: PendingNudge,
    request: NudgeLeaseRequest,
    cooldownByKey: ReadonlyMap<string, number>,
  ): boolean {
    if (candidate.state !== PENDING_NUDGE_STATE.scheduled) return false;
    if (candidate.targetRunId !== request.targetRunId) return false;
    if (
      candidate.targetTurnNumber !== undefined &&
      candidate.targetTurnNumber !== request.targetTurnNumber
    ) {
      return false;
    }
    if (
      candidate.expiresAt !== undefined &&
      Date.parse(request.requestedAt) >= Date.parse(candidate.expiresAt)
    ) {
      return false;
    }
    if (
      candidate.expiresAfterTurn !== undefined &&
      request.targetTurnNumber !== undefined &&
      request.targetTurnNumber > candidate.expiresAfterTurn
    ) {
      return false;
    }

    const consumedTurnNumber = cooldownByKey.get(candidate.dedupeKey);
    if (consumedTurnNumber === undefined || candidate.cooldownTurns === undefined) {
      return true;
    }
    if (request.targetTurnNumber === undefined) return false;
    return request.targetTurnNumber - consumedTurnNumber > candidate.cooldownTurns;
  }

  private failure(
    failure: NudgeSelectionFailure,
    identity: NudgeSelectionIdentity,
  ): NudgeSelectionError {
    return new NudgeSelectionError(
      failure,
      identity.targetRunId,
      identity.providerCallId,
    );
  }
}

interface NudgeSelectionIdentity {
  readonly targetRunId?: string;
  readonly providerCallId?: string;
}

function captureIdentity(request: NudgeLeaseRequest): NudgeSelectionIdentity {
  if (!isRecord(request)) return Object.freeze({});
  return Object.freeze({
    targetRunId: captureNonBlank(request.targetRunId),
    providerCallId: captureNonBlank(request.providerCallId),
  });
}

function compareCandidates(left: PendingNudge, right: PendingNudge): number {
  if (left.priority !== right.priority) return left.priority < right.priority ? 1 : -1;
  if (left.scheduledSequence === right.scheduledSequence) return 0;
  return left.scheduledSequence < right.scheduledSequence ? -1 : 1;
}

function selectExclusiveSafe(
  eligible: readonly PendingNudge[],
  limit: number,
): PendingNudge[] {
  const first = eligible[0];
  if (!first) return [];
  if (first.exclusive) return [first];

  const selected: PendingNudge[] = [first];
  for (const candidate of eligible.slice(1)) {
    if (selected.length >= Math.min(limit, NUDGE_SELECTION_LIMIT.maximum)) break;
    if (candidate.exclusive) break;
    selected.push(candidate);
  }
  return selected;
}

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
