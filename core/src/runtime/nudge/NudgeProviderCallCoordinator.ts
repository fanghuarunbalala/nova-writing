/** Coordinates one-shot Nudge state around an exact Provider dispatch barrier. */
import {
  OUTPUT_EVENT_TYPE,
  SystemReminderInjectedOutputEvent,
} from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type {
  RuntimeEventAppendReceipt,
  RuntimeEventSink,
} from "../execution/index.js";
import {
  type LeasedSystemReminderOverlay,
  NudgeManager,
} from "./NudgeManager.js";
import type {
  NudgeDispatchConfirmationResult,
  NudgeLeaseReleaseResult,
  PendingNudgeStoreSnapshot,
} from "./PendingNudgeStore.js";
import {
  createNudgeProviderCallReceipt,
  InMemoryNudgeProviderCallReceiptStore,
  type NudgeProviderCallReceipt,
  type NudgeProviderCallReceiptStore,
} from "./NudgeProviderCallReceipt.js";
import {
  NUDGE_PROVIDER_CALL_FAILURE,
  NudgeProviderCallCoordinatorError,
  type NudgeProviderCallFailure,
} from "./NudgeProviderCallCoordinatorErrors.js";

export interface NudgePrivateStateCommitter {
  commit(snapshot: PendingNudgeStoreSnapshot): Promise<void>;
}

export interface NudgeLifecycleEventIdInput {
  readonly conversationId: string;
  readonly runId: string;
  readonly eventType: string;
  readonly nudgeId: string;
  readonly providerCallId: string;
}

export interface NudgeLifecycleEventIdFactory {
  create(input: NudgeLifecycleEventIdInput): string;
}

export interface PrepareNudgeProviderCallRequest {
  readonly conversationId: string;
  readonly runId: string;
  readonly providerCallId: string;
  readonly targetTurnNumber?: number;
  readonly requestedAt: string;
  readonly requestedLimit?: number;
}

export interface PreparedNudgeProviderCall
  extends LeasedSystemReminderOverlay {
  readonly conversationId: string;
  readonly runId: string;
  readonly providerCallId: string;
}

export interface ConfirmNudgeProviderDispatchResult {
  readonly confirmation: NudgeDispatchConfirmationResult;
  readonly receipt: NudgeProviderCallReceipt;
  readonly eventReceipts: readonly RuntimeEventAppendReceipt[];
}

export interface NudgeProviderCallCoordinatorOptions {
  readonly manager: NudgeManager;
  readonly privateStateCommitter: NudgePrivateStateCommitter;
  readonly eventSink: RuntimeEventSink;
  readonly eventIdFactory: NudgeLifecycleEventIdFactory;
  readonly receiptStore?: NudgeProviderCallReceiptStore;
  readonly logger?: Logger;
}

export class NudgeProviderCallCoordinator {
  private readonly manager: NudgeManager;
  private readonly privateStateCommitter: NudgePrivateStateCommitter;
  private readonly eventSink: RuntimeEventSink;
  private readonly eventIdFactory: NudgeLifecycleEventIdFactory;
  private readonly receiptStore: NudgeProviderCallReceiptStore;
  private readonly logger: Logger;

  constructor(options: NudgeProviderCallCoordinatorOptions) {
    this.manager = options.manager;
    this.privateStateCommitter = options.privateStateCommitter;
    this.eventSink = options.eventSink;
    this.eventIdFactory = options.eventIdFactory;
    this.receiptStore =
      options.receiptStore ?? new InMemoryNudgeProviderCallReceiptStore();
    this.logger = (options.logger ?? noopLogger).child({
      component: "nudge_provider_call_coordinator",
    });
  }

  async prepare(
    request: PrepareNudgeProviderCallRequest,
  ): Promise<PreparedNudgeProviderCall | undefined> {
    const identity = captureIdentity(request);
    try {
      assertRequest(request, identity);
      const leased = await this.manager.leaseForProviderCall({
        providerCallId: identity.providerCallId!,
        targetRunId: identity.runId!,
        ...(request.targetTurnNumber === undefined
          ? {}
          : { targetTurnNumber: request.targetTurnNumber }),
        ...(request.requestedLimit === undefined
          ? {}
          : { requestedLimit: request.requestedLimit }),
        requestedAt: request.requestedAt,
      });
      if (!leased) return undefined;

      try {
        await this.commitPrivateState();
      } catch {
        await this.rollbackPreparedLease(
          leased.lease.providerCallId,
          request.requestedAt,
          identity,
        );
        throw this.failure(
          NUDGE_PROVIDER_CALL_FAILURE.privateStateCommitFailed,
          identity,
        );
      }
      this.logger.info("runtime.nudge.provider_call_prepared", {
        conversationId: identity.conversationId!,
        runId: identity.runId!,
        providerCallId: identity.providerCallId!,
        nudgeCount: leased.overlay.nudgeIds.length,
      });
      return Object.freeze({
        conversationId: identity.conversationId!,
        runId: identity.runId!,
        providerCallId: identity.providerCallId!,
        lease: leased.lease,
        overlay: leased.overlay,
      });
    } catch (error) {
      const normalized =
        error instanceof NudgeProviderCallCoordinatorError
          ? error
          : this.failure(NUDGE_PROVIDER_CALL_FAILURE.prepareFailed, identity);
      this.logFailure(normalized);
      throw normalized;
    }
  }

  async confirmDispatched(
    prepared: PreparedNudgeProviderCall,
    dispatchedAt: string,
  ): Promise<ConfirmNudgeProviderDispatchResult> {
    const identity = captureIdentity(prepared);
    try {
      assertPrepared(prepared, identity);
      assertTimestamp(dispatchedAt);
      const confirmation = await this.manager.confirmDelivered(
        identity.providerCallId!,
        dispatchedAt,
      );
      try {
        await this.commitPrivateState();
      } catch {
        throw this.failure(
          NUDGE_PROVIDER_CALL_FAILURE.privateStateCommitFailed,
          identity,
        );
      }

      let recordedReceipt: NudgeProviderCallReceipt;
      try {
        const existing = confirmation.unchanged
          ? await this.receiptStore.getByProviderCallId(identity.providerCallId!)
          : undefined;
        recordedReceipt = existing ?? (
          await this.receiptStore.record(
            createNudgeProviderCallReceipt({
              conversationId: identity.conversationId!,
              runId: identity.runId!,
              providerCallId: identity.providerCallId!,
              leaseId: confirmation.lease.leaseId,
              nudgeIds: confirmation.lease.nudgeIds,
              nudgeStates: confirmation.nudges.map((nudge) => ({
                nudgeId: nudge.id,
                state: nudge.state === "consumed" ? "consumed" : "active",
              })),
              appliedAt: dispatchedAt,
            }),
          )
        ).receipt;
      } catch {
        throw this.failure(
          NUDGE_PROVIDER_CALL_FAILURE.receiptCommitFailed,
          identity,
        );
      }

      const receipts: RuntimeEventAppendReceipt[] = [];
      if (!confirmation.unchanged) for (const nudge of confirmation.nudges) {
        try {
          receipts.push(
            await this.eventSink.append(
              new SystemReminderInjectedOutputEvent({
                conversationId: identity.conversationId!,
                id: this.eventIdFactory.create({
                  conversationId: identity.conversationId!,
                  runId: identity.runId!,
                  eventType: OUTPUT_EVENT_TYPE.systemReminderInjected,
                  nudgeId: nudge.id,
                  providerCallId: identity.providerCallId!,
                }),
                timestamp: dispatchedAt,
                runId: identity.runId!,
                nudgeId: nudge.id,
                policyId: nudge.policyId,
                templateId: nudge.templateId,
                templateVersion: nudge.templateVersion,
                ...(nudge.targetTurnNumber === undefined
                  ? {}
                  : { targetTurnNumber: nudge.targetTurnNumber }),
                leaseId: confirmation.lease.leaseId,
                providerCallId: identity.providerCallId!,
              }),
            ),
          );
        } catch {
          throw this.failure(
            NUDGE_PROVIDER_CALL_FAILURE.eventAppendFailed,
            identity,
          );
        }
      }
      this.logger.info("runtime.nudge.provider_call_confirmed", {
        conversationId: identity.conversationId!,
        runId: identity.runId!,
        providerCallId: identity.providerCallId!,
        nudgeCount: confirmation.nudges.length,
      });
      return Object.freeze({
        confirmation,
        receipt: recordedReceipt,
        eventReceipts: Object.freeze(receipts),
      });
    } catch (error) {
      const normalized =
        error instanceof NudgeProviderCallCoordinatorError
          ? error
          : this.failure(NUDGE_PROVIDER_CALL_FAILURE.confirmationFailed, identity);
      this.logFailure(normalized);
      throw normalized;
    }
  }

  async releaseBeforeDispatch(
    prepared: PreparedNudgeProviderCall,
    releasedAt: string,
  ): Promise<NudgeLeaseReleaseResult> {
    const identity = captureIdentity(prepared);
    try {
      assertPrepared(prepared, identity);
      assertTimestamp(releasedAt);
      const result = await this.manager.releaseLease(
        identity.providerCallId!,
        releasedAt,
      );
      try {
        await this.commitPrivateState();
      } catch {
        throw this.failure(
          NUDGE_PROVIDER_CALL_FAILURE.privateStateCommitFailed,
          identity,
        );
      }
      this.logger.debug("runtime.nudge.provider_call_released", {
        conversationId: identity.conversationId!,
        runId: identity.runId!,
        providerCallId: identity.providerCallId!,
        outcome: result.outcome,
      });
      return result;
    } catch (error) {
      const normalized =
        error instanceof NudgeProviderCallCoordinatorError
          ? error
          : this.failure(NUDGE_PROVIDER_CALL_FAILURE.releaseFailed, identity);
      this.logFailure(normalized);
      throw normalized;
    }
  }

  private async rollbackPreparedLease(
    providerCallId: string,
    releasedAt: string,
    identity: ProviderCallIdentity,
  ): Promise<void> {
    try {
      await this.manager.releaseLease(providerCallId, releasedAt);
      await this.commitPrivateState();
    } catch {
      throw this.failure(
        NUDGE_PROVIDER_CALL_FAILURE.releaseFailed,
        identity,
      );
    }
  }

  private async commitPrivateState(): Promise<void> {
    await this.privateStateCommitter.commit(await this.manager.snapshot());
  }

  private failure(
    failure: NudgeProviderCallFailure,
    identity: ProviderCallIdentity,
  ): NudgeProviderCallCoordinatorError {
    return new NudgeProviderCallCoordinatorError(
      failure,
      identity.conversationId,
      identity.runId,
      identity.providerCallId,
    );
  }

  private logFailure(error: NudgeProviderCallCoordinatorError): void {
    this.logger.error("runtime.nudge.provider_call_failed", {
      failure: error.failure,
      ...(error.conversationId ? { conversationId: error.conversationId } : {}),
      ...(error.runId ? { runId: error.runId } : {}),
      ...(error.providerCallId
        ? { providerCallId: error.providerCallId }
        : {}),
    });
  }
}

interface ProviderCallIdentity {
  readonly conversationId?: string;
  readonly runId?: string;
  readonly providerCallId?: string;
}

function captureIdentity(value: unknown): ProviderCallIdentity {
  if (!isRecord(value)) return Object.freeze({});
  return Object.freeze({
    conversationId: captureNonBlank(value.conversationId),
    runId: captureNonBlank(value.runId),
    providerCallId: captureNonBlank(value.providerCallId),
  });
}

function assertRequest(
  request: PrepareNudgeProviderCallRequest,
  identity: ProviderCallIdentity,
): void {
  if (!identity.conversationId || !identity.runId || !identity.providerCallId) {
    throw new NudgeProviderCallCoordinatorError(
      NUDGE_PROVIDER_CALL_FAILURE.invalidRequest,
      identity.conversationId,
      identity.runId,
      identity.providerCallId,
    );
  }
  assertTimestamp(request.requestedAt);
  assertOptionalPositiveInteger(request.targetTurnNumber);
  assertOptionalPositiveInteger(request.requestedLimit);
}

function assertPrepared(
  prepared: PreparedNudgeProviderCall,
  identity: ProviderCallIdentity,
): void {
  if (
    !identity.conversationId ||
    !identity.runId ||
    !identity.providerCallId ||
    prepared.lease.providerCallId !== identity.providerCallId ||
    prepared.lease.targetRunId !== identity.runId ||
    prepared.overlay.nudgeIds.length !== prepared.lease.nudgeIds.length ||
    prepared.overlay.nudgeIds.some(
      (nudgeId, index) => nudgeId !== prepared.lease.nudgeIds[index],
    )
  ) {
    throw new NudgeProviderCallCoordinatorError(
      NUDGE_PROVIDER_CALL_FAILURE.invalidRequest,
      identity.conversationId,
      identity.runId,
      identity.providerCallId,
    );
  }
}

function assertTimestamp(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError("Nudge Provider call timestamp is invalid");
  }
}

function assertOptionalPositiveInteger(value: unknown): void {
  if (
    value !== undefined &&
    (!Number.isSafeInteger(value) || (value as number) < 1)
  ) {
    throw new TypeError("Nudge Provider call integer is invalid");
  }
}

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
