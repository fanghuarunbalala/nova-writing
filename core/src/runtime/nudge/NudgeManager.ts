/** Coordinates Pending Nudge state, selection, rendering, and dispatch barriers. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  NUDGE_DELIVERY,
  NUDGE_PLACEMENT,
  PENDING_NUDGE_STATE,
  type NudgeEffect,
  type NudgeLease,
  type NudgeLeaseRequest,
  type PendingNudge,
  type SystemReminderOverlay,
} from "./NudgeProtocol.js";
import {
  captureNudgeEffect,
  captureNudgeLeaseRequest,
} from "./NudgeProtocolValidator.js";
import type {
  NudgeDispatchConfirmationResult,
  NudgeExpiryRequest,
  NudgeLeaseReleaseResult,
  NudgeScheduleResult,
  PendingNudgeLeaseResult,
  PendingNudgeStore,
  PendingNudgeStoreSnapshot,
} from "./PendingNudgeStore.js";
import {
  NUDGE_MANAGER_FAILURE,
  NudgeManagerError,
  type NudgeManagerFailure,
} from "./NudgeManagerErrors.js";
import { NudgeRenderer } from "./NudgeRenderer.js";
import { NudgeSelector } from "./NudgeSelector.js";

export interface NudgeScheduleRequest {
  readonly nudgeId: string;
  readonly effect: NudgeEffect;
  readonly scheduledSequence: number;
  readonly scheduledAt: string;
}

export interface NudgeLeaseIdFactory {
  create(request: NudgeLeaseRequest, nudgeIds: readonly string[]): string;
}

export class RandomNudgeLeaseIdFactory implements NudgeLeaseIdFactory {
  create(_request: NudgeLeaseRequest, _nudgeIds: readonly string[]): string {
    return `nudge_lease_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
  }
}

export interface LeasedSystemReminderOverlay {
  readonly lease: NudgeLease;
  readonly overlay: SystemReminderOverlay;
}

export interface NudgeManagerOptions {
  readonly store: PendingNudgeStore;
  readonly selector: NudgeSelector;
  readonly renderer: NudgeRenderer;
  readonly leaseIdFactory?: NudgeLeaseIdFactory;
  readonly logger?: Logger;
}

export class NudgeManager {
  private readonly store: PendingNudgeStore;
  private readonly selector: NudgeSelector;
  private readonly renderer: NudgeRenderer;
  private readonly leaseIdFactory: NudgeLeaseIdFactory;
  private readonly logger: Logger;

  constructor(options: NudgeManagerOptions) {
    this.store = options.store;
    this.selector = options.selector;
    this.renderer = options.renderer;
    this.leaseIdFactory = options.leaseIdFactory ?? new RandomNudgeLeaseIdFactory();
    this.logger = (options.logger ?? noopLogger).child({
      component: "nudge_manager",
    });
  }

  async schedule(request: NudgeScheduleRequest): Promise<NudgeScheduleResult> {
    const nudgeId = captureNonBlank(request?.nudgeId);
    const targetRunId = captureNonBlank(request?.effect?.targetRunId);
    try {
      const effect = captureNudgeEffect(request.effect);
      if (
        !nudgeId ||
        !Number.isSafeInteger(request.scheduledSequence) ||
        request.scheduledSequence < 1 ||
        !isTimestamp(request.scheduledAt)
      ) {
        throw this.failure(
          NUDGE_MANAGER_FAILURE.invalidSchedule,
          nudgeId,
          targetRunId,
        );
      }
      const nudge = createPendingNudge(request, effect, nudgeId);
      const result = await this.store.schedule(nudge);
      this.logger.info("runtime.nudge.schedule_completed", {
        nudgeId: result.nudge.id,
        targetRunId: result.nudge.targetRunId,
        outcome: result.outcome,
      });
      return result;
    } catch (error) {
      const normalized =
        error instanceof NudgeManagerError
          ? error
          : this.failure(
              NUDGE_MANAGER_FAILURE.scheduleFailed,
              nudgeId,
              targetRunId,
            );
      this.logFailure(normalized);
      throw normalized;
    }
  }

  async leaseForProviderCall(
    request: NudgeLeaseRequest,
  ): Promise<LeasedSystemReminderOverlay | undefined> {
    const targetRunId = captureNonBlank(request?.targetRunId);
    const providerCallId = captureNonBlank(request?.providerCallId);
    try {
      const capturedRequest = captureNudgeLeaseRequest(request);
      const active = await this.store.getActiveLease(capturedRequest.providerCallId);
      if (active) {
        this.assertLeaseIdentity(active, capturedRequest);
        return this.renderLeased(active, capturedRequest.requestedAt);
      }

      const [candidates, cooldowns] = await Promise.all([
        this.store.list(),
        this.store.listCooldowns(),
      ]);
      let selected: readonly PendingNudge[];
      try {
        selected = this.selector.select(candidates, capturedRequest, cooldowns);
      } catch {
        throw this.failure(
          NUDGE_MANAGER_FAILURE.selectionFailed,
          undefined,
          targetRunId,
          providerCallId,
        );
      }
      if (selected.length === 0) {
        this.logger.debug("runtime.nudge.lease_skipped", {
          targetRunId: capturedRequest.targetRunId,
          providerCallId: capturedRequest.providerCallId,
        });
        return undefined;
      }

      const leaseId = this.leaseIdFactory.create(
        capturedRequest,
        selected.map((nudge) => nudge.id),
      );
      const lease: NudgeLease = Object.freeze({
        leaseId,
        providerCallId: capturedRequest.providerCallId,
        targetRunId: capturedRequest.targetRunId,
        ...(capturedRequest.targetTurnNumber === undefined
          ? {}
          : { targetTurnNumber: capturedRequest.targetTurnNumber }),
        nudgeIds: Object.freeze(selected.map((nudge) => nudge.id)),
        leasedAt: capturedRequest.requestedAt,
      });
      let leased: PendingNudgeLeaseResult;
      try {
        leased = await this.store.lease(lease);
      } catch {
        throw this.failure(
          NUDGE_MANAGER_FAILURE.leaseFailed,
          undefined,
          targetRunId,
          providerCallId,
        );
      }
      return this.renderLeased(leased, capturedRequest.requestedAt);
    } catch (error) {
      const normalized =
        error instanceof NudgeManagerError
          ? error
          : this.failure(
              NUDGE_MANAGER_FAILURE.leaseFailed,
              undefined,
              targetRunId,
              providerCallId,
            );
      this.logFailure(normalized);
      throw normalized;
    }
  }

  async confirmDelivered(
    providerCallId: string,
    dispatchedAt: string,
  ): Promise<NudgeDispatchConfirmationResult> {
    const safeProviderCallId = captureNonBlank(providerCallId);
    try {
      const result = await this.store.confirmDispatched({
        providerCallId,
        dispatchedAt,
      });
      this.logger.info("runtime.nudge.delivery_confirmed", {
        targetRunId: result.lease.targetRunId,
        providerCallId: result.lease.providerCallId,
        nudgeCount: result.nudges.length,
        unchanged: result.unchanged,
      });
      return result;
    } catch {
      const normalized = this.failure(
        NUDGE_MANAGER_FAILURE.confirmationFailed,
        undefined,
        undefined,
        safeProviderCallId,
      );
      this.logFailure(normalized);
      throw normalized;
    }
  }

  async releaseLease(
    providerCallId: string,
    releasedAt: string,
  ): Promise<NudgeLeaseReleaseResult> {
    const safeProviderCallId = captureNonBlank(providerCallId);
    try {
      const result = await this.store.releaseBeforeDispatch({
        providerCallId,
        releasedAt,
      });
      this.logger.debug("runtime.nudge.lease_release_completed", {
        ...(safeProviderCallId ? { providerCallId: safeProviderCallId } : {}),
        outcome: result.outcome,
        nudgeCount: result.nudgeIds.length,
      });
      return result;
    } catch {
      const normalized = this.failure(
        NUDGE_MANAGER_FAILURE.releaseFailed,
        undefined,
        undefined,
        safeProviderCallId,
      );
      this.logFailure(normalized);
      throw normalized;
    }
  }

  async expire(request: NudgeExpiryRequest): Promise<readonly PendingNudge[]> {
    const targetRunId = captureNonBlank(request?.targetRunId);
    try {
      const expired = await this.store.expire(request);
      this.logger.info("runtime.nudge.expiry_completed", {
        ...(targetRunId ? { targetRunId } : {}),
        expiredCount: expired.length,
      });
      return expired;
    } catch {
      const normalized = this.failure(
        NUDGE_MANAGER_FAILURE.expiryFailed,
        undefined,
        targetRunId,
      );
      this.logFailure(normalized);
      throw normalized;
    }
  }

  async snapshot(): Promise<PendingNudgeStoreSnapshot> {
    try {
      return await this.store.snapshot();
    } catch {
      const normalized = this.failure(NUDGE_MANAGER_FAILURE.snapshotFailed);
      this.logFailure(normalized);
      throw normalized;
    }
  }

  async restore(snapshot: PendingNudgeStoreSnapshot): Promise<void> {
    try {
      await this.store.restore(snapshot);
      this.logger.info("runtime.nudge.restore_completed", {
        nudgeCount: Array.isArray(snapshot?.nudges) ? snapshot.nudges.length : 0,
      });
    } catch {
      const normalized = this.failure(NUDGE_MANAGER_FAILURE.restoreFailed);
      this.logFailure(normalized);
      throw normalized;
    }
  }

  private async renderLeased(
    leased: PendingNudgeLeaseResult,
    releasedAt: string,
  ): Promise<LeasedSystemReminderOverlay> {
    let overlay: SystemReminderOverlay;
    try {
      overlay = this.renderer.render(leased.nudges);
    } catch {
      await this.releaseAfterPreDispatchFailure(
        leased.lease.providerCallId,
        releasedAt,
      );
      throw this.failure(
        NUDGE_MANAGER_FAILURE.renderFailed,
        undefined,
        leased.lease.targetRunId,
        leased.lease.providerCallId,
      );
    }
    this.logger.info("runtime.nudge.lease_completed", {
      targetRunId: leased.lease.targetRunId,
      providerCallId: leased.lease.providerCallId,
      nudgeCount: overlay.nudgeIds.length,
      unchanged: leased.unchanged,
    });
    return Object.freeze({ lease: leased.lease, overlay });
  }

  private assertLeaseIdentity(
    active: PendingNudgeLeaseResult,
    request: NudgeLeaseRequest,
  ): void {
    if (
      active.lease.targetRunId !== request.targetRunId ||
      active.lease.targetTurnNumber !== request.targetTurnNumber
    ) {
      throw this.failure(
        NUDGE_MANAGER_FAILURE.leaseFailed,
        undefined,
        request.targetRunId,
        request.providerCallId,
      );
    }
  }

  private async releaseAfterPreDispatchFailure(
    providerCallId: string,
    releasedAt: string,
  ): Promise<void> {
    try {
      await this.store.releaseBeforeDispatch({ providerCallId, releasedAt });
      this.logger.debug("runtime.nudge.lease_released_before_dispatch", {
        providerCallId,
      });
    } catch {
      throw this.failure(
        NUDGE_MANAGER_FAILURE.releaseFailed,
        undefined,
        undefined,
        providerCallId,
      );
    }
  }

  private failure(
    failure: NudgeManagerFailure,
    nudgeId?: string,
    targetRunId?: string,
    providerCallId?: string,
  ): NudgeManagerError {
    return new NudgeManagerError(
      failure,
      nudgeId,
      targetRunId,
      providerCallId,
    );
  }

  private logFailure(error: NudgeManagerError): void {
    this.logger.error("runtime.nudge.manager_failed", {
      failure: error.failure,
      ...(error.nudgeId ? { nudgeId: error.nudgeId } : {}),
      ...(error.targetRunId ? { targetRunId: error.targetRunId } : {}),
      ...(error.providerCallId ? { providerCallId: error.providerCallId } : {}),
    });
  }
}

function createPendingNudge(
  request: NudgeScheduleRequest,
  effect: NudgeEffect,
  nudgeId: string,
): PendingNudge {
  return Object.freeze({
    id: nudgeId,
    policyId: effect.policyId,
    templateId: effect.templateId,
    templateVersion: effect.templateVersion,
    priority: effect.priority,
    dedupeKey: effect.dedupeKey,
    parameters: effect.parameters,
    exclusive: effect.exclusive ?? false,
    placement: NUDGE_PLACEMENT.systemPromptOverlay,
    delivery: effect.delivery ?? NUDGE_DELIVERY.once,
    ...(effect.acknowledgementRef === undefined
      ? {}
      : { acknowledgementRef: effect.acknowledgementRef }),
    ...(effect.conditionRef === undefined
      ? {}
      : { conditionRef: effect.conditionRef }),
    state: PENDING_NUDGE_STATE.scheduled,
    targetRunId: effect.targetRunId,
    ...(effect.targetTurnNumber === undefined
      ? {}
      : { targetTurnNumber: effect.targetTurnNumber }),
    scheduledSequence: request.scheduledSequence,
    scheduledAt: request.scheduledAt,
    ...(effect.cooldownTurns === undefined
      ? {}
      : { cooldownTurns: effect.cooldownTurns }),
    ...(effect.expiresAfterTurn === undefined
      ? {}
      : { expiresAfterTurn: effect.expiresAfterTurn }),
    ...(effect.expiresAt === undefined ? {} : { expiresAt: effect.expiresAt }),
  });
}

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
