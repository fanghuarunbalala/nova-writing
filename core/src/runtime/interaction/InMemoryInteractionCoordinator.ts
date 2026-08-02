/** Serialized in-memory approval coordinator with durable Event publication barriers. */
import { INPUT_EVENT_TYPE } from "../../event/input/InputEventType.js";
import { INPUT_PRIORITY } from "../../event/input/InputPriority.js";
import {
  ToolApprovalRequestedOutputEvent,
  ToolApprovalResolvedOutputEvent,
} from "../../event/output/ToolApprovalLifecycleOutputEvents.js";
import {
  ToolApprovalRequestedPayload,
  ToolApprovalResolvedPayload,
  type ToolApprovalResolutionDecision,
} from "../../event/output/payload/ToolApprovalLifecyclePayloads.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type { RuntimeEventSink } from "../execution/event/RuntimeEventSink.js";
import {
  captureToolApprovalIdentity,
} from "../../tools/execution/ToolExecutionProtocolValidator.js";
import {
  INTERACTION_COORDINATOR_FAILURE,
  InteractionCoordinatorError,
} from "./InteractionCoordinatorErrors.js";
import {
  TOOL_APPROVAL_DECISION_OUTCOME,
  type InteractionCoordinator,
  type ToolApprovalDecisionResult,
  type ToolApprovalInteractionSnapshot,
  type ToolApprovalRequest,
  type ToolApprovalResolution,
  type ToolApprovalTrustedCommandMetadata,
} from "./ToolApprovalInteractionProtocol.js";

export interface ToolApprovalEventIdFactory {
  requested(approvalRequestId: string): string;
  resolved(approvalRequestId: string): string;
}

export interface InMemoryInteractionCoordinatorOptions {
  readonly eventSink: RuntimeEventSink;
  readonly eventIdFactory?: ToolApprovalEventIdFactory;
  readonly logger?: Logger;
}

interface PendingApproval {
  readonly request: ToolApprovalRequest;
  readonly fingerprint: string;
  readonly promise: Promise<ToolApprovalResolution>;
  readonly resolve: (resolution: ToolApprovalResolution) => void;
  published: boolean;
}

interface CapturedDecisionInput {
  readonly id: string;
  readonly conversationId: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly runId?: string;
  readonly turnId?: string;
  readonly approvalRequestId: string;
  readonly decision: "approved" | "rejected";
  readonly argumentDigest: `sha256:${string}`;
  readonly timestamp: string;
}

export class InMemoryInteractionCoordinator implements InteractionCoordinator {
  readonly #eventSink: RuntimeEventSink;
  readonly #eventIdFactory: ToolApprovalEventIdFactory;
  readonly #logger: Logger;
  readonly #pending = new Map<string, PendingApproval>();
  readonly #resolved = new Map<string, ToolApprovalResolution>();
  #tail: Promise<void> = Promise.resolve();

  constructor(options: InMemoryInteractionCoordinatorOptions) {
    this.#eventSink = options.eventSink;
    this.#eventIdFactory = options.eventIdFactory ?? DEFAULT_APPROVAL_EVENT_ID_FACTORY;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "interaction_coordinator",
    });
  }

  async request(request: ToolApprovalRequest): Promise<ToolApprovalResolution> {
    const captured = captureRequest(request);
    let waiter: Promise<ToolApprovalResolution> | undefined;
    await this.#serialize(async () => {
      const completed = this.#resolved.get(captured.approvalRequestId);
      if (completed) {
        if (!sameApprovalIdentity(completed.identity, captured.identity)) {
          throw this.#error(
            INTERACTION_COORDINATOR_FAILURE.requestConflict,
            captured,
          );
        }
        waiter = Promise.resolve(completed);
        return;
      }

      let pending = this.#pending.get(captured.approvalRequestId);
      if (pending) {
        if (pending.fingerprint !== requestFingerprint(captured)) {
          throw this.#error(
            INTERACTION_COORDINATOR_FAILURE.requestConflict,
            captured,
          );
        }
      } else {
        pending = createPending(captured);
        this.#pending.set(captured.approvalRequestId, pending);
      }

      if (!pending.published) {
        this.#logger.info("runtime.interaction.approval_requested", {
          approvalRequestId: captured.approvalRequestId,
          conversationId: captured.identity.conversationId,
          runId: captured.identity.runId,
          toolCallId: captured.identity.toolCallId,
          toolName: captured.identity.toolName,
          toolVersion: captured.identity.toolVersion,
        });
        try {
          await this.#eventSink.append(this.#createRequestedEvent(captured));
          pending.published = true;
        } catch {
          throw this.#error(
            INTERACTION_COORDINATOR_FAILURE.requestPublicationFailed,
            captured,
          );
        }
      }
      waiter = pending.promise;
    });
    return waiter!;
  }

  async wait(approvalRequestId: string): Promise<ToolApprovalResolution> {
    const requestId = captureApprovalRequestId(approvalRequestId);
    let waiter: Promise<ToolApprovalResolution> | undefined;
    await this.#serialize(async () => {
      const completed = this.#resolved.get(requestId);
      if (completed) {
        waiter = Promise.resolve(completed);
        return;
      }
      const pending = this.#pending.get(requestId);
      if (!pending) {
        throw new InteractionCoordinatorError(
          INTERACTION_COORDINATOR_FAILURE.unknownRequest,
          { approvalRequestId: requestId },
        );
      }
      waiter = pending.promise;
    });
    return waiter!;
  }

  async resolve(
    input: unknown,
    metadata: ToolApprovalTrustedCommandMetadata,
  ): Promise<ToolApprovalDecisionResult> {
    let decisionInput: CapturedDecisionInput;
    try {
      decisionInput = captureDecisionInput(input);
    } catch {
      throw new InteractionCoordinatorError(
        INTERACTION_COORDINATOR_FAILURE.invalidDecisionInput,
        { inputEventId: safeIdentity(asRecord(input)?.id) },
      );
    }
    let actorId: string;
    try {
      actorId = requireIdentity(metadata?.actorId);
    } catch {
      throw new InteractionCoordinatorError(
        INTERACTION_COORDINATOR_FAILURE.invalidTrustedMetadata,
        {
          approvalRequestId: decisionInput.approvalRequestId,
          inputEventId: decisionInput.id,
        },
      );
    }
    return this.#serialize(() =>
      this.#resolveDecision(decisionInput, actorId),
    );
  }

  async cancel(
    approvalRequestId: string,
    cancelledAt: string,
  ): Promise<ToolApprovalDecisionResult> {
    const requestId = captureApprovalRequestId(approvalRequestId);
    const timestamp = captureTimestamp(cancelledAt);
    return this.#serialize(() =>
      this.#resolveInternal(requestId, "cancelled", timestamp),
    );
  }

  async expire(evaluatedAt: string): Promise<readonly ToolApprovalResolution[]> {
    const timestamp = captureTimestamp(evaluatedAt);
    return this.#serialize(async () => {
      const expired: ToolApprovalResolution[] = [];
      for (const pending of [...this.#pending.values()]) {
        if (pending.request.expiresAt > timestamp) continue;
        const result = await this.#settle(
          pending,
          "expired",
          timestamp,
        );
        expired.push(result);
      }
      return Object.freeze(expired);
    });
  }

  listPending(): Promise<readonly ToolApprovalRequest[]> {
    return this.#serialize(async () =>
      Object.freeze([...this.#pending.values()].map((pending) => pending.request)),
    );
  }

  snapshot(): Promise<ToolApprovalInteractionSnapshot> {
    return this.#serialize(async () => Object.freeze({
      schemaVersion: 1,
      pending: Object.freeze(
        [...this.#pending.values()].map((pending) => pending.request),
      ),
      resolved: Object.freeze([...this.#resolved.values()]),
    }));
  }

  async restore(snapshot: ToolApprovalInteractionSnapshot): Promise<void> {
    const captured = captureSnapshot(snapshot);
    return this.#serialize(async () => {
      if (this.#pending.size > 0 || this.#resolved.size > 0) {
        throw new InteractionCoordinatorError(
          INTERACTION_COORDINATOR_FAILURE.restoreConflict,
        );
      }
      for (const resolution of captured.resolved) {
        this.#resolved.set(resolution.approvalRequestId, resolution);
      }
      for (const request of captured.pending) {
        if (this.#resolved.has(request.approvalRequestId)) {
          throw new InteractionCoordinatorError(
            INTERACTION_COORDINATOR_FAILURE.invalidSnapshot,
            { approvalRequestId: request.approvalRequestId },
          );
        }
        const pending = createPending(request);
        pending.published = true;
        this.#pending.set(request.approvalRequestId, pending);
      }
      this.#logger.info("runtime.interaction.approval_restored", {
        pendingCount: captured.pending.length,
        resolvedCount: captured.resolved.length,
      });
    });
  }

  async #resolveDecision(
    input: CapturedDecisionInput,
    actorId: string,
  ): Promise<ToolApprovalDecisionResult> {
    const completed = this.#resolved.get(input.approvalRequestId);
    if (completed) {
      if (
        input.conversationId !== completed.identity.conversationId ||
        input.runId !== completed.identity.runId ||
        input.argumentDigest !== completed.identity.argumentDigest
      ) {
        return freezeDecisionResult(TOOL_APPROVAL_DECISION_OUTCOME.identityMismatch);
      }
      return freezeDecisionResult(TOOL_APPROVAL_DECISION_OUTCOME.duplicate, completed);
    }
    const pending = this.#pending.get(input.approvalRequestId);
    if (!pending) {
      return freezeDecisionResult(TOOL_APPROVAL_DECISION_OUTCOME.unknownRequest);
    }
    if (
      input.conversationId !== pending.request.identity.conversationId ||
      input.runId !== pending.request.identity.runId ||
      input.argumentDigest !== pending.request.identity.argumentDigest
    ) {
      this.#logger.debug("runtime.interaction.approval_identity_mismatch", {
        approvalRequestId: input.approvalRequestId,
        inputEventId: input.id,
      });
      return freezeDecisionResult(TOOL_APPROVAL_DECISION_OUTCOME.identityMismatch);
    }
    const resolution = await this.#settle(
      pending,
      input.decision,
      input.timestamp,
      actorId,
      input.id,
      input.correlationId,
    );
    return freezeDecisionResult(TOOL_APPROVAL_DECISION_OUTCOME.resolved, resolution);
  }

  async #resolveInternal(
    approvalRequestId: string,
    decision: "cancelled",
    resolvedAt: string,
  ): Promise<ToolApprovalDecisionResult> {
    const completed = this.#resolved.get(approvalRequestId);
    if (completed) {
      return freezeDecisionResult(TOOL_APPROVAL_DECISION_OUTCOME.duplicate, completed);
    }
    const pending = this.#pending.get(approvalRequestId);
    if (!pending) {
      return freezeDecisionResult(TOOL_APPROVAL_DECISION_OUTCOME.unknownRequest);
    }
    const resolution = await this.#settle(pending, decision, resolvedAt);
    return freezeDecisionResult(TOOL_APPROVAL_DECISION_OUTCOME.resolved, resolution);
  }

  async #settle(
    pending: PendingApproval,
    decision: ToolApprovalResolutionDecision,
    resolvedAt: string,
    actorId?: string,
    causationId?: string,
    correlationId?: string,
  ): Promise<ToolApprovalResolution> {
    const request = pending.request;
    const resolution = captureResolution({
      approvalRequestId: request.approvalRequestId,
      identity: request.identity,
      decision,
      ...(actorId === undefined ? {} : { actorId }),
      resolvedAt,
      ...(causationId === undefined ? {} : { causationId }),
    });
    this.#logger.info("runtime.interaction.approval_resolving", {
      approvalRequestId: request.approvalRequestId,
      conversationId: request.identity.conversationId,
      runId: request.identity.runId,
      toolCallId: request.identity.toolCallId,
      decision,
    });
    try {
      await this.#eventSink.append(
        this.#createResolvedEvent(resolution, request.turnId, correlationId),
      );
    } catch {
      throw this.#error(
        INTERACTION_COORDINATOR_FAILURE.resolutionPublicationFailed,
        request,
      );
    }
    this.#pending.delete(request.approvalRequestId);
    this.#resolved.set(request.approvalRequestId, resolution);
    pending.resolve(resolution);
    this.#logger.info("runtime.interaction.approval_resolved", {
      approvalRequestId: request.approvalRequestId,
      conversationId: request.identity.conversationId,
      runId: request.identity.runId,
      toolCallId: request.identity.toolCallId,
      decision,
    });
    return resolution;
  }

  #createRequestedEvent(request: ToolApprovalRequest): ToolApprovalRequestedOutputEvent {
    return new ToolApprovalRequestedOutputEvent({
      conversationId: request.identity.conversationId,
      id: this.#eventIdFactory.requested(request.approvalRequestId),
      runId: request.identity.runId,
      ...(request.turnId === undefined ? {} : { turnId: request.turnId }),
      approvalRequestId: request.approvalRequestId,
      toolCallId: request.identity.toolCallId,
      toolName: request.identity.toolName,
      toolVersion: request.identity.toolVersion,
      argumentDigest: request.identity.argumentDigest,
      summary: request.summary,
      requestedAt: request.requestedAt,
      expiresAt: request.expiresAt,
    });
  }

  #createResolvedEvent(
    resolution: ToolApprovalResolution,
    turnId?: string,
    correlationId?: string,
  ): ToolApprovalResolvedOutputEvent {
    return new ToolApprovalResolvedOutputEvent({
      conversationId: resolution.identity.conversationId,
      id: this.#eventIdFactory.resolved(resolution.approvalRequestId),
      runId: resolution.identity.runId,
      ...(turnId === undefined ? {} : { turnId }),
      ...(correlationId === undefined ? {} : { correlationId }),
      ...(resolution.causationId === undefined
        ? {}
        : { causationId: resolution.causationId }),
      approvalRequestId: resolution.approvalRequestId,
      toolCallId: resolution.identity.toolCallId,
      toolName: resolution.identity.toolName,
      toolVersion: resolution.identity.toolVersion,
      argumentDigest: resolution.identity.argumentDigest,
      decision: resolution.decision,
      ...(resolution.actorId === undefined ? {} : { actorId: resolution.actorId }),
      resolvedAt: resolution.resolvedAt,
    });
  }

  #error(
    failure: ConstructorParameters<typeof InteractionCoordinatorError>[0],
    request: ToolApprovalRequest,
  ): InteractionCoordinatorError {
    return new InteractionCoordinatorError(failure, {
      conversationId: request.identity.conversationId,
      runId: request.identity.runId,
      toolCallId: request.identity.toolCallId,
      approvalRequestId: request.approvalRequestId,
    });
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const DEFAULT_APPROVAL_EVENT_ID_FACTORY: ToolApprovalEventIdFactory = Object.freeze({
  requested: (requestId: string) => `evt_tool_approval_requested_${requestId}`,
  resolved: (requestId: string) => `evt_tool_approval_resolved_${requestId}`,
});

function createPending(request: ToolApprovalRequest): PendingApproval {
  let resolve!: (resolution: ToolApprovalResolution) => void;
  const promise = new Promise<ToolApprovalResolution>((settle) => {
    resolve = settle;
  });
  return {
    request,
    fingerprint: requestFingerprint(request),
    promise,
    resolve,
    published: false,
  };
}

function captureRequest(value: ToolApprovalRequest): ToolApprovalRequest {
  try {
    const identity = captureToolApprovalIdentity(value?.identity);
    const payload = new ToolApprovalRequestedPayload({
      approvalRequestId: value.approvalRequestId,
      toolCallId: identity.toolCallId,
      toolName: identity.toolName,
      toolVersion: identity.toolVersion,
      argumentDigest: identity.argumentDigest,
      summary: value.summary,
      requestedAt: value.requestedAt,
      expiresAt: value.expiresAt,
    });
    const turnId = value.turnId === undefined ? undefined : requireIdentity(value.turnId);
    return Object.freeze({
      approvalRequestId: payload.approvalRequestId,
      identity,
      ...(turnId === undefined ? {} : { turnId }),
      summary: payload.summary,
      requestedAt: payload.requestedAt,
      expiresAt: payload.expiresAt,
    });
  } catch {
    throw new InteractionCoordinatorError(
      INTERACTION_COORDINATOR_FAILURE.invalidRequest,
      {
        approvalRequestId: safeIdentity(value?.approvalRequestId),
        conversationId: safeIdentity(value?.identity?.conversationId),
        runId: safeIdentity(value?.identity?.runId),
        toolCallId: safeIdentity(value?.identity?.toolCallId),
      },
    );
  }
}

function captureResolution(value: ToolApprovalResolution): ToolApprovalResolution {
  const identity = captureToolApprovalIdentity(value.identity);
  const payload = new ToolApprovalResolvedPayload({
    approvalRequestId: value.approvalRequestId,
    toolCallId: identity.toolCallId,
    toolName: identity.toolName,
    toolVersion: identity.toolVersion,
    argumentDigest: identity.argumentDigest,
    decision: value.decision,
    ...(value.actorId === undefined ? {} : { actorId: value.actorId }),
    resolvedAt: value.resolvedAt,
  });
  const causationId = value.causationId === undefined
    ? undefined
    : requireIdentity(value.causationId);
  return Object.freeze({
    approvalRequestId: payload.approvalRequestId,
    identity,
    decision: payload.decision,
    ...(payload.actorId === undefined ? {} : { actorId: payload.actorId }),
    resolvedAt: payload.resolvedAt,
    ...(causationId === undefined ? {} : { causationId }),
  });
}

function captureDecisionInput(value: unknown): CapturedDecisionInput {
  const record = asRecord(value);
  const payload = asRecord(record?.payload);
  if (
    !record ||
    !payload ||
    record.direction !== "input" ||
    record.eventType !== INPUT_EVENT_TYPE.approvalDecision ||
    record.priority !== INPUT_PRIORITY.command ||
    !Number.isSafeInteger(record.sequence) ||
    (record.sequence as number) < 1
  ) {
    throw new Error();
  }
  if (
    Object.keys(payload).length !== 3 ||
    !Object.prototype.hasOwnProperty.call(payload, "approvalRequestId") ||
    !Object.prototype.hasOwnProperty.call(payload, "decision") ||
    !Object.prototype.hasOwnProperty.call(payload, "argumentDigest")
  ) {
    throw new Error();
  }
  const decision = payload.decision;
  if (decision !== "approved" && decision !== "rejected") throw new Error();
  const argumentDigest = payload.argumentDigest;
  if (typeof argumentDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(argumentDigest)) {
    throw new Error();
  }
  return Object.freeze({
    id: requireIdentity(record.id),
    conversationId: requireIdentity(record.conversationId),
    ...(record.correlationId === undefined
      ? {}
      : { correlationId: requireIdentity(record.correlationId) }),
    ...(record.causationId === undefined
      ? {}
      : { causationId: requireIdentity(record.causationId) }),
    ...(record.runId === undefined ? {} : { runId: requireIdentity(record.runId) }),
    ...(record.turnId === undefined ? {} : { turnId: requireIdentity(record.turnId) }),
    approvalRequestId: requireIdentity(payload.approvalRequestId),
    decision,
    argumentDigest: argumentDigest as `sha256:${string}`,
    timestamp: captureTimestamp(record.timestamp),
  });
}

function captureSnapshot(value: ToolApprovalInteractionSnapshot): ToolApprovalInteractionSnapshot {
  try {
    if (
      !value ||
      typeof value !== "object" ||
      value.schemaVersion !== 1 ||
      !Array.isArray(value.pending) ||
      !Array.isArray(value.resolved)
    ) {
      throw new Error();
    }
    const pending = Object.freeze(value.pending.map(captureRequest));
    const resolved = Object.freeze(value.resolved.map(captureResolution));
    const ids = new Set<string>();
    for (const entry of [...pending, ...resolved]) {
      if (ids.has(entry.approvalRequestId)) throw new Error();
      ids.add(entry.approvalRequestId);
    }
    return Object.freeze({ schemaVersion: 1, pending, resolved });
  } catch {
    throw new InteractionCoordinatorError(
      INTERACTION_COORDINATOR_FAILURE.invalidSnapshot,
    );
  }
}

function requestFingerprint(request: ToolApprovalRequest): string {
  return JSON.stringify([
    request.approvalRequestId,
    request.identity.conversationId,
    request.identity.runId,
    request.identity.toolCallId,
    request.identity.toolName,
    request.identity.toolVersion,
    request.identity.argumentDigest,
    request.turnId ?? null,
    request.summary.title,
    request.summary.description ?? null,
    request.requestedAt,
    request.expiresAt,
  ]);
}

function sameApprovalIdentity(
  left: ToolApprovalResolution["identity"],
  right: ToolApprovalRequest["identity"],
): boolean {
  return (
    left.conversationId === right.conversationId &&
    left.runId === right.runId &&
    left.toolCallId === right.toolCallId &&
    left.toolName === right.toolName &&
    left.toolVersion === right.toolVersion &&
    left.argumentDigest === right.argumentDigest
  );
}

function freezeDecisionResult(
  outcome: ToolApprovalDecisionResult["outcome"],
  resolution?: ToolApprovalResolution,
): ToolApprovalDecisionResult {
  return Object.freeze({
    outcome,
    ...(resolution === undefined ? {} : { resolution }),
  });
}

function captureTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new InteractionCoordinatorError(
      INTERACTION_COORDINATOR_FAILURE.invalidTimestamp,
    );
  }
  return value;
}

function captureApprovalRequestId(value: unknown): string {
  try {
    return requireIdentity(value);
  } catch {
    throw new InteractionCoordinatorError(
      INTERACTION_COORDINATOR_FAILURE.invalidRequest,
      { approvalRequestId: safeIdentity(value) },
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function requireIdentity(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
  ) {
    throw new Error();
  }
  return value;
}

function safeIdentity(value: unknown): string | undefined {
  try {
    return requireIdentity(value);
  } catch {
    return undefined;
  }
}
