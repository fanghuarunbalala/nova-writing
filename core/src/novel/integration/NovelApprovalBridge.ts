/** Coordinates durable Novel Approval requests with asynchronous decision Inputs. */
import {
  ApprovalDecisionPayload,
  INPUT_EVENT_TYPE,
  INPUT_PRIORITY,
  type InputEventSnapshot,
} from "../../event/index.js";
import type {
  ConversationOutputEventPublisher,
  OutputReceipt,
} from "../../conversation/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  NOVEL_APPROVAL_DECISION_OUTCOME,
  captureNovelApprovalRequest,
  createNovelApprovalRequest,
  type NovelApprovalDecisionResult,
  type NovelApprovalRequest,
  type NovelApprovalResolution,
} from "../approval/index.js";
import { captureNovelChangeSet, type NovelChangeSet } from "../commit/index.js";
import {
  NOVEL_APPROVAL_BRIDGE_FAILURE,
  NovelApprovalBridgeError,
} from "../error/index.js";
import { captureNovelTimestamp, type NovelTimestamp } from "../version/index.js";
import { NovelApprovalRequestedOutputEvent } from "./NovelApprovalRequestedOutputEvent.js";

export interface NovelChangeSetApprovalGranter {
  grant(changeSet: NovelChangeSet): Promise<unknown>;
}

export interface NovelApprovalBridgeOptions {
  readonly outputPublisher: ConversationOutputEventPublisher;
  readonly approvalGranter: NovelChangeSetApprovalGranter;
  readonly logger?: Logger;
}

interface PendingApproval {
  readonly request: NovelApprovalRequest;
  readonly promise: Promise<NovelApprovalResolution>;
  readonly resolve: (resolution: NovelApprovalResolution) => void;
  published: boolean;
}

interface CapturedDecision {
  readonly id: string;
  readonly conversationId: string;
  readonly approvalRequestId: string;
  readonly decision: "approved" | "rejected";
  readonly changeSetDigest: string;
  readonly timestamp: NovelTimestamp;
}

export class NovelApprovalBridge {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly resolved = new Map<string, NovelApprovalResolution>();
  private readonly logger: Logger;
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly options: NovelApprovalBridgeOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_approval_bridge",
    });
  }

  async request(
    changeSet: NovelChangeSet,
    conversationId: string,
    requestedAt: NovelTimestamp,
  ): Promise<NovelApprovalResolution> {
    const request = createNovelApprovalRequest(
      changeSet,
      conversationId,
      requestedAt,
    );
    let waiter: Promise<NovelApprovalResolution> | undefined;
    await this.serialize(async () => {
      const completed = this.resolved.get(request.approvalRequestId);
      if (completed !== undefined) {
        if (!sameRequest(completed.request, request)) throw conflict();
        waiter = Promise.resolve(completed);
        return;
      }
      let pending = this.pending.get(request.approvalRequestId);
      if (pending !== undefined && !sameRequest(pending.request, request)) {
        throw conflict();
      }
      if (pending === undefined) {
        pending = createPending(request);
        this.pending.set(request.approvalRequestId, pending);
      }
      if (!pending.published) {
        let receipt: OutputReceipt;
        try {
          receipt = await this.options.outputPublisher.publish(
            new NovelApprovalRequestedOutputEvent(request),
          );
        } catch {
          throw new NovelApprovalBridgeError(
            NOVEL_APPROVAL_BRIDGE_FAILURE.requestPublicationFailed,
          );
        }
        if (
          receipt.conversationId !== request.conversationId ||
          receipt.outputEventId !== request.approvalRequestId ||
          (receipt.status !== "recorded" && receipt.status !== "duplicate") ||
          !Number.isSafeInteger(receipt.sequence) ||
          receipt.sequence < 1
        ) {
          throw new NovelApprovalBridgeError(
            NOVEL_APPROVAL_BRIDGE_FAILURE.invalidPublisherReceipt,
          );
        }
        try {
          captureNovelTimestamp(receipt.recordedAt);
        } catch {
          throw new NovelApprovalBridgeError(
            NOVEL_APPROVAL_BRIDGE_FAILURE.invalidPublisherReceipt,
          );
        }
        pending.published = true;
        this.logger.info("novel_approval.requested", {
          draftSessionId: request.draftSessionId,
          operationCount: request.operationIds.length,
        });
      }
      waiter = pending.promise;
    });
    return waiter!;
  }

  async resolve(
    input: InputEventSnapshot,
    currentChangeSetInput: NovelChangeSet,
  ): Promise<NovelApprovalDecisionResult> {
    const decision = captureDecision(input);
    const currentChangeSet = captureNovelChangeSet(currentChangeSetInput);
    return this.serialize(async () => {
      const completed = this.resolved.get(decision.approvalRequestId);
      if (completed !== undefined) {
        return Object.freeze({
          outcome:
            decisionMatchesRequest(decision, completed.request)
              ? NOVEL_APPROVAL_DECISION_OUTCOME.duplicate
              : NOVEL_APPROVAL_DECISION_OUTCOME.identityMismatch,
          ...(decisionMatchesRequest(decision, completed.request)
            ? { resolution: completed }
            : {}),
        });
      }
      const pending = this.pending.get(decision.approvalRequestId);
      if (pending === undefined) {
        return Object.freeze({
          outcome: NOVEL_APPROVAL_DECISION_OUTCOME.unknownRequest,
        });
      }
      if (!decisionMatchesRequest(decision, pending.request)) {
        return Object.freeze({
          outcome: NOVEL_APPROVAL_DECISION_OUTCOME.identityMismatch,
        });
      }
      if (!changeSetMatchesRequest(currentChangeSet, pending.request)) {
        const resolution = this.settle(pending, "stale", decision);
        return Object.freeze({
          outcome: NOVEL_APPROVAL_DECISION_OUTCOME.staleChangeSet,
          resolution,
        });
      }
      if (decision.decision === "approved") {
        try {
          await this.options.approvalGranter.grant(currentChangeSet);
        } catch {
          throw new NovelApprovalBridgeError(
            NOVEL_APPROVAL_BRIDGE_FAILURE.approvalGrantFailed,
          );
        }
      }
      const resolution = this.settle(pending, decision.decision, decision);
      return Object.freeze({
        outcome: NOVEL_APPROVAL_DECISION_OUTCOME.resolved,
        resolution,
      });
    });
  }

  listPending(): Promise<readonly NovelApprovalRequest[]> {
    return this.serialize(async () =>
      Object.freeze([...this.pending.values()].map((value) => value.request)),
    );
  }

  private settle(
    pending: PendingApproval,
    decision: NovelApprovalResolution["decision"],
    input: CapturedDecision,
  ): NovelApprovalResolution {
    const resolution = Object.freeze({
      request: pending.request,
      decision,
      inputEventId: input.id,
      resolvedAt: input.timestamp,
    });
    this.pending.delete(pending.request.approvalRequestId);
    this.resolved.set(pending.request.approvalRequestId, resolution);
    pending.resolve(resolution);
    this.logger.info("novel_approval.resolved", {
      draftSessionId: pending.request.draftSessionId,
      decision,
    });
    return resolution;
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function createPending(request: NovelApprovalRequest): PendingApproval {
  let resolve!: (resolution: NovelApprovalResolution) => void;
  const promise = new Promise<NovelApprovalResolution>((settle) => {
    resolve = settle;
  });
  return { request, promise, resolve, published: false };
}

function captureDecision(input: InputEventSnapshot): CapturedDecision {
  try {
    if (
      input.eventType !== INPUT_EVENT_TYPE.approvalDecision ||
      input.priority !== INPUT_PRIORITY.command
    ) {
      throw new Error();
    }
    const payload = new ApprovalDecisionPayload(
      input.payload as unknown as ConstructorParameters<
        typeof ApprovalDecisionPayload
      >[0],
    );
    return Object.freeze({
      id: input.id,
      conversationId: input.conversationId,
      approvalRequestId: payload.approvalRequestId,
      decision: payload.decision,
      changeSetDigest: payload.argumentDigest,
      timestamp: captureNovelTimestamp(input.timestamp),
    });
  } catch {
    throw new NovelApprovalBridgeError(
      NOVEL_APPROVAL_BRIDGE_FAILURE.invalidDecisionInput,
    );
  }
}

function sameRequest(
  left: NovelApprovalRequest,
  right: NovelApprovalRequest,
): boolean {
  return (
    left.approvalRequestId === right.approvalRequestId &&
    left.novelId === right.novelId &&
    left.conversationId === right.conversationId &&
    left.draftSessionId === right.draftSessionId &&
    left.baseRevision === right.baseRevision &&
    left.changeSetDigest === right.changeSetDigest &&
    left.operationIds.length === right.operationIds.length &&
    left.operationIds.every((value, index) => value === right.operationIds[index])
  );
}

function decisionMatchesRequest(
  decision: CapturedDecision,
  request: NovelApprovalRequest,
): boolean {
  return (
    decision.conversationId === request.conversationId &&
    decision.changeSetDigest === request.changeSetDigest
  );
}

function changeSetMatchesRequest(
  changeSet: NovelChangeSet,
  request: NovelApprovalRequest,
): boolean {
  return (
    changeSet.novelId === request.novelId &&
    changeSet.draftSessionId === request.draftSessionId &&
    changeSet.baseRevision === request.baseRevision &&
    changeSet.digest === request.changeSetDigest &&
    changeSet.operations.length === request.operationIds.length &&
    changeSet.operations.every(
      (entry, index) =>
        entry.operation.operationId === request.operationIds[index],
    )
  );
}

function conflict(): NovelApprovalBridgeError {
  return new NovelApprovalBridgeError(
    NOVEL_APPROVAL_BRIDGE_FAILURE.requestConflict,
  );
}
