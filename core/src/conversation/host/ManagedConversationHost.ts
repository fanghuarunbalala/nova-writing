/**
 * Owns placement-neutral Runtime slots and schedules durable accepted inputs.
 *
 * @example
 * ```ts
 * const host = new ManagedConversationHost(options);
 * await host.notifyAccepted(signal);
 * const presence = await host.getRuntimePresence(signal.conversationId);
 * ```
 */
import type { AcceptedConversationInputSignal } from "../command/index.js";
import type { ConversationOutputEventPublisher } from "../output/index.js";
import { ConversationNotFoundError } from "../ConversationErrors.js";
import type { ConversationSnapshotReader } from "../ConversationSnapshotReader.js";
import {
  RUNTIME_PRESENCE_STATE,
  type RuntimePresence,
} from "../RuntimePresence.js";
import {
  RUNTIME_PRESENCE_CHANGE_REASON,
  RuntimePresenceChangedOutputEvent,
  type RuntimePresenceChangeReason,
} from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type { ConversationHost } from "./ConversationHost.js";
import {
  SystemConversationHostClock,
  type ConversationHostClock,
} from "./ConversationHostClock.js";
import type {
  ConversationHostControlDispatchContext,
  ConversationHostControlDispatcher,
  ConversationRuntimeCommandTarget,
} from "./ConversationHostControlDispatcher.js";
import {
  ConversationHostClosedError,
  ConversationHostClosingError,
  ConversationHostSignalConflictError,
  ConversationHostSignalInvalidError,
  ConversationHostSignalQueueFullError,
  ConversationRuntimeActivationError,
  ConversationRuntimeDispatchError,
  ConversationRuntimeHandleMismatchError,
  ConversationRuntimeInstanceIdentityInvalidError,
  ConversationRuntimeShutdownError,
} from "./ConversationHostErrors.js";
import { ConversationHostOperationSerializer } from "./ConversationHostOperationSerializer.js";
import {
  CONVERSATION_RUNTIME_ACTIVATION_REASON,
  CONVERSATION_RUNTIME_ACTIVATION_STATUS,
  type ConversationRuntimeActivationCause,
  type ConversationRuntimeActivationRequest,
  type ConversationRuntimeActivationResult,
} from "./ConversationRuntimeActivation.js";
import type { ConversationRuntimeBootstrapFactory } from "./ConversationRuntimeBootstrapFactory.js";
import type { ConversationRuntimeExit } from "./ConversationRuntimeExit.js";
import type { ConversationRuntimeHandle } from "./ConversationRuntimeHandle.js";
import type { ConversationRuntimeInputReference } from "./ConversationRuntimeInputReference.js";
import {
  RandomConversationRuntimeInstanceIdGenerator,
  type ConversationRuntimeInstanceIdGenerator,
} from "./ConversationRuntimeInstanceIdGenerator.js";
import type { ConversationRuntimePlacement } from "./ConversationRuntimePlacement.js";
import {
  CONVERSATION_RUNTIME_SHUTDOWN_REASON,
  CONVERSATION_RUNTIME_SHUTDOWN_STATUS,
  type ConversationRuntimeShutdownReason,
  type ConversationRuntimeShutdownRequest,
  type ConversationRuntimeShutdownResult,
} from "./ConversationRuntimeShutdown.js";
import {
  createManagedConversationRuntimeSlot,
  type ManagedConversationRuntimeSlot,
} from "./ManagedConversationRuntimeSlot.js";

const DEFAULT_CONTROL_QUEUE_CAPACITY = 64;
const DEFAULT_RUNTIME_QUEUE_CAPACITY = 1024;

type HostLifecycle = "open" | "closing" | "closed";
type SignalQueueTarget = "control" | "runtime";
type RuntimeSignalOutcome = "handled" | "reselect";

interface PresenceTransitionEventMetadata {
  correlationId?: string;
  causationId?: string;
  runId?: string;
  turnId?: string;
}

export interface ManagedConversationHostOptions {
  snapshotReader: ConversationSnapshotReader;
  bootstrapFactory: ConversationRuntimeBootstrapFactory;
  placement: ConversationRuntimePlacement;
  controlDispatcher: ConversationHostControlDispatcher;
  outputPublisher: ConversationOutputEventPublisher;
  clock?: ConversationHostClock;
  runtimeInstanceIdGenerator?: ConversationRuntimeInstanceIdGenerator;
  controlQueueCapacity?: number;
  runtimeQueueCapacity?: number;
  logger?: Logger;
}

export class ManagedConversationHost implements ConversationHost {
  private readonly snapshotReader: ConversationSnapshotReader;
  private readonly bootstrapFactory: ConversationRuntimeBootstrapFactory;
  private readonly placement: ConversationRuntimePlacement;
  private readonly controlDispatcher: ConversationHostControlDispatcher;
  private readonly outputPublisher: ConversationOutputEventPublisher;
  private readonly clock: ConversationHostClock;
  private readonly runtimeInstanceIdGenerator: ConversationRuntimeInstanceIdGenerator;
  private readonly controlQueueCapacity: number;
  private readonly runtimeQueueCapacity: number;
  private readonly logger: Logger;
  private readonly serializer = new ConversationHostOperationSerializer();
  private readonly slots = new Map<string, ManagedConversationRuntimeSlot>();
  private lifecycle: HostLifecycle = "open";
  private closePromise?: Promise<void>;

  constructor(options: ManagedConversationHostOptions) {
    this.snapshotReader = options.snapshotReader;
    this.bootstrapFactory = options.bootstrapFactory;
    this.placement = options.placement;
    this.controlDispatcher = options.controlDispatcher;
    this.outputPublisher = options.outputPublisher;
    this.clock = options.clock ?? new SystemConversationHostClock();
    this.runtimeInstanceIdGenerator =
      options.runtimeInstanceIdGenerator ??
      new RandomConversationRuntimeInstanceIdGenerator();
    this.controlQueueCapacity = validateCapacity(
      options.controlQueueCapacity ?? DEFAULT_CONTROL_QUEUE_CAPACITY,
      "controlQueueCapacity",
    );
    this.runtimeQueueCapacity = validateCapacity(
      options.runtimeQueueCapacity ?? DEFAULT_RUNTIME_QUEUE_CAPACITY,
      "runtimeQueueCapacity",
    );
    this.logger = (options.logger ?? noopLogger).child({
      component: "managed_conversation_host",
    });
  }

  async notifyAccepted(signal: AcceptedConversationInputSignal): Promise<void> {
    this.assertOpen();
    const captured = captureAcceptedSignal(signal);
    const slot = this.getOrCreateSlot(captured.conversationId, false);
    const fingerprint = getSignalFingerprint(captured);
    const existingFingerprint = slot.knownSignalFingerprints.get(captured.sequence);

    slot.signalRevision += 1;
    if (existingFingerprint !== undefined && existingFingerprint !== fingerprint) {
      this.logger.warn("conversation_host.signal.conflict", {
        conversationId: captured.conversationId,
        inputEventId: captured.inputEventId,
        eventType: captured.eventType,
        sequence: captured.sequence,
      });
      throw new ConversationHostSignalConflictError(
        captured.conversationId,
        captured.sequence,
      );
    }

    if (existingFingerprint !== undefined && this.isHandledOrPending(slot, captured)) {
      this.logger.debug("conversation_host.signal.duplicate", {
        conversationId: captured.conversationId,
        inputEventId: captured.inputEventId,
        eventType: captured.eventType,
        sequence: captured.sequence,
        routeTarget: captured.route.target,
      });
      this.scheduleDrain(slot);
      return;
    }

    const target = getSignalQueueTarget(captured);
    const queue =
      target === "control"
        ? slot.pendingControlSignals
        : slot.pendingRuntimeSignals;
    if (queue.size >= queue.capacity) {
      this.logger.warn("conversation_host.signal.queue_full", {
        conversationId: captured.conversationId,
        inputEventId: captured.inputEventId,
        eventType: captured.eventType,
        sequence: captured.sequence,
        queueTarget: target,
        capacity: queue.capacity,
      });
      throw new ConversationHostSignalQueueFullError(
        captured.conversationId,
        target,
        queue.capacity,
      );
    }

    queue.enqueue(captured);
    slot.knownSignalFingerprints.set(captured.sequence, fingerprint);
    this.logger.info("conversation_host.signal.enqueued", {
      conversationId: captured.conversationId,
      inputEventId: captured.inputEventId,
      eventType: captured.eventType,
      sequence: captured.sequence,
      priority: captured.priority,
      queueTarget: target,
    });
    this.scheduleDrain(slot);
    return;
  }

  async getRuntimePresence(conversationId: string): Promise<RuntimePresence> {
    this.assertOpen();
    validateNonEmptyString(conversationId, "conversationId");
    const existing = this.slots.get(conversationId);
    if (existing?.verified === true) {
      return Promise.resolve(copyPresence(existing.presence));
    }

    return this.serializer.run(conversationId, async () => {
      this.assertOpen();
      const slot = this.slots.get(conversationId);
      if (slot?.verified === true) return copyPresence(slot.presence);
      await this.verifyConversation(conversationId);
      const verifiedSlot = slot ?? this.getOrCreateSlot(conversationId, true);
      verifiedSlot.verified = true;
      return copyPresence(verifiedSlot.presence);
    });
  }

  async ensureActive(
    request: ConversationRuntimeActivationRequest,
  ): Promise<ConversationRuntimeActivationResult> {
    this.assertOpen();
    const captured = captureActivationRequest(request);
    return this.serializer.run(captured.conversationId, async () => {
      const slot = this.getOrCreateSlot(captured.conversationId, false);
      if (slot.presence.state === RUNTIME_PRESENCE_STATE.online && slot.handle) {
        return Object.freeze({
          status: CONVERSATION_RUNTIME_ACTIVATION_STATUS.reused,
          presence: copyPresence(slot.presence),
        });
      }

      await this.activateSlot(slot, captured);
      if (
        slot.pendingControlSignals.size > 0 ||
        slot.pendingRuntimeSignals.size > 0
      ) {
        this.scheduleDrain(slot);
      }
      return Object.freeze({
        status: CONVERSATION_RUNTIME_ACTIVATION_STATUS.activated,
        presence: copyPresence(slot.presence),
      });
    });
  }

  async shutdownRuntime(
    request: ConversationRuntimeShutdownRequest,
  ): Promise<ConversationRuntimeShutdownResult> {
    this.assertOpen();
    const captured = captureShutdownRequest(request);
    return this.serializer.run(captured.conversationId, () =>
      this.shutdownSlot(captured.conversationId, captured.reason),
    );
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    if (this.lifecycle === "closed") return Promise.resolve();

    this.lifecycle = "closing";
    this.logger.info("conversation_host.close_started", {
      slotCount: this.slots.size,
    });
    this.closePromise = this.performClose();
    return this.closePromise;
  }

  private async performClose(): Promise<void> {
    const shutdowns = [...this.slots.values()].map((slot) =>
      this.serializer.run(slot.conversationId, () =>
        this.shutdownSlot(
          slot.conversationId,
          CONVERSATION_RUNTIME_SHUTDOWN_REASON.hostClose,
        ),
      ),
    );
    const results = await Promise.allSettled(shutdowns);
    await this.serializer.drain();
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);

    for (const slot of this.slots.values()) {
      slot.pendingControlSignals.clear();
      slot.pendingRuntimeSignals.clear();
      slot.knownSignalFingerprints.clear();
      slot.dispatchedRuntimeSignals.clear();
      slot.completedControlSignals.clear();
      slot.completedOfflineRuntimeSignals.clear();
    }
    const slotCount = this.slots.size;
    this.slots.clear();
    this.lifecycle = "closed";

    if (failures.length > 0) {
      this.logger.error("conversation_host.close_failed", {
        slotCount,
        failureCount: failures.length,
      });
      throw new AggregateError(failures, "Conversation Host close failed");
    }

    this.logger.info("conversation_host.close_completed", { slotCount });
  }

  private scheduleDrain(slot: ManagedConversationRuntimeSlot): void {
    if (slot.drainScheduled || this.lifecycle !== "open") return;
    slot.drainScheduled = true;
    void this.serializer
      .run(slot.conversationId, () => this.drainSlot(slot))
      .catch((error: unknown) => {
        this.logger.error("conversation_host.signal.drain_failed", {
          conversationId: slot.conversationId,
          ...getErrorIdentity(error),
        });
      });
  }

  private async drainSlot(slot: ManagedConversationRuntimeSlot): Promise<void> {
    try {
      while (this.lifecycle === "open") {
        const signal =
          slot.pendingControlSignals.peek() ?? slot.pendingRuntimeSignals.peek();
        if (signal === undefined) return;
        const revisionAtAttempt = slot.signalRevision;

        try {
          if (signal.route.target === "host") {
            await this.dispatchControlSignal(slot, signal);
          } else {
            const outcome = await this.dispatchRuntimeSignal(slot, signal);
            if (outcome === "reselect") continue;
          }
        } catch {
          if (slot.signalRevision > revisionAtAttempt) continue;
          return;
        }
      }
    } finally {
      slot.drainScheduled = false;
    }
  }

  private async dispatchControlSignal(
    slot: ManagedConversationRuntimeSlot,
    signal: AcceptedConversationInputSignal,
  ): Promise<void> {
    const fingerprint = getSignalFingerprint(signal);
    const context = this.createControlContext(slot);
    try {
      await this.controlDispatcher.dispatch(signal, context);
      slot.pendingControlSignals.delete(signal.sequence);
      slot.completedControlSignals.set(signal.sequence, fingerprint);
      this.logger.info("conversation_host.control.dispatched", {
        conversationId: signal.conversationId,
        inputEventId: signal.inputEventId,
        eventType: signal.eventType,
        sequence: signal.sequence,
        handler: signal.route.target === "host" ? signal.route.handler : "unknown",
        runtimeOnline: context.runtime !== undefined,
      });
    } catch (error) {
      this.logger.warn("conversation_host.control.dispatch_failed", {
        conversationId: signal.conversationId,
        inputEventId: signal.inputEventId,
        eventType: signal.eventType,
        sequence: signal.sequence,
        ...getErrorIdentity(error),
      });
      throw error;
    }
  }

  private async dispatchRuntimeSignal(
    slot: ManagedConversationRuntimeSlot,
    signal: AcceptedConversationInputSignal,
  ): Promise<RuntimeSignalOutcome> {
    if (signal.route.target !== "runtime") {
      throw new ConversationHostSignalInvalidError("route.target");
    }

    if (
      signal.route.activation === "if_online" &&
      (slot.presence.state !== RUNTIME_PRESENCE_STATE.online || !slot.handle)
    ) {
      slot.pendingRuntimeSignals.delete(signal.sequence);
      slot.completedOfflineRuntimeSignals.set(
        signal.sequence,
        getSignalFingerprint(signal),
      );
      this.logger.debug("conversation_host.runtime.input_skipped_offline", {
        conversationId: signal.conversationId,
        inputEventId: signal.inputEventId,
        eventType: signal.eventType,
        sequence: signal.sequence,
      });
      return "handled";
    }

    if (slot.presence.state !== RUNTIME_PRESENCE_STATE.online || !slot.handle) {
      const activation: ConversationRuntimeActivationCause =
        slot.presence.state === RUNTIME_PRESENCE_STATE.crashed
          ? Object.freeze({
              reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.crashRecovery,
            })
          : Object.freeze({
              reason: CONVERSATION_RUNTIME_ACTIVATION_REASON.acceptedInput,
              input: toRuntimeInputReference(signal),
            });
      await this.activateSlot(slot, {
        conversationId: signal.conversationId,
        ...activation,
      }, getSignalEventMetadata(signal));
      return "reselect";
    }

    const input = toRuntimeInputReference(signal);
    try {
      await slot.handle.dispatchInput(input);
      slot.pendingRuntimeSignals.delete(signal.sequence);
      slot.dispatchedRuntimeSignals.set(
        signal.sequence,
        getSignalFingerprint(signal),
      );
      this.logger.info("conversation_host.runtime.input_dispatched", {
        conversationId: signal.conversationId,
        runtimeInstanceId: slot.handle.runtimeInstanceId,
        inputEventId: signal.inputEventId,
        eventType: signal.eventType,
        sequence: signal.sequence,
      });
      return "handled";
    } catch (error) {
      const identity = getErrorIdentity(error);
      const dispatchError = new ConversationRuntimeDispatchError(
        signal.conversationId,
        signal.sequence,
        identity.errorName,
        identity.errorCode,
      );
      this.logger.warn("conversation_host.runtime.input_dispatch_failed", {
        conversationId: signal.conversationId,
        runtimeInstanceId: slot.handle.runtimeInstanceId,
        inputEventId: signal.inputEventId,
        eventType: signal.eventType,
        sequence: signal.sequence,
        ...identity,
      });
      throw dispatchError;
    }
  }

  private async activateSlot(
    slot: ManagedConversationRuntimeSlot,
    request: ConversationRuntimeActivationRequest,
    metadata: PresenceTransitionEventMetadata = getActivationEventMetadata(request),
  ): Promise<void> {
    slot.generation += 1;
    const generation = slot.generation;
    let runtimeInstanceId = "unknown";

    try {
      await this.transitionPresence(
        slot,
        createPresence(RUNTIME_PRESENCE_STATE.starting, this.readTimestamp()),
        request.reason,
        metadata,
      );
      runtimeInstanceId = this.runtimeInstanceIdGenerator.generate(
        slot.conversationId,
      );
      validateRuntimeInstanceId(runtimeInstanceId);
      const activatedAt = this.readTimestamp();

      this.logger.info("conversation_host.runtime.activation_started", {
        conversationId: slot.conversationId,
        runtimeInstanceId,
        generation,
        activationReason: request.reason,
        ...(request.reason === CONVERSATION_RUNTIME_ACTIVATION_REASON.acceptedInput
          ? { activationSequence: request.input.sequence }
          : {}),
      });
      const bootstrap = await this.bootstrapFactory.create({
        conversationId: slot.conversationId,
        runtimeInstanceId,
        activatedAt,
        activation: toActivationCause(request),
      });
      const handle = await this.placement.activate(bootstrap);
      if (
        handle.conversationId !== bootstrap.conversation.metadata.id ||
        handle.runtimeInstanceId !== bootstrap.runtimeInstanceId
      ) {
        this.logger.error("conversation_host.runtime.handle_mismatch", {
          conversationId: slot.conversationId,
          runtimeInstanceId,
          generation,
          receivedConversationId: safeLogIdentifier(handle.conversationId),
          receivedRuntimeInstanceId: safeLogIdentifier(handle.runtimeInstanceId),
        });
        void handle
          .shutdown({ reason: CONVERSATION_RUNTIME_SHUTDOWN_REASON.replacement })
          .catch(() => undefined);
        throw new ConversationRuntimeHandleMismatchError(
          bootstrap.conversation.metadata.id,
          handle.conversationId,
          bootstrap.runtimeInstanceId,
          handle.runtimeInstanceId,
        );
      }

      const exitPromise = captureExitPromise(handle);
      slot.handle = handle;
      slot.exitPromise = exitPromise;
      slot.verified = true;
      slot.dispatchedRuntimeSignals.clear();
      await this.transitionPresence(
        slot,
        createPresence(RUNTIME_PRESENCE_STATE.online, activatedAt),
        RUNTIME_PRESENCE_CHANGE_REASON.activationSucceeded,
        metadata,
      );
      this.observeRuntimeExit(slot, generation, runtimeInstanceId, exitPromise);
      this.logger.info("conversation_host.runtime.activated", {
        conversationId: slot.conversationId,
        runtimeInstanceId,
        generation,
        activationReason: request.reason,
      });
    } catch (error) {
      slot.handle = undefined;
      slot.exitPromise = undefined;
      await this.transitionPresence(
        slot,
        createPresence(
          RUNTIME_PRESENCE_STATE.crashed,
          this.readTimestampOr(slot.presence.observedAt),
        ),
        RUNTIME_PRESENCE_CHANGE_REASON.activationFailed,
        metadata,
      );
      const normalized = normalizeActivationError(error, slot.conversationId);
      this.logger.error("conversation_host.runtime.activation_failed", {
        conversationId: slot.conversationId,
        runtimeInstanceId,
        generation,
        activationReason: request.reason,
        ...getErrorIdentity(normalized),
      });
      throw normalized;
    }
  }

  private observeRuntimeExit(
    slot: ManagedConversationRuntimeSlot,
    observedGeneration: number,
    observedRuntimeInstanceId: string,
    exitPromise: Promise<ConversationRuntimeExit>,
  ): void {
    void exitPromise
      .then(
        (exit) =>
          this.serializer.run(slot.conversationId, async () => {
            await this.applyObservedExit(
              slot,
              observedGeneration,
              observedRuntimeInstanceId,
              exit,
            );
          }),
        (error: unknown) =>
          this.serializer.run(slot.conversationId, async () => {
            await this.applyRejectedExitObserver(
              slot,
              observedGeneration,
              observedRuntimeInstanceId,
              error,
            );
          }),
      )
      .catch((error: unknown) => {
        this.logger.error("conversation_host.runtime.exit_observer_failed", {
          conversationId: slot.conversationId,
          runtimeInstanceId: observedRuntimeInstanceId,
          observedGeneration,
          ...getErrorIdentity(error),
        });
      });
  }

  private async applyObservedExit(
    slot: ManagedConversationRuntimeSlot,
    observedGeneration: number,
    observedRuntimeInstanceId: string,
    exit: ConversationRuntimeExit,
  ): Promise<void> {
    if (!this.isCurrentRuntime(slot, observedGeneration, observedRuntimeInstanceId)) {
      this.logger.debug("conversation_host.runtime.stale_exit_ignored", {
        conversationId: slot.conversationId,
        runtimeInstanceId: observedRuntimeInstanceId,
        observedGeneration,
        currentGeneration: slot.generation,
      });
      return;
    }

    slot.handle = undefined;
    slot.exitPromise = undefined;
    slot.dispatchedRuntimeSignals.clear();
    await this.transitionPresence(
      slot,
      createPresence(
        exit.kind === "stopped"
          ? RUNTIME_PRESENCE_STATE.offline
          : RUNTIME_PRESENCE_STATE.crashed,
        isValidTimestamp(exit.exitedAt) ? exit.exitedAt : this.readTimestamp(),
      ),
      exit.kind === "stopped"
        ? RUNTIME_PRESENCE_CHANGE_REASON.runtimeStopped
        : RUNTIME_PRESENCE_CHANGE_REASON.runtimeCrashed,
    );
    this.logger.info("conversation_host.runtime.exit_observed", {
      conversationId: slot.conversationId,
      runtimeInstanceId: observedRuntimeInstanceId,
      generation: observedGeneration,
      exitKind: exit.kind,
      ...(exit.kind === "stopped"
        ? { shutdownReason: exit.reason }
        : {
            errorName: exit.errorName,
            ...(exit.errorCode !== undefined ? { errorCode: exit.errorCode } : {}),
          }),
    });
  }

  private async applyRejectedExitObserver(
    slot: ManagedConversationRuntimeSlot,
    observedGeneration: number,
    observedRuntimeInstanceId: string,
    error: unknown,
  ): Promise<void> {
    if (!this.isCurrentRuntime(slot, observedGeneration, observedRuntimeInstanceId)) {
      this.logger.debug("conversation_host.runtime.stale_exit_ignored", {
        conversationId: slot.conversationId,
        runtimeInstanceId: observedRuntimeInstanceId,
        observedGeneration,
        currentGeneration: slot.generation,
      });
      return;
    }

    slot.handle = undefined;
    slot.exitPromise = undefined;
    slot.dispatchedRuntimeSignals.clear();
    await this.transitionPresence(
      slot,
      createPresence(RUNTIME_PRESENCE_STATE.crashed, this.readTimestamp()),
      RUNTIME_PRESENCE_CHANGE_REASON.exitObserverFailed,
    );
    this.logger.warn("conversation_host.runtime.exit_observed", {
      conversationId: slot.conversationId,
      runtimeInstanceId: observedRuntimeInstanceId,
      generation: observedGeneration,
      exitKind: "crashed",
      ...getErrorIdentity(error),
    });
  }

  private async shutdownSlot(
    conversationId: string,
    reason: ConversationRuntimeShutdownReason,
  ): Promise<ConversationRuntimeShutdownResult> {
    const slot = this.slots.get(conversationId);
    if (slot?.handle === undefined || slot.exitPromise === undefined) {
      const presence =
        slot?.presence ??
        createPresence(RUNTIME_PRESENCE_STATE.offline, this.readTimestamp());
      return Object.freeze({
        status: CONVERSATION_RUNTIME_SHUTDOWN_STATUS.alreadyOffline,
        presence: copyPresence(presence),
      });
    }

    const handle = slot.handle;
    const exitPromise = slot.exitPromise;
    const generation = slot.generation;
    await this.transitionPresence(
      slot,
      createPresence(RUNTIME_PRESENCE_STATE.stopping, this.readTimestamp()),
      reason,
    );
    this.logger.info("conversation_host.runtime.shutdown_started", {
      conversationId,
      runtimeInstanceId: handle.runtimeInstanceId,
      generation,
      shutdownReason: reason,
    });

    try {
      await handle.shutdown({ reason });
      const exit = await exitPromise;
      await this.applyObservedExit(slot, generation, handle.runtimeInstanceId, exit);
      this.logger.info("conversation_host.runtime.shutdown_completed", {
        conversationId,
        runtimeInstanceId: handle.runtimeInstanceId,
        generation,
        shutdownReason: reason,
        exitKind: exit.kind,
      });
      return Object.freeze({
        status: CONVERSATION_RUNTIME_SHUTDOWN_STATUS.stopped,
        presence: copyPresence(slot.presence),
      });
    } catch (error) {
      const identity = getErrorIdentity(error);
      if (this.isCurrentRuntime(slot, generation, handle.runtimeInstanceId)) {
        slot.handle = undefined;
        slot.exitPromise = undefined;
        slot.dispatchedRuntimeSignals.clear();
        await this.transitionPresence(
          slot,
          createPresence(RUNTIME_PRESENCE_STATE.crashed, this.readTimestamp()),
          RUNTIME_PRESENCE_CHANGE_REASON.shutdownFailed,
        );
      }
      this.logger.error("conversation_host.runtime.shutdown_failed", {
        conversationId,
        runtimeInstanceId: handle.runtimeInstanceId,
        generation,
        shutdownReason: reason,
        ...identity,
      });
      throw new ConversationRuntimeShutdownError(
        conversationId,
        identity.errorName,
        identity.errorCode,
      );
    }
  }

  private createControlContext(
    slot: ManagedConversationRuntimeSlot,
  ): ConversationHostControlDispatchContext {
    const presence = copyPresence(slot.presence);
    if (slot.presence.state !== RUNTIME_PRESENCE_STATE.online || !slot.handle) {
      return Object.freeze({ presence });
    }
    const handle = slot.handle;
    const runtime: ConversationRuntimeCommandTarget = Object.freeze({
      conversationId: handle.conversationId,
      runtimeInstanceId: handle.runtimeInstanceId,
      dispatchInput: (input: ConversationRuntimeInputReference) =>
        handle.dispatchInput(input),
    });
    return Object.freeze({ presence, runtime });
  }

  private async transitionPresence(
    slot: ManagedConversationRuntimeSlot,
    current: RuntimePresence,
    reason: RuntimePresenceChangeReason,
    metadata: PresenceTransitionEventMetadata = {},
  ): Promise<void> {
    const previous = slot.presence;
    slot.presence = current;
    const event = new RuntimePresenceChangedOutputEvent({
      conversationId: slot.conversationId,
      previous,
      current,
      reason,
      ...(metadata.correlationId !== undefined
        ? { correlationId: metadata.correlationId }
        : {}),
      ...(metadata.causationId !== undefined
        ? { causationId: metadata.causationId }
        : {}),
      ...(metadata.runId !== undefined ? { runId: metadata.runId } : {}),
      ...(metadata.turnId !== undefined ? { turnId: metadata.turnId } : {}),
    });

    try {
      const receipt = await this.outputPublisher.publish(event);
      this.logger.debug("conversation_host.runtime.presence_published", {
        conversationId: slot.conversationId,
        outputEventId: event.id,
        eventType: event.getEventType(),
        previousState: previous.state,
        currentState: current.state,
        transitionReason: reason,
        outputStatus: receipt.status,
        sequence: receipt.sequence,
      });
    } catch (error) {
      this.logger.warn("conversation_host.runtime.presence_publish_failed", {
        conversationId: slot.conversationId,
        outputEventId: event.id,
        eventType: event.getEventType(),
        previousState: previous.state,
        currentState: current.state,
        transitionReason: reason,
        ...getErrorIdentity(error),
      });
    }
  }

  private isHandledOrPending(
    slot: ManagedConversationRuntimeSlot,
    signal: AcceptedConversationInputSignal,
  ): boolean {
    if (signal.route.target === "host") {
      return (
        slot.pendingControlSignals.has(signal.sequence) ||
        slot.completedControlSignals.has(signal.sequence)
      );
    }
    return (
      slot.pendingRuntimeSignals.has(signal.sequence) ||
      slot.dispatchedRuntimeSignals.has(signal.sequence) ||
      slot.completedOfflineRuntimeSignals.has(signal.sequence)
    );
  }

  private isCurrentRuntime(
    slot: ManagedConversationRuntimeSlot,
    generation: number,
    runtimeInstanceId: string,
  ): boolean {
    return (
      this.slots.get(slot.conversationId) === slot &&
      slot.generation === generation &&
      slot.handle?.runtimeInstanceId === runtimeInstanceId
    );
  }

  private getOrCreateSlot(
    conversationId: string,
    verified: boolean,
  ): ManagedConversationRuntimeSlot {
    const existing = this.slots.get(conversationId);
    if (existing !== undefined) {
      if (verified) existing.verified = true;
      return existing;
    }
    const slot = createManagedConversationRuntimeSlot({
      conversationId,
      observedAt: this.readTimestamp(),
      controlQueueCapacity: this.controlQueueCapacity,
      runtimeQueueCapacity: this.runtimeQueueCapacity,
      verified,
    });
    this.slots.set(conversationId, slot);
    return slot;
  }

  private async verifyConversation(conversationId: string): Promise<void> {
    try {
      await this.snapshotReader.getSnapshot(conversationId);
    } catch (error) {
      if (error instanceof ConversationNotFoundError) throw error;
      throw error;
    }
  }

  private readTimestamp(): string {
    const value = this.clock.now();
    if (!isValidTimestamp(value)) {
      throw new ConversationRuntimeInstanceIdentityInvalidError("activatedAt");
    }
    return value;
  }

  private readTimestampOr(fallback: string): string {
    try {
      return this.readTimestamp();
    } catch {
      return fallback;
    }
  }

  private assertOpen(): void {
    if (this.lifecycle === "closing") throw new ConversationHostClosingError();
    if (this.lifecycle === "closed") throw new ConversationHostClosedError();
  }
}

function captureAcceptedSignal(
  signal: AcceptedConversationInputSignal,
): AcceptedConversationInputSignal {
  if (signal === null || typeof signal !== "object") {
    throw new ConversationHostSignalInvalidError("signal");
  }
  validateNonEmptyString(signal.conversationId, "conversationId");
  validateNonEmptyString(signal.inputEventId, "inputEventId");
  validateNonEmptyString(signal.eventType, "eventType");
  if (!Number.isSafeInteger(signal.priority)) {
    throw new ConversationHostSignalInvalidError("priority");
  }
  if (!Number.isSafeInteger(signal.sequence) || signal.sequence <= 0) {
    throw new ConversationHostSignalInvalidError("sequence");
  }
  if (!isValidTimestamp(signal.recordedAt)) {
    throw new ConversationHostSignalInvalidError("recordedAt");
  }
  if (signal.journalStatus !== "appended" && signal.journalStatus !== "duplicate") {
    throw new ConversationHostSignalInvalidError("journalStatus");
  }
  validateOptionalIdentifier(signal.correlationId, "correlationId");
  validateOptionalIdentifier(signal.runId, "runId");
  validateOptionalIdentifier(signal.turnId, "turnId");
  const route = captureRoute(signal.route);
  return Object.freeze({
    conversationId: signal.conversationId,
    inputEventId: signal.inputEventId,
    eventType: signal.eventType,
    priority: signal.priority,
    sequence: signal.sequence,
    recordedAt: signal.recordedAt,
    journalStatus: signal.journalStatus,
    route,
    ...(signal.correlationId !== undefined
      ? { correlationId: signal.correlationId }
      : {}),
    ...(signal.runId !== undefined ? { runId: signal.runId } : {}),
    ...(signal.turnId !== undefined ? { turnId: signal.turnId } : {}),
  });
}

function captureRoute(
  route: AcceptedConversationInputSignal["route"],
): AcceptedConversationInputSignal["route"] {
  if (route === null || typeof route !== "object") {
    throw new ConversationHostSignalInvalidError("route");
  }
  if (route.target === "runtime") {
    if (route.activation !== "required" && route.activation !== "if_online") {
      throw new ConversationHostSignalInvalidError("route.activation");
    }
    return Object.freeze({ target: "runtime", activation: route.activation });
  }
  if (route.target === "host") {
    if (route.handler !== "stop" && route.handler !== "reload_config") {
      throw new ConversationHostSignalInvalidError("route.handler");
    }
    if (
      route.runtimeNotification !== "if_online" &&
      route.runtimeNotification !== "none"
    ) {
      throw new ConversationHostSignalInvalidError("route.runtimeNotification");
    }
    return Object.freeze({
      target: "host",
      handler: route.handler,
      runtimeNotification: route.runtimeNotification,
    });
  }
  throw new ConversationHostSignalInvalidError("route.target");
}

function captureActivationRequest(
  request: ConversationRuntimeActivationRequest,
): ConversationRuntimeActivationRequest {
  if (request === null || typeof request !== "object") {
    throw new ConversationHostSignalInvalidError("activation");
  }
  validateNonEmptyString(request.conversationId, "conversationId");
  if (request.reason === CONVERSATION_RUNTIME_ACTIVATION_REASON.acceptedInput) {
    const input = captureRuntimeInputReference(request.input);
    if (input.conversationId !== request.conversationId) {
      throw new ConversationHostSignalInvalidError("activation.input.conversationId");
    }
    return Object.freeze({
      conversationId: request.conversationId,
      reason: request.reason,
      input,
    });
  }
  if (
    request.reason !== CONVERSATION_RUNTIME_ACTIVATION_REASON.explicitRestore &&
    request.reason !== CONVERSATION_RUNTIME_ACTIVATION_REASON.crashRecovery
  ) {
    throw new ConversationHostSignalInvalidError("activation.reason");
  }
  return Object.freeze({
    conversationId: request.conversationId,
    reason: request.reason,
  });
}

function captureShutdownRequest(
  request: ConversationRuntimeShutdownRequest,
): ConversationRuntimeShutdownRequest {
  if (request === null || typeof request !== "object") {
    throw new ConversationHostSignalInvalidError("shutdown");
  }
  validateNonEmptyString(request.conversationId, "conversationId");
  if (!Object.values(CONVERSATION_RUNTIME_SHUTDOWN_REASON).includes(request.reason)) {
    throw new ConversationHostSignalInvalidError("shutdown.reason");
  }
  return Object.freeze({
    conversationId: request.conversationId,
    reason: request.reason,
  });
}

function captureRuntimeInputReference(
  input: ConversationRuntimeInputReference,
): ConversationRuntimeInputReference {
  validateNonEmptyString(input.conversationId, "activation.input.conversationId");
  validateNonEmptyString(input.inputEventId, "activation.input.inputEventId");
  validateNonEmptyString(input.eventType, "activation.input.eventType");
  if (!Number.isSafeInteger(input.sequence) || input.sequence <= 0) {
    throw new ConversationHostSignalInvalidError("activation.input.sequence");
  }
  validateOptionalIdentifier(input.correlationId, "activation.input.correlationId");
  validateOptionalIdentifier(input.runId, "activation.input.runId");
  validateOptionalIdentifier(input.turnId, "activation.input.turnId");
  return Object.freeze({
    conversationId: input.conversationId,
    inputEventId: input.inputEventId,
    eventType: input.eventType,
    sequence: input.sequence,
    ...(input.correlationId !== undefined
      ? { correlationId: input.correlationId }
      : {}),
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
  });
}

function toActivationCause(
  request: ConversationRuntimeActivationRequest,
): ConversationRuntimeActivationCause {
  return request.reason === CONVERSATION_RUNTIME_ACTIVATION_REASON.acceptedInput
    ? Object.freeze({ reason: request.reason, input: request.input })
    : Object.freeze({ reason: request.reason });
}

function toRuntimeInputReference(
  signal: AcceptedConversationInputSignal,
): ConversationRuntimeInputReference {
  return Object.freeze({
    conversationId: signal.conversationId,
    inputEventId: signal.inputEventId,
    eventType: signal.eventType,
    sequence: signal.sequence,
    ...(signal.correlationId !== undefined
      ? { correlationId: signal.correlationId }
      : {}),
    ...(signal.runId !== undefined ? { runId: signal.runId } : {}),
    ...(signal.turnId !== undefined ? { turnId: signal.turnId } : {}),
  });
}

function getActivationEventMetadata(
  request: ConversationRuntimeActivationRequest,
): PresenceTransitionEventMetadata {
  return request.reason === CONVERSATION_RUNTIME_ACTIVATION_REASON.acceptedInput
    ? Object.freeze({
        causationId: request.input.inputEventId,
        ...(request.input.correlationId !== undefined
          ? { correlationId: request.input.correlationId }
          : {}),
        ...(request.input.runId !== undefined ? { runId: request.input.runId } : {}),
        ...(request.input.turnId !== undefined
          ? { turnId: request.input.turnId }
          : {}),
      })
    : Object.freeze({});
}

function getSignalEventMetadata(
  signal: AcceptedConversationInputSignal,
): PresenceTransitionEventMetadata {
  return Object.freeze({
    causationId: signal.inputEventId,
    ...(signal.correlationId !== undefined
      ? { correlationId: signal.correlationId }
      : {}),
    ...(signal.runId !== undefined ? { runId: signal.runId } : {}),
    ...(signal.turnId !== undefined ? { turnId: signal.turnId } : {}),
  });
}

function getSignalQueueTarget(
  signal: AcceptedConversationInputSignal,
): SignalQueueTarget {
  return signal.route.target === "host" ? "control" : "runtime";
}

function getSignalFingerprint(signal: AcceptedConversationInputSignal): string {
  return JSON.stringify({
    conversationId: signal.conversationId,
    inputEventId: signal.inputEventId,
    eventType: signal.eventType,
    priority: signal.priority,
    sequence: signal.sequence,
    recordedAt: signal.recordedAt,
    route: signal.route,
    correlationId: signal.correlationId ?? null,
    runId: signal.runId ?? null,
    turnId: signal.turnId ?? null,
  });
}

function createPresence(
  state: RuntimePresence["state"],
  observedAt: string,
): RuntimePresence {
  return Object.freeze({ state, observedAt });
}

function copyPresence(presence: RuntimePresence): RuntimePresence {
  return createPresence(presence.state, presence.observedAt);
}

function captureExitPromise(
  handle: ConversationRuntimeHandle,
): Promise<ConversationRuntimeExit> {
  try {
    return handle.waitForExit();
  } catch (error) {
    return Promise.reject(error);
  }
}

function normalizeActivationError(
  error: unknown,
  conversationId: string,
): Error {
  if (
    error instanceof ConversationRuntimeHandleMismatchError ||
    error instanceof ConversationRuntimeInstanceIdentityInvalidError ||
    error instanceof ConversationRuntimeActivationError
  ) {
    return error;
  }
  const identity = getErrorIdentity(error);
  return new ConversationRuntimeActivationError(
    conversationId,
    identity.errorName,
    identity.errorCode,
  );
}

function validateCapacity(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive safe integer`);
  }
  return value;
}

function validateRuntimeInstanceId(value: string): void {
  if (!/^rt_[A-Za-z0-9_-]+$/.test(value)) {
    throw new ConversationRuntimeInstanceIdentityInvalidError("runtimeInstanceId");
  }
}

function validateNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConversationHostSignalInvalidError(field);
  }
}

function validateOptionalIdentifier(value: unknown, field: string): void {
  if (value !== undefined) validateNonEmptyString(value, field);
}

function isValidTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function safeLogIdentifier(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? value : "unknown";
}

function getErrorIdentity(error: unknown): Readonly<{
  errorName: string;
  errorCode?: string;
}> {
  if (error === null || typeof error !== "object") {
    return { errorName: "UnknownError" };
  }
  const candidate = error as { name?: unknown; code?: unknown };
  const errorName =
    typeof candidate.name === "string" && candidate.name.trim().length > 0
      ? candidate.name
      : "UnknownError";
  return typeof candidate.code === "string" && candidate.code.trim().length > 0
    ? { errorName, errorCode: candidate.code }
    : { errorName };
}
