/** Serialized in-memory Pending Nudge Store used by one Conversation Runtime. */
import {
  canonicalStringifyJson,
  type JsonValue,
} from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  NUDGE_LEASE_RELEASE_OUTCOME,
  NUDGE_SCHEDULE_OUTCOME,
  type NudgeAcknowledgementRequest,
  type NudgeConditionResolutionRequest,
  type NudgeConsumptionRecord,
  type NudgeDeliveryAttemptRecord,
  type NudgeDeliveryTurnRecord,
  type NudgeDispatchConfirmationRequest,
  type NudgeDispatchConfirmationResult,
  type NudgeExpiryRequest,
  type NudgeLeaseReleaseRequest,
  type NudgeLeaseReleaseResult,
  type NudgeLeaseReconciliationResult,
  type NudgeScheduleResult,
  type NudgeSupersessionRequest,
  type PendingNudgeLeaseResult,
  type PendingNudgeStore,
  type PendingNudgeStoreSnapshot,
  PENDING_NUDGE_STORE_SNAPSHOT_SCHEMA_VERSION,
} from "./PendingNudgeStore.js";
import {
  PENDING_NUDGE_STORE_FAILURE,
  PendingNudgeStoreError,
  type PendingNudgeStoreFailure,
} from "./PendingNudgeStoreErrors.js";
import {
  PENDING_NUDGE_STATE,
  type NudgeLease,
  type PendingNudge,
} from "./NudgeProtocol.js";
import {
  captureNudgeLease,
  capturePendingNudge,
} from "./NudgeProtocolValidator.js";
import type { NudgeCooldownRecord } from "./NudgeSelector.js";
import {
  NUDGE_STATE_ACTION,
  NudgeStateMachine,
} from "./NudgeStateMachine.js";

export interface InMemoryPendingNudgeStoreOptions {
  readonly logger?: Logger;
}

export class InMemoryPendingNudgeStore implements PendingNudgeStore {
  private readonly nudges = new Map<string, PendingNudge>();
  private readonly activeLeases = new Map<string, NudgeLease>();
  private readonly consumedCalls = new Map<
    string,
    NudgeDispatchConfirmationResult
  >();
  private readonly releasedCalls = new Map<string, NudgeLeaseReleaseResult>();
  private readonly consumptions = new Map<string, NudgeConsumptionRecord>();
  private readonly deliveredTurns = new Map<string, NudgeDeliveryTurnRecord>();
  private readonly deliveryAttempts = new Map<
    string,
    readonly NudgeDeliveryAttemptRecord[]
  >();
  private readonly logger: Logger;
  private readonly stateMachine = new NudgeStateMachine();
  private tail: Promise<void> = Promise.resolve();

  constructor(options: InMemoryPendingNudgeStoreOptions = {}) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "in_memory_pending_nudge_store",
    });
  }

  schedule(nudge: PendingNudge): Promise<NudgeScheduleResult> {
    return this.run(() => {
      const captured = this.captureScheduledNudge(nudge);
      const existingById = this.nudges.get(captured.id);
      if (existingById) {
        if (existingById.targetRunId === captured.targetRunId) {
          if (!sameScheduledIdentity(existingById, captured)) {
            throw this.failure(
              PENDING_NUDGE_STORE_FAILURE.nudgeConflict,
              captured.id,
              captured.targetRunId,
            );
          }
          return freezeScheduleResult(NUDGE_SCHEDULE_OUTCOME.unchanged, existingById);
        }
        // 跨 run 重新激活：同一 nudgeId 在旧 run 调度过，现为新 run 重新调度。
        // 在途（已 lease/已 applied）不覆盖，fail fast；其余（含 consumed 等终态）
        // 清掉旧记录后整条替换——select 硬绑定 targetRunId，死 target 永不重选中。
        if (
          existingById.state === PENDING_NUDGE_STATE.leased ||
          existingById.state === PENDING_NUDGE_STATE.applied
        ) {
          throw this.failure(
            PENDING_NUDGE_STORE_FAILURE.nudgeConflict,
            captured.id,
            captured.targetRunId,
          );
        }
        this.removeNudgeRecords(captured.id);
        this.nudges.set(captured.id, captured);
        this.logger.info("runtime.nudge.store_reactivated", {
          nudgeId: captured.id,
          targetRunId: captured.targetRunId,
          scheduledSequence: captured.scheduledSequence,
        });
        return freezeScheduleResult(NUDGE_SCHEDULE_OUTCOME.scheduled, captured);
      }

      const existingByDedupe = [...this.nudges.values()].find(
        (candidate) =>
          candidate.targetRunId === captured.targetRunId &&
          candidate.policyId === captured.policyId &&
          candidate.dedupeKey === captured.dedupeKey &&
          (candidate.state === PENDING_NUDGE_STATE.scheduled ||
            candidate.state === PENDING_NUDGE_STATE.leased),
      );
      if (existingByDedupe) {
        return freezeScheduleResult(
          NUDGE_SCHEDULE_OUTCOME.deduplicated,
          existingByDedupe,
        );
      }

      if (
        [...this.nudges.values()].some(
          (candidate) => candidate.scheduledSequence === captured.scheduledSequence,
        )
      ) {
        throw this.failure(
          PENDING_NUDGE_STORE_FAILURE.nudgeConflict,
          captured.id,
          captured.targetRunId,
        );
      }

      this.nudges.set(captured.id, captured);
      this.logger.info("runtime.nudge.store_scheduled", {
        nudgeId: captured.id,
        targetRunId: captured.targetRunId,
        scheduledSequence: captured.scheduledSequence,
      });
      return freezeScheduleResult(NUDGE_SCHEDULE_OUTCOME.scheduled, captured);
    });
  }

  list(): Promise<readonly PendingNudge[]> {
    return this.run(() =>
      Object.freeze([...this.nudges.values()].sort(compareScheduledSequence)),
    );
  }

  listActive(targetRunIdValue?: string): Promise<readonly PendingNudge[]> {
    return this.run(() => {
      const targetRunId = targetRunIdValue === undefined
        ? undefined
        : captureNonBlank(targetRunIdValue);
      if (targetRunIdValue !== undefined && !targetRunId) {
        throw this.failure(PENDING_NUDGE_STORE_FAILURE.invalidNudge);
      }
      return Object.freeze(
        [...this.nudges.values()]
          .filter((nudge) =>
            nudge.state === PENDING_NUDGE_STATE.active &&
            (targetRunId === undefined || nudge.targetRunId === targetRunId))
          .sort(compareScheduledSequence),
      );
    });
  }

  listCooldowns(): Promise<readonly NudgeCooldownRecord[]> {
    return this.run(() => {
      const latest = new Map<
        string,
        { targetRunId: string; policyId: string; dedupeKey: string; turn: number }
      >();
      const recordTurn = (record: {
        targetRunId: string;
        policyId: string;
        dedupeKey: string;
        targetTurnNumber?: number;
      }) => {
        if (record.targetTurnNumber === undefined) return;
        const key = cooldownKey(
          record.targetRunId,
          record.policyId,
          record.dedupeKey,
        );
        const previous = latest.get(key);
        if (previous === undefined || record.targetTurnNumber > previous.turn) {
          latest.set(key, {
            targetRunId: record.targetRunId,
            policyId: record.policyId,
            dedupeKey: record.dedupeKey,
            turn: record.targetTurnNumber,
          });
        }
      };
      for (const consumption of this.consumptions.values()) {
        if (consumption.targetTurnNumber === undefined) continue;
        const nudge = this.nudges.get(consumption.nudgeId);
        if (!nudge || nudge.cooldownTurns === undefined) continue;
        recordTurn(consumption);
      }
      for (const delivery of this.deliveredTurns.values()) {
        const nudge = this.nudges.get(delivery.nudgeId);
        if (!nudge || nudge.cooldownTurns === undefined) continue;
        recordTurn(delivery);
      }
      return Object.freeze(
        [...latest.values()]
          .sort((left, right) =>
            cooldownKey(left.targetRunId, left.policyId, left.dedupeKey).localeCompare(
              cooldownKey(right.targetRunId, right.policyId, right.dedupeKey),
            ),
          )
          .map((record) =>
            Object.freeze({
              targetRunId: record.targetRunId,
              policyId: record.policyId,
              dedupeKey: record.dedupeKey,
              consumedTurnNumber: record.turn,
            }),
          ),
      );
    });
  }

  getActiveLease(
    providerCallIdValue: string,
  ): Promise<PendingNudgeLeaseResult | undefined> {
    return this.run(() => {
      const providerCallId = captureNonBlank(providerCallIdValue);
      if (!providerCallId) {
        throw this.failure(PENDING_NUDGE_STORE_FAILURE.invalidLease);
      }
      const lease = this.activeLeases.get(providerCallId);
      return lease ? this.freezeLeaseResult(lease, true) : undefined;
    });
  }

  lease(lease: NudgeLease): Promise<PendingNudgeLeaseResult> {
    return this.run(() => {
      const captured = this.captureLease(lease);
      if (
        this.consumedCalls.has(captured.providerCallId) ||
        this.releasedCalls.has(captured.providerCallId)
      ) {
        throw this.failure(
          PENDING_NUDGE_STORE_FAILURE.leaseConflict,
          undefined,
          captured.targetRunId,
          captured.providerCallId,
        );
      }

      const active = this.activeLeases.get(captured.providerCallId);
      if (active) {
        if (!sameJson(active, captured)) {
          throw this.failure(
            PENDING_NUDGE_STORE_FAILURE.leaseConflict,
            undefined,
            captured.targetRunId,
            captured.providerCallId,
          );
        }
        return this.freezeLeaseResult(active, true);
      }
      if (
        [...this.activeLeases.values()].some(
          (candidate) => candidate.leaseId === captured.leaseId,
        )
      ) {
        throw this.failure(
          PENDING_NUDGE_STORE_FAILURE.leaseConflict,
          undefined,
          captured.targetRunId,
          captured.providerCallId,
        );
      }

      const selected = captured.nudgeIds.map((nudgeId) => {
        const candidate = this.nudges.get(nudgeId);
        if (
          !candidate ||
          candidate.state !== PENDING_NUDGE_STATE.scheduled &&
          candidate.state !== PENDING_NUDGE_STATE.active ||
          candidate.targetRunId !== captured.targetRunId ||
          (candidate.state === PENDING_NUDGE_STATE.scheduled &&
            candidate.targetTurnNumber !== undefined &&
            candidate.targetTurnNumber !== captured.targetTurnNumber)
        ) {
          throw this.failure(
            PENDING_NUDGE_STORE_FAILURE.leaseConflict,
            nudgeId,
            captured.targetRunId,
            captured.providerCallId,
          );
        }
        return candidate;
      });
      for (const candidate of selected) {
        this.nudges.set(
          candidate.id,
          this.stateMachine.transition(candidate, NUDGE_STATE_ACTION.lease),
        );
        const attempts = this.deliveryAttempts.get(candidate.id) ?? [];
        this.deliveryAttempts.set(candidate.id, Object.freeze([
          ...attempts,
          Object.freeze({
            nudgeId: candidate.id,
            leaseId: captured.leaseId,
            providerCallId: captured.providerCallId,
            attemptNumber: attempts.length + 1,
            leasedAt: captured.leasedAt,
            status: "leased",
          }),
        ]));
      }
      this.activeLeases.set(captured.providerCallId, captured);
      this.logger.info("runtime.nudge.store_leased", {
        targetRunId: captured.targetRunId,
        providerCallId: captured.providerCallId,
        nudgeCount: captured.nudgeIds.length,
      });
      return this.freezeLeaseResult(captured, false);
    });
  }

  confirmDispatched(
    request: NudgeDispatchConfirmationRequest,
  ): Promise<NudgeDispatchConfirmationResult> {
    return this.run(() => {
      const providerCallId = captureNonBlank(request?.providerCallId);
      const dispatchedAt = captureTimestamp(request?.dispatchedAt);
      if (!providerCallId || !dispatchedAt) {
        throw this.failure(
          PENDING_NUDGE_STORE_FAILURE.invalidConfirmation,
          undefined,
          undefined,
          providerCallId,
        );
      }

      const existing = this.consumedCalls.get(providerCallId);
      if (existing) return Object.freeze({ ...existing, unchanged: true });
      if (this.releasedCalls.has(providerCallId)) {
        throw this.failure(
          PENDING_NUDGE_STORE_FAILURE.leaseConflict,
          undefined,
          undefined,
          providerCallId,
        );
      }

      const lease = this.activeLeases.get(providerCallId);
      if (!lease) {
        throw this.failure(
          PENDING_NUDGE_STORE_FAILURE.leaseNotFound,
          undefined,
          undefined,
          providerCallId,
        );
      }
      const completedNudges = lease.nudgeIds.map((nudgeId) => {
        const candidate = this.nudges.get(nudgeId);
        if (!candidate || candidate.state !== PENDING_NUDGE_STATE.leased) {
          throw this.failure(
            PENDING_NUDGE_STORE_FAILURE.leaseConflict,
            nudgeId,
            lease.targetRunId,
            providerCallId,
          );
        }
        const applied = this.stateMachine.transition(
          candidate,
          NUDGE_STATE_ACTION.dispatchConfirmed,
        );
        const completed = candidate.delivery === "once"
          ? this.stateMachine.transition(applied, NUDGE_STATE_ACTION.consume)
          : this.stateMachine.transition(applied, NUDGE_STATE_ACTION.activate);
        const delivered = capturePendingNudge({
          ...completed,
          deliveryCount: completed.deliveryCount + 1,
        });
        this.nudges.set(nudgeId, delivered);
        return delivered;
      });
      const consumptions = Object.freeze(
        completedNudges
          .filter((nudge) => nudge.state === PENDING_NUDGE_STATE.consumed)
          .map((nudge) => {
          const consumption = Object.freeze({
            nudgeId: nudge.id,
            policyId: nudge.policyId,
            dedupeKey: nudge.dedupeKey,
            leaseId: lease.leaseId,
            providerCallId,
            targetRunId: lease.targetRunId,
            ...(lease.targetTurnNumber === undefined
              ? {}
              : { targetTurnNumber: lease.targetTurnNumber }),
            leasedAt: lease.leasedAt,
            consumedAt: dispatchedAt,
          });
          this.consumptions.set(nudge.id, consumption);
          return consumption;
        }),
      );
      const result = Object.freeze({
        lease,
        nudges: Object.freeze(completedNudges),
        consumptions,
        unchanged: false,
      });
      for (const nudge of completedNudges) {
        this.updateDeliveryAttempt(nudge.id, providerCallId, "confirmed", dispatchedAt);
        if (lease.targetTurnNumber !== undefined) {
          this.deliveredTurns.set(
            nudge.id,
            Object.freeze({
              nudgeId: nudge.id,
              targetRunId: lease.targetRunId,
              policyId: nudge.policyId,
              dedupeKey: nudge.dedupeKey,
              targetTurnNumber: lease.targetTurnNumber,
              deliveredAt: dispatchedAt,
            }),
          );
        }
      }
      this.activeLeases.delete(providerCallId);
      this.consumedCalls.set(providerCallId, result);
      this.logger.info("runtime.nudge.store_delivery_confirmed", {
        targetRunId: lease.targetRunId,
        providerCallId,
        nudgeCount: completedNudges.length,
      });
      return result;
    });
  }

  releaseBeforeDispatch(
    request: NudgeLeaseReleaseRequest,
  ): Promise<NudgeLeaseReleaseResult> {
    return this.run(() => {
      const providerCallId = captureNonBlank(request?.providerCallId);
      if (!providerCallId || !captureTimestamp(request?.releasedAt)) {
        throw this.failure(
          PENDING_NUDGE_STORE_FAILURE.invalidRelease,
          undefined,
          undefined,
          providerCallId,
        );
      }

      const consumed = this.consumedCalls.get(providerCallId);
      if (consumed) {
        return Object.freeze({
          outcome: NUDGE_LEASE_RELEASE_OUTCOME.alreadyConsumed,
          providerCallId,
          nudgeIds: Object.freeze(consumed.lease.nudgeIds.slice()),
        });
      }
      const released = this.releasedCalls.get(providerCallId);
      if (released) {
        return Object.freeze({
          ...released,
          outcome: NUDGE_LEASE_RELEASE_OUTCOME.alreadyReleased,
        });
      }

      const lease = this.activeLeases.get(providerCallId);
      if (!lease) {
        throw this.failure(
          PENDING_NUDGE_STORE_FAILURE.leaseNotFound,
          undefined,
          undefined,
          providerCallId,
        );
      }
      for (const nudgeId of lease.nudgeIds) {
        const candidate = this.nudges.get(nudgeId);
        if (!candidate || candidate.state !== PENDING_NUDGE_STATE.leased) {
          throw this.failure(
            PENDING_NUDGE_STORE_FAILURE.leaseConflict,
            nudgeId,
            lease.targetRunId,
            providerCallId,
          );
        }
        this.nudges.set(
          nudgeId,
          this.stateMachine.transition(candidate, NUDGE_STATE_ACTION.release),
        );
        this.updateDeliveryAttempt(nudgeId, providerCallId, "released", request.releasedAt);
      }
      this.activeLeases.delete(providerCallId);
      const result = Object.freeze({
        outcome: NUDGE_LEASE_RELEASE_OUTCOME.released,
        providerCallId,
        nudgeIds: Object.freeze(lease.nudgeIds.slice()),
      });
      this.releasedCalls.set(providerCallId, result);
      this.logger.debug("runtime.nudge.store_lease_released", {
        targetRunId: lease.targetRunId,
        providerCallId,
        nudgeCount: lease.nudgeIds.length,
      });
      return result;
    });
  }

  acknowledge(request: NudgeAcknowledgementRequest): Promise<PendingNudge> {
    return this.run(() => {
      const nudgeId = captureNonBlank(request?.nudgeId);
      const targetRunId = captureNonBlank(request?.targetRunId);
      const acknowledgedAt = captureTimestamp(request?.acknowledgedAt);
      if (!nudgeId || !targetRunId || !acknowledgedAt) {
        throw this.failure(
          PENDING_NUDGE_STORE_FAILURE.invalidAcknowledgement,
          nudgeId,
          targetRunId,
        );
      }
      const candidate = this.requireNudge(nudgeId, targetRunId, "acknowledgement");
      if (candidate.state === PENDING_NUDGE_STATE.acknowledged) return candidate;
      if (
        candidate.state !== PENDING_NUDGE_STATE.active ||
        !sameJson(candidate.acknowledgementRef, request.acknowledgementRef)
      ) {
        throw this.failure(
          PENDING_NUDGE_STORE_FAILURE.invalidAcknowledgement,
          nudgeId,
          targetRunId,
        );
      }
      const updated = this.stateMachine.transition(
        candidate,
        NUDGE_STATE_ACTION.acknowledge,
      );
      this.nudges.set(nudgeId, updated);
      return updated;
    });
  }

  resolveCondition(request: NudgeConditionResolutionRequest): Promise<PendingNudge> {
    return this.run(() => {
      const nudgeId = captureNonBlank(request?.nudgeId);
      const targetRunId = captureNonBlank(request?.targetRunId);
      const resolvedAt = captureTimestamp(request?.resolvedAt);
      if (!nudgeId || !targetRunId || !resolvedAt) {
        throw this.failure(
          PENDING_NUDGE_STORE_FAILURE.invalidConditionResolution,
          nudgeId,
          targetRunId,
        );
      }
      const candidate = this.requireNudge(nudgeId, targetRunId, "condition");
      if (candidate.state === PENDING_NUDGE_STATE.resolved) return candidate;
      if (
        candidate.state !== PENDING_NUDGE_STATE.active ||
        !sameJson(candidate.conditionRef, request.conditionRef)
      ) {
        throw this.failure(
          PENDING_NUDGE_STORE_FAILURE.invalidConditionResolution,
          nudgeId,
          targetRunId,
        );
      }
      const updated = this.stateMachine.transition(
        candidate,
        NUDGE_STATE_ACTION.resolve,
      );
      this.nudges.set(nudgeId, updated);
      return updated;
    });
  }

  supersede(request: NudgeSupersessionRequest): Promise<PendingNudge> {
    return this.run(() => {
      const nudgeId = captureNonBlank(request?.nudgeId);
      const targetRunId = captureNonBlank(request?.targetRunId);
      const replacementId = captureNonBlank(request?.supersededByNudgeId);
      const supersededAt = captureTimestamp(request?.supersededAt);
      if (!nudgeId || !targetRunId || !replacementId || !supersededAt || nudgeId === replacementId) {
        throw this.failure(
          PENDING_NUDGE_STORE_FAILURE.invalidSupersession,
          nudgeId,
          targetRunId,
        );
      }
      const candidate = this.requireNudge(nudgeId, targetRunId, "supersession");
      if (candidate.state === PENDING_NUDGE_STATE.superseded) return candidate;
      if (
        candidate.state !== PENDING_NUDGE_STATE.scheduled &&
        candidate.state !== PENDING_NUDGE_STATE.active
      ) {
        throw this.failure(
          PENDING_NUDGE_STORE_FAILURE.invalidSupersession,
          nudgeId,
          targetRunId,
        );
      }
      const updated = this.stateMachine.transition(
        candidate,
        NUDGE_STATE_ACTION.supersede,
      );
      this.nudges.set(nudgeId, updated);
      return updated;
    });
  }

  reconcileLeases(): Promise<NudgeLeaseReconciliationResult> {
    return this.run(() => {
      const nudgeIds: string[] = [];
      const providerCallIds = [...this.activeLeases.keys()].sort();
      for (const lease of this.activeLeases.values()) {
        for (const nudgeId of lease.nudgeIds) {
          const candidate = this.nudges.get(nudgeId);
          if (!candidate || candidate.state !== PENDING_NUDGE_STATE.leased) {
            throw this.failure(
              PENDING_NUDGE_STORE_FAILURE.leaseConflict,
              nudgeId,
              lease.targetRunId,
              lease.providerCallId,
            );
          }
          this.nudges.set(
            nudgeId,
            this.stateMachine.transition(candidate, NUDGE_STATE_ACTION.release),
          );
          nudgeIds.push(nudgeId);
        }
        for (const nudgeId of lease.nudgeIds) {
          this.updateDeliveryAttempt(nudgeId, lease.providerCallId, "released");
        }
        this.releasedCalls.set(lease.providerCallId, Object.freeze({
          outcome: NUDGE_LEASE_RELEASE_OUTCOME.released,
          providerCallId: lease.providerCallId,
          nudgeIds: Object.freeze(lease.nudgeIds.slice()),
        }));
      }
      this.activeLeases.clear();
      return Object.freeze({
        nudgeIds: Object.freeze(nudgeIds.sort()),
        providerCallIds: Object.freeze(providerCallIds),
      });
    });
  }

  expire(request: NudgeExpiryRequest): Promise<readonly PendingNudge[]> {
    return this.run(() => {
      const targetRunId = captureNonBlank(request?.targetRunId);
      const evaluatedAt = captureTimestamp(request?.evaluatedAt);
      const currentTurnNumber = captureOptionalPositiveInteger(
        request?.currentTurnNumber,
      );
      if (
        !targetRunId ||
        !evaluatedAt ||
        (request?.currentTurnNumber !== undefined && currentTurnNumber === undefined) ||
        (request?.runEnded !== undefined && typeof request.runEnded !== "boolean")
      ) {
        throw this.failure(
          PENDING_NUDGE_STORE_FAILURE.invalidExpiry,
          undefined,
          targetRunId,
        );
      }

      const expired: PendingNudge[] = [];
      for (const candidate of this.nudges.values()) {
        if (
          candidate.state !== PENDING_NUDGE_STATE.scheduled ||
          candidate.targetRunId !== targetRunId ||
          !shouldExpire(candidate, {
            evaluatedAt,
            currentTurnNumber,
            runEnded: request.runEnded === true,
          })
        ) {
          continue;
        }
        const updated = this.stateMachine.transition(
          candidate,
          NUDGE_STATE_ACTION.expire,
        );
        this.nudges.set(candidate.id, updated);
        expired.push(updated);
      }
      if (expired.length > 0) {
        this.logger.info("runtime.nudge.store_expired", {
          targetRunId,
          expiredCount: expired.length,
        });
      }
      return Object.freeze(expired);
    });
  }

  snapshot(): Promise<PendingNudgeStoreSnapshot> {
    return this.run(() =>
      Object.freeze({
        schemaVersion: PENDING_NUDGE_STORE_SNAPSHOT_SCHEMA_VERSION,
        nudges: Object.freeze([...this.nudges.values()].sort(compareScheduledSequence)),
        leases: Object.freeze(
          [...this.activeLeases.values()].sort((left, right) =>
            left.providerCallId.localeCompare(right.providerCallId),
          ),
        ),
        consumptions: Object.freeze(
          [...this.consumptions.values()].sort((left, right) =>
            left.nudgeId.localeCompare(right.nudgeId),
          ),
        ),
        deliveryAttempts: Object.freeze(
          [...this.deliveryAttempts.values()]
            .flat()
            .sort(compareDeliveryAttempts),
        ),
        deliveryTurns: Object.freeze(
          [...this.deliveredTurns.values()].sort((left, right) =>
            left.nudgeId.localeCompare(right.nudgeId),
          ),
        ),
      }),
    );
  }

  restore(snapshot: PendingNudgeStoreSnapshot): Promise<void> {
    return this.run(() => {
      let captured: PendingNudgeStoreSnapshot;
      try {
        captured = captureSnapshot(snapshot);
      } catch {
        throw this.failure(PENDING_NUDGE_STORE_FAILURE.invalidSnapshot);
      }

      const nextNudges = new Map<string, PendingNudge>();
      const sequences = new Set<number>();
      for (const nudge of captured.nudges) {
        if (nextNudges.has(nudge.id) || sequences.has(nudge.scheduledSequence)) {
          throw this.failure(
            PENDING_NUDGE_STORE_FAILURE.invalidSnapshot,
            nudge.id,
            nudge.targetRunId,
          );
        }
        const restored =
          nudge.state === PENDING_NUDGE_STATE.leased
            ? withState(nudge, PENDING_NUDGE_STATE.scheduled)
            : nudge;
        nextNudges.set(restored.id, restored);
        sequences.add(restored.scheduledSequence);
      }

      const nextDeliveryAttempts = new Map<
        string,
        readonly NudgeDeliveryAttemptRecord[]
      >();
      const attemptKeys = new Set<string>();
      for (const attempt of captured.deliveryAttempts ?? []) {
        const nudge = nextNudges.get(attempt.nudgeId);
        if (!nudge || nudge.targetRunId !== captured.nudges.find(
          (candidate) => candidate.id === attempt.nudgeId,
        )?.targetRunId) {
          throw this.failure(
            PENDING_NUDGE_STORE_FAILURE.invalidSnapshot,
            attempt.nudgeId,
          );
        }
        const key = `${attempt.nudgeId}:${attempt.attemptNumber}`;
        if (attemptKeys.has(key)) {
          throw this.failure(
            PENDING_NUDGE_STORE_FAILURE.invalidSnapshot,
            attempt.nudgeId,
            nudge.targetRunId,
            attempt.providerCallId,
          );
        }
        attemptKeys.add(key);
        const attempts = nextDeliveryAttempts.get(attempt.nudgeId) ?? [];
        nextDeliveryAttempts.set(attempt.nudgeId, Object.freeze([
          ...attempts,
          attempt,
        ]));
      }

      const nextDeliveryTurns = new Map<string, NudgeDeliveryTurnRecord>();
      for (const delivery of captured.deliveryTurns ?? []) {
        const nudge = nextNudges.get(delivery.nudgeId);
        if (
          !nudge ||
          nudge.targetRunId !== delivery.targetRunId ||
          nudge.policyId !== delivery.policyId ||
          nudge.dedupeKey !== delivery.dedupeKey ||
          nextDeliveryTurns.has(delivery.nudgeId)
        ) {
          throw this.failure(
            PENDING_NUDGE_STORE_FAILURE.invalidSnapshot,
            delivery.nudgeId,
            delivery.targetRunId,
          );
        }
        nextDeliveryTurns.set(delivery.nudgeId, delivery);
      }

      const leasedNudgeIds = new Set<string>();
      const leaseIds = new Set<string>();
      const providerCallIds = new Set<string>();
      for (const lease of captured.leases) {
        if (
          leaseIds.has(lease.leaseId) ||
          providerCallIds.has(lease.providerCallId)
        ) {
          throw this.failure(
            PENDING_NUDGE_STORE_FAILURE.invalidSnapshot,
            undefined,
            lease.targetRunId,
            lease.providerCallId,
          );
        }
        for (const nudgeId of lease.nudgeIds) {
          const original = captured.nudges.find((nudge) => nudge.id === nudgeId);
          if (
            !original ||
            original.state !== PENDING_NUDGE_STATE.leased ||
            original.targetRunId !== lease.targetRunId ||
            (original.targetTurnNumber !== undefined &&
              original.targetTurnNumber !== lease.targetTurnNumber) ||
            leasedNudgeIds.has(nudgeId)
          ) {
            throw this.failure(
              PENDING_NUDGE_STORE_FAILURE.invalidSnapshot,
              nudgeId,
              lease.targetRunId,
              lease.providerCallId,
            );
          }
          leasedNudgeIds.add(nudgeId);
        }
        leaseIds.add(lease.leaseId);
        providerCallIds.add(lease.providerCallId);
      }
      if (
        captured.nudges.some(
          (nudge) =>
            nudge.state === PENDING_NUDGE_STATE.leased &&
            !leasedNudgeIds.has(nudge.id),
        )
      ) {
        throw this.failure(PENDING_NUDGE_STORE_FAILURE.invalidSnapshot);
      }

      const nextConsumptions = new Map<string, NudgeConsumptionRecord>();
      for (const consumption of captured.consumptions) {
        const nudge = nextNudges.get(consumption.nudgeId);
        if (
          !nudge ||
          nudge.state !== PENDING_NUDGE_STATE.consumed ||
          nudge.policyId !== consumption.policyId ||
          nudge.dedupeKey !== consumption.dedupeKey ||
          nudge.targetRunId !== consumption.targetRunId ||
          nextConsumptions.has(consumption.nudgeId)
        ) {
          throw this.failure(
            PENDING_NUDGE_STORE_FAILURE.invalidSnapshot,
            consumption.nudgeId,
            consumption.targetRunId,
            consumption.providerCallId,
          );
        }
        nextConsumptions.set(consumption.nudgeId, consumption);
      }
      if (
        [...nextNudges.values()].some(
          (nudge) =>
            nudge.state === PENDING_NUDGE_STATE.consumed &&
            !nextConsumptions.has(nudge.id),
        )
      ) {
        throw this.failure(PENDING_NUDGE_STORE_FAILURE.invalidSnapshot);
      }

      let groups: ConsumptionGroup[];
      try {
        groups = groupConsumptions(nextConsumptions.values());
      } catch {
        throw this.failure(PENDING_NUDGE_STORE_FAILURE.invalidSnapshot);
      }
      const nextConsumedCalls = new Map<
        string,
        NudgeDispatchConfirmationResult
      >();
      for (const group of groups) {
        const nudges = group.records.map((record) => nextNudges.get(record.nudgeId)!);
        let lease: NudgeLease;
        try {
          lease = captureNudgeLease({
            leaseId: group.leaseId,
            providerCallId: group.providerCallId,
            targetRunId: group.targetRunId,
            ...(group.targetTurnNumber === undefined
              ? {}
              : { targetTurnNumber: group.targetTurnNumber }),
            nudgeIds: nudges.map((nudge) => nudge.id),
            leasedAt: group.leasedAt,
          });
        } catch {
          throw this.failure(
            PENDING_NUDGE_STORE_FAILURE.invalidSnapshot,
            undefined,
            group.targetRunId,
            group.providerCallId,
          );
        }
        nextConsumedCalls.set(
          group.providerCallId,
          Object.freeze({
            lease,
            nudges: Object.freeze(nudges),
            consumptions: Object.freeze(group.records),
            unchanged: false,
          }),
        );
      }

      const nextReleasedCalls = new Map<string, NudgeLeaseReleaseResult>();
      for (const group of groupDeliveryAttempts(captured.deliveryAttempts ?? [])) {
        const nudges = group.nudgeIds.map((nudgeId) => nextNudges.get(nudgeId));
        if (nudges.some((nudge) => nudge === undefined)) {
          throw this.failure(PENDING_NUDGE_STORE_FAILURE.invalidSnapshot);
        }
        const capturedNudges = nudges as PendingNudge[];
        const targetRunId = capturedNudges[0]!.targetRunId;
        const targetTurnNumber = capturedNudges[0]!.targetTurnNumber;
        if (capturedNudges.some(
          (nudge) =>
            nudge!.targetRunId !== targetRunId ||
            nudge!.targetTurnNumber !== targetTurnNumber,
        )) {
          throw this.failure(PENDING_NUDGE_STORE_FAILURE.invalidSnapshot);
        }
        let lease: NudgeLease;
        try {
          lease = captureNudgeLease({
            leaseId: group.leaseId,
            providerCallId: group.providerCallId,
            targetRunId,
            ...(targetTurnNumber === undefined ? {} : { targetTurnNumber }),
            nudgeIds: group.nudgeIds,
            leasedAt: group.leasedAt,
          });
        } catch {
          throw this.failure(
            PENDING_NUDGE_STORE_FAILURE.invalidSnapshot,
            undefined,
            targetRunId,
            group.providerCallId,
          );
        }
        if (group.status === "confirmed" && !nextConsumedCalls.has(group.providerCallId)) {
          nextConsumedCalls.set(
            group.providerCallId,
            Object.freeze({
              lease,
              nudges: Object.freeze(capturedNudges),
              consumptions: Object.freeze(
                group.nudgeIds
                  .map((nudgeId) => nextConsumptions.get(nudgeId))
                  .filter((record): record is NudgeConsumptionRecord => record !== undefined),
              ),
              unchanged: false,
            }),
          );
        }
        if (group.status === "released") {
          nextReleasedCalls.set(group.providerCallId, Object.freeze({
            outcome: NUDGE_LEASE_RELEASE_OUTCOME.released,
            providerCallId: group.providerCallId,
            nudgeIds: Object.freeze(group.nudgeIds.slice()),
          }));
        }
      }

      this.nudges.clear();
      for (const [id, nudge] of nextNudges) this.nudges.set(id, nudge);
      this.consumptions.clear();
      for (const [id, consumption] of nextConsumptions) {
        this.consumptions.set(id, consumption);
      }
      this.consumedCalls.clear();
      for (const [id, result] of nextConsumedCalls) {
        this.consumedCalls.set(id, result);
      }
      this.activeLeases.clear();
      this.releasedCalls.clear();
      for (const [id, result] of nextReleasedCalls) {
        this.releasedCalls.set(id, result);
      }
      this.deliveryAttempts.clear();
      for (const [id, attempts] of nextDeliveryAttempts) {
        this.deliveryAttempts.set(id, attempts);
      }
      this.deliveredTurns.clear();
      for (const [id, delivery] of nextDeliveryTurns) {
        this.deliveredTurns.set(id, delivery);
      }
      this.logger.info("runtime.nudge.store_restored", {
        nudgeCount: this.nudges.size,
        consumptionCount: this.consumptions.size,
      });
    });
  }

  private run<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private requireNudge(
    nudgeId: string,
    targetRunId: string,
    _operation: string,
  ): PendingNudge {
    const nudge = this.nudges.get(nudgeId);
    if (!nudge || nudge.targetRunId !== targetRunId) {
      throw this.failure(
        PENDING_NUDGE_STORE_FAILURE.invalidNudge,
        nudgeId,
        targetRunId,
      );
    }
    return nudge;
  }

  private updateDeliveryAttempt(
    nudgeId: string,
    providerCallId: string,
    status: NudgeDeliveryAttemptRecord["status"],
    completedAt?: string,
  ): void {
    const attempts = this.deliveryAttempts.get(nudgeId) ?? [];
    const index = [...attempts].reverse().findIndex(
      (attempt) => attempt.providerCallId === providerCallId && attempt.status === "leased",
    );
    if (index < 0) return;
    const actualIndex = attempts.length - 1 - index;
    const updated = Object.freeze({
      ...attempts[actualIndex]!,
      status,
      ...(completedAt === undefined ? {} : { completedAt }),
    });
    const next = [...attempts];
    next[actualIndex] = updated;
    this.deliveryAttempts.set(nudgeId, Object.freeze(next));
  }

  /** 清理某 nudge 的全部关联记录（跨 run 重新激活前调用），保住 snapshot/restore 不变式：
   *  consumption 的 nudge 必须 consumed、deliveryTurn/deliveryAttempt 的 targetRunId 必须匹配。 */
  private removeNudgeRecords(nudgeId: string): void {
    this.consumptions.delete(nudgeId);
    this.deliveredTurns.delete(nudgeId);
    this.deliveryAttempts.delete(nudgeId);
    for (const [providerCallId, result] of this.consumedCalls) {
      if (result.lease.nudgeIds.includes(nudgeId)) {
        this.consumedCalls.delete(providerCallId);
      }
    }
    for (const [providerCallId, result] of this.releasedCalls) {
      if (result.nudgeIds.includes(nudgeId)) {
        this.releasedCalls.delete(providerCallId);
      }
    }
  }

  private captureScheduledNudge(nudge: PendingNudge): PendingNudge {
    let captured: PendingNudge;
    try {
      captured = capturePendingNudge(nudge);
    } catch {
      throw this.failure(
        PENDING_NUDGE_STORE_FAILURE.invalidNudge,
        captureNonBlank(nudge?.id),
        captureNonBlank(nudge?.targetRunId),
      );
    }
    if (captured.state !== PENDING_NUDGE_STATE.scheduled) {
      throw this.failure(
        PENDING_NUDGE_STORE_FAILURE.invalidNudge,
        captured.id,
        captured.targetRunId,
      );
    }
    return captured;
  }

  private captureLease(lease: NudgeLease): NudgeLease {
    try {
      return captureNudgeLease(lease);
    } catch {
      throw this.failure(
        PENDING_NUDGE_STORE_FAILURE.invalidLease,
        undefined,
        captureNonBlank(lease?.targetRunId),
        captureNonBlank(lease?.providerCallId),
      );
    }
  }

  private freezeLeaseResult(
    lease: NudgeLease,
    unchanged: boolean,
  ): PendingNudgeLeaseResult {
    return Object.freeze({
      lease,
      nudges: Object.freeze(
        lease.nudgeIds.map((nudgeId) => {
          const nudge = this.nudges.get(nudgeId);
          if (!nudge) {
            throw this.failure(
              PENDING_NUDGE_STORE_FAILURE.leaseConflict,
              nudgeId,
              lease.targetRunId,
              lease.providerCallId,
            );
          }
          return nudge;
        }),
      ),
      unchanged,
    });
  }

  private failure(
    failure: PendingNudgeStoreFailure,
    nudgeId?: string,
    targetRunId?: string,
    providerCallId?: string,
  ): PendingNudgeStoreError {
    this.logger.error("runtime.nudge.store_failed", {
      failure,
      ...(nudgeId ? { nudgeId } : {}),
      ...(targetRunId ? { targetRunId } : {}),
      ...(providerCallId ? { providerCallId } : {}),
    });
    return new PendingNudgeStoreError(
      failure,
      nudgeId,
      targetRunId,
      providerCallId,
    );
  }
}

interface ExpiryContext {
  readonly evaluatedAt: string;
  readonly currentTurnNumber?: number;
  readonly runEnded: boolean;
}

interface ConsumptionGroup {
  readonly leaseId: string;
  readonly providerCallId: string;
  readonly targetRunId: string;
  readonly targetTurnNumber?: number;
  readonly leasedAt: string;
  readonly consumedAt: string;
  readonly records: readonly NudgeConsumptionRecord[];
}

interface DeliveryAttemptGroup {
  readonly leaseId: string;
  readonly providerCallId: string;
  readonly leasedAt: string;
  readonly status: NudgeDeliveryAttemptRecord["status"];
  readonly nudgeIds: readonly string[];
}

function groupDeliveryAttempts(
  attempts: readonly NudgeDeliveryAttemptRecord[],
): DeliveryAttemptGroup[] {
  const groups = new Map<string, NudgeDeliveryAttemptRecord[]>();
  for (const attempt of attempts) {
    if (attempt.status === "leased") continue;
    const records = groups.get(attempt.providerCallId) ?? [];
    records.push(attempt);
    groups.set(attempt.providerCallId, records);
  }
  return [...groups.values()].map((records) => {
    const first = records[0]!;
    if (records.some(
      (record) =>
        record.leaseId !== first.leaseId ||
        record.status !== first.status ||
        record.leasedAt !== first.leasedAt,
    )) {
      throw new Error();
    }
    return Object.freeze({
      leaseId: first.leaseId,
      providerCallId: first.providerCallId,
      leasedAt: first.leasedAt,
      status: first.status,
      nudgeIds: Object.freeze(
        records
          .sort((left, right) => left.nudgeId.localeCompare(right.nudgeId))
          .map((record) => record.nudgeId),
      ),
    });
  });
}

function shouldExpire(nudge: PendingNudge, context: ExpiryContext): boolean {
  if (context.runEnded) return true;
  if (
    nudge.expiresAt !== undefined &&
    Date.parse(context.evaluatedAt) >= Date.parse(nudge.expiresAt)
  ) {
    return true;
  }
  if (context.currentTurnNumber === undefined) return false;
  if (
    nudge.targetTurnNumber !== undefined &&
    context.currentTurnNumber > nudge.targetTurnNumber
  ) {
    return true;
  }
  return (
    nudge.expiresAfterTurn !== undefined &&
    context.currentTurnNumber > nudge.expiresAfterTurn
  );
}

function compareScheduledSequence(left: PendingNudge, right: PendingNudge): number {
  if (left.scheduledSequence === right.scheduledSequence) return 0;
  return left.scheduledSequence < right.scheduledSequence ? -1 : 1;
}

function compareDeliveryAttempts(
  left: NudgeDeliveryAttemptRecord,
  right: NudgeDeliveryAttemptRecord,
): number {
  if (left.nudgeId !== right.nudgeId) {
    return left.nudgeId.localeCompare(right.nudgeId);
  }
  return left.attemptNumber - right.attemptNumber;
}

function withState(nudge: PendingNudge, state: PendingNudge["state"]): PendingNudge {
  return capturePendingNudge({ ...nudge, state });
}

function sameJson(left: unknown, right: unknown): boolean {
  return (
    canonicalStringifyJson(left as JsonValue) ===
    canonicalStringifyJson(right as JsonValue)
  );
}

function sameScheduledIdentity(
  existing: PendingNudge,
  scheduled: PendingNudge,
): boolean {
  // deliveryCount 是运行时累计计数器，不属于"计划身份"；重排期（unchanged 判定）
  // 时两边归零再比较，否则已交付（deliveryCount>0）的 nudge 重排会误判为冲突。
  return sameJson(
    withState(withoutDeliveryCount(existing), PENDING_NUDGE_STATE.scheduled),
    withoutDeliveryCount(scheduled),
  );
}

function withoutDeliveryCount(nudge: PendingNudge): PendingNudge {
  return Object.freeze({ ...nudge, deliveryCount: 0 });
}

function freezeScheduleResult(
  outcome: NudgeScheduleResult["outcome"],
  nudge: PendingNudge,
): NudgeScheduleResult {
  return Object.freeze({ outcome, nudge });
}

function captureSnapshot(value: unknown): PendingNudgeStoreSnapshot {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== 1 &&
      value.schemaVersion !== PENDING_NUDGE_STORE_SNAPSHOT_SCHEMA_VERSION)
  ) throw new Error();
  if (
    !Array.isArray(value.nudges) ||
    !Array.isArray(value.leases) ||
    !Array.isArray(value.consumptions)
  ) {
    throw new Error();
  }
  if (value.deliveryAttempts !== undefined && !Array.isArray(value.deliveryAttempts)) {
    throw new Error();
  }
  if (value.deliveryTurns !== undefined && !Array.isArray(value.deliveryTurns)) {
    throw new Error();
  }
  return Object.freeze({
    schemaVersion: PENDING_NUDGE_STORE_SNAPSHOT_SCHEMA_VERSION,
    nudges: Object.freeze(value.nudges.map((nudge) => capturePendingNudge(nudge))),
    leases: Object.freeze(value.leases.map((lease) => captureNudgeLease(lease))),
    consumptions: Object.freeze(
      value.consumptions.map((consumption) => captureConsumption(consumption)),
    ),
    deliveryAttempts: Object.freeze(
      (value.deliveryAttempts ?? []).map((attempt) => captureDeliveryAttempt(attempt)),
    ),
    deliveryTurns: Object.freeze(
      (value.deliveryTurns ?? []).map((delivery) => captureDeliveryTurn(delivery)),
    ),
  });
}

function captureDeliveryTurn(value: unknown): NudgeDeliveryTurnRecord {
  if (!isRecord(value)) throw new Error();
  return Object.freeze({
    nudgeId: requireNonBlank(value.nudgeId),
    targetRunId: requireNonBlank(value.targetRunId),
    policyId: requireNonBlank(value.policyId),
    dedupeKey: requireNonBlank(value.dedupeKey),
    targetTurnNumber: requirePositiveInteger(value.targetTurnNumber),
    deliveredAt: requireTimestamp(value.deliveredAt),
  });
}

function captureDeliveryAttempt(value: unknown): NudgeDeliveryAttemptRecord {
  if (!isRecord(value)) throw new Error();
  return Object.freeze({
    nudgeId: requireNonBlank(value.nudgeId),
    leaseId: requireNonBlank(value.leaseId),
    providerCallId: requireNonBlank(value.providerCallId),
    attemptNumber: requirePositiveInteger(value.attemptNumber),
    leasedAt: requireTimestamp(value.leasedAt),
    status: captureAttemptStatus(value.status),
    ...(value.completedAt === undefined
      ? {}
      : { completedAt: requireTimestamp(value.completedAt) }),
  });
}

function captureAttemptStatus(value: unknown): NudgeDeliveryAttemptRecord["status"] {
  if (value === undefined) return "leased";
  if (value !== "leased" && value !== "released" && value !== "confirmed") {
    throw new Error();
  }
  return value;
}

function captureConsumption(value: unknown): NudgeConsumptionRecord {
  if (!isRecord(value)) throw new Error();
  const targetTurnNumber = captureOptionalPositiveInteger(value.targetTurnNumber);
  if (value.targetTurnNumber !== undefined && targetTurnNumber === undefined) {
    throw new Error();
  }
  return Object.freeze({
    nudgeId: requireNonBlank(value.nudgeId),
    policyId: requireNonBlank(value.policyId),
    dedupeKey: requireNonBlank(value.dedupeKey),
    leaseId: requireNonBlank(value.leaseId),
    providerCallId: requireNonBlank(value.providerCallId),
    targetRunId: requireNonBlank(value.targetRunId),
    ...(targetTurnNumber === undefined ? {} : { targetTurnNumber }),
    leasedAt: requireTimestamp(value.leasedAt),
    consumedAt: requireTimestamp(value.consumedAt),
  });
}

function groupConsumptions(
  consumptions: Iterable<NudgeConsumptionRecord>,
): ConsumptionGroup[] {
  const groups = new Map<string, NudgeConsumptionRecord[]>();
  for (const consumption of consumptions) {
    const records = groups.get(consumption.providerCallId) ?? [];
    records.push(consumption);
    groups.set(consumption.providerCallId, records);
  }
  return [...groups.values()].map((records) => {
    const first = records[0]!;
    if (
      records.some(
        (record) =>
          record.leaseId !== first.leaseId ||
          record.targetRunId !== first.targetRunId ||
          record.targetTurnNumber !== first.targetTurnNumber ||
          record.leasedAt !== first.leasedAt ||
          record.consumedAt !== first.consumedAt,
      )
    ) {
      throw new Error();
    }
    return Object.freeze({
      leaseId: first.leaseId,
      providerCallId: first.providerCallId,
      targetRunId: first.targetRunId,
      ...(first.targetTurnNumber === undefined
        ? {}
        : { targetTurnNumber: first.targetTurnNumber }),
      leasedAt: first.leasedAt,
      consumedAt: first.consumedAt,
      records: Object.freeze(
        records.sort((left, right) => left.nudgeId.localeCompare(right.nudgeId)),
      ),
    });
  });
}

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function requireNonBlank(value: unknown): string {
  const captured = captureNonBlank(value);
  if (!captured) throw new Error();
  return captured;
}

function captureTimestamp(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    return undefined;
  }
  return value;
}

function requireTimestamp(value: unknown): string {
  const captured = captureTimestamp(value);
  if (!captured) throw new Error();
  return captured;
}

function captureOptionalPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : undefined;
}

function requirePositiveInteger(value: unknown): number {
  const captured = captureOptionalPositiveInteger(value);
  if (captured === undefined) throw new Error();
  return captured;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cooldownKey(
  targetRunId: string,
  policyId: string,
  dedupeKey: string,
): string {
  return `${targetRunId}\u0000${policyId}\u0000${dedupeKey}`;
}
