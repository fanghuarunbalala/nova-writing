/** Journal-first work-item writer that emits a complete immutable OutputEvent snapshot per list. */
import { AgentWorkItemsUpdatedOutputEvent } from "../../event/output/AgentWorkItemsUpdatedOutputEvent.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type { RuntimeEventSink } from "../execution/event/RuntimeEventSink.js";
import {
  TASK_STATUS,
  WorkItemNotFoundError,
  type WorkItemCreateRequest,
  type WorkItemListFilter,
  type WorkItemListQuerier,
  type WorkItemListReader,
  type WorkItemListSnapshot,
  type WorkItemListStore,
  type WorkItemSnapshot,
  type WorkItemUpdateRequest,
  type WorkItemWriteResult,
  type WorkItemWriter,
} from "./TaskProtocol.js";
import {
  captureActiveForm,
  captureDescription,
  captureListFilter,
  captureMetadata,
  captureOwner,
  captureRelationIds,
  captureSubject,
  captureTaskId,
  captureTaskListId,
  captureTaskStatus,
  captureWorkItemListSnapshot,
} from "./TaskProtocolValidator.js";

export interface WorkItemCoordinatorOptions {
  readonly store: WorkItemListStore;
  readonly eventSink: RuntimeEventSink;
  readonly clock?: { now(): string };
  readonly logger?: Logger;
}

export class WorkItemCoordinator
  implements WorkItemListReader, WorkItemWriter, WorkItemListQuerier
{
  readonly #store: WorkItemListStore;
  readonly #eventSink: RuntimeEventSink;
  readonly #clock: { now(): string };
  readonly #logger: Logger;

  constructor(options: WorkItemCoordinatorOptions) {
    this.#store = options.store;
    this.#eventSink = options.eventSink;
    this.#clock = options.clock ?? SYSTEM_CLOCK;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "work_item_coordinator",
    });
  }

  async read(listId: string): Promise<WorkItemListSnapshot | undefined> {
    return this.#store.read(captureTaskListId(listId));
  }

  async list(
    listId: string,
    filter?: WorkItemListFilter,
  ): Promise<readonly WorkItemSnapshot[]> {
    const capturedListId = captureTaskListId(listId);
    const capturedFilter = captureListFilter(filter);
    const snapshot = await this.#store.read(capturedListId);
    if (snapshot === undefined) return Object.freeze([]);
    return Object.freeze(
      snapshot.items.filter((item) => matchesFilter(item, capturedFilter)),
    );
  }

  async get(
    listId: string,
    taskId: string,
  ): Promise<WorkItemSnapshot | undefined> {
    const capturedListId = captureTaskListId(listId);
    const capturedTaskId = captureTaskId(taskId);
    const snapshot = await this.#store.read(capturedListId);
    const item = snapshot?.items.find(
      (candidate) => candidate.id === capturedTaskId,
    );
    return item === undefined ? undefined : item;
  }

  async create(request: WorkItemCreateRequest): Promise<WorkItemWriteResult> {
    const conversationId = requireIdentity(request.conversationId, "Conversation ID");
    const listId = captureTaskListId(request.listId);
    const runId = requireIdentity(request.runId, "Run ID");
    const toolCallId = requireIdentity(request.toolCallId, "Tool Call ID");
    const subject = captureSubject(request.subject);
    const description = captureDescription(request.description);
    const activeForm = captureActiveForm(request.activeForm);
    const metadata = captureMetadata(request.metadata);
    const now = this.#clock.now();
    const previous = await this.#store.read(listId);
    const sequence = previous?.nextTaskSequence ?? 1;
    const task: WorkItemSnapshot = Object.freeze({
      id: `task-${sequence}`,
      subject,
      description,
      status: TASK_STATUS.pending,
      ...(activeForm === undefined ? {} : { activeForm }),
      blocks: Object.freeze([]),
      blockedBy: Object.freeze([]),
      metadata: metadata ?? Object.freeze({}),
      createdAt: now,
      updatedAt: now,
    });
    const items = Object.freeze([...(previous?.items ?? []), task]);
    const snapshot = captureWorkItemListSnapshot({
      listId,
      revision: (previous?.revision ?? 0) + 1,
      nextTaskSequence: sequence + 1,
      items,
      updatedAt: now,
    });
    const event = new AgentWorkItemsUpdatedOutputEvent({
      conversationId,
      runId,
      toolCallId,
      ...(request.turnId === undefined ? {} : { turnId: request.turnId }),
      listId,
      revision: snapshot.revision,
      nextTaskSequence: snapshot.nextTaskSequence,
      items: snapshot.items,
      updatedAt: snapshot.updatedAt,
    });
    const receipt = await this.#eventSink.append(event);
    await this.#store.save(snapshot);
    this.#logger.info("runtime.task.created", {
      conversationId,
      listId,
      runId,
      toolCallId,
      taskId: task.id,
      revision: snapshot.revision,
      eventSequence: receipt.sequence,
    });
    return Object.freeze({
      listId,
      revision: snapshot.revision,
      task,
      eventSequence: receipt.sequence,
    });
  }

  async update(request: WorkItemUpdateRequest): Promise<WorkItemWriteResult> {
    const conversationId = requireIdentity(request.conversationId, "Conversation ID");
    const listId = captureTaskListId(request.listId);
    const runId = requireIdentity(request.runId, "Run ID");
    const toolCallId = requireIdentity(request.toolCallId, "Tool Call ID");
    const taskId = captureTaskId(request.taskId);
    const previous = await this.#store.read(listId);
    const existing = previous?.items.find(
      (candidate) => candidate.id === taskId,
    );
    if (previous === undefined || existing === undefined) {
      throw new WorkItemNotFoundError(listId, taskId);
    }
    const now = this.#clock.now();
    const updated = applyTaskUpdate(existing, request, now);
    const items = Object.freeze(
      previous.items.map((candidate) =>
        candidate.id === taskId ? updated : candidate,
      ),
    );
    const snapshot = captureWorkItemListSnapshot({
      listId,
      revision: previous.revision + 1,
      nextTaskSequence: previous.nextTaskSequence,
      items,
      updatedAt: now,
    });
    const event = new AgentWorkItemsUpdatedOutputEvent({
      conversationId,
      runId,
      toolCallId,
      ...(request.turnId === undefined ? {} : { turnId: request.turnId }),
      listId,
      revision: snapshot.revision,
      nextTaskSequence: snapshot.nextTaskSequence,
      items: snapshot.items,
      updatedAt: snapshot.updatedAt,
    });
    const receipt = await this.#eventSink.append(event);
    await this.#store.save(snapshot);
    this.#logger.info("runtime.task.updated", {
      conversationId,
      listId,
      runId,
      toolCallId,
      taskId,
      revision: snapshot.revision,
      eventSequence: receipt.sequence,
    });
    return Object.freeze({
      listId,
      revision: snapshot.revision,
      task: updated,
      eventSequence: receipt.sequence,
    });
  }
}

const SYSTEM_CLOCK = Object.freeze({
  now: () => new Date().toISOString(),
});

function matchesFilter(
  item: WorkItemSnapshot,
  filter: WorkItemListFilter,
): boolean {
  if (
    item.status === TASK_STATUS.deleted &&
    filter.status !== TASK_STATUS.deleted
  ) {
    return false;
  }
  if (filter.status !== undefined && item.status !== filter.status) {
    return false;
  }
  if (filter.owner !== undefined && item.owner !== filter.owner) {
    return false;
  }
  return true;
}

function applyTaskUpdate(
  existing: WorkItemSnapshot,
  request: WorkItemUpdateRequest,
  now: string,
): WorkItemSnapshot {
  const subject =
    request.subject === undefined
      ? existing.subject
      : captureSubject(request.subject);
  const description =
    request.description === undefined
      ? existing.description
      : captureDescription(request.description);
  const activeForm =
    request.activeForm === undefined
      ? existing.activeForm
      : captureActiveForm(request.activeForm);
  const status =
    request.status === undefined
      ? existing.status
      : captureTaskStatus(request.status);
  const owner =
    request.owner === undefined
      ? existing.owner
      : captureOwner(request.owner);
  const blocks =
    request.blocks === undefined
      ? existing.blocks
      : (captureRelationIds(request.blocks) ?? Object.freeze([]));
  const blockedBy =
    request.addBlockedBy === undefined
      ? existing.blockedBy
      : unionIds(
          existing.blockedBy,
          captureRelationIds(request.addBlockedBy) ?? [],
        );
  const metadata =
    request.metadata === undefined
      ? existing.metadata
      : mergeMetadata(existing.metadata, request.metadata);
  return Object.freeze({
    id: existing.id,
    subject,
    description,
    status,
    ...(activeForm === undefined ? {} : { activeForm }),
    ...(owner === undefined ? {} : { owner }),
    blocks,
    blockedBy,
    metadata,
    createdAt: existing.createdAt,
    updatedAt: now,
  });
}

function unionIds(
  left: readonly string[],
  right: readonly string[],
): readonly string[] {
  return Object.freeze([...new Set([...left, ...right])]);
}

function mergeMetadata(
  base: Readonly<Record<string, unknown>>,
  update: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(update)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return Object.freeze(merged);
}

function requireIdentity(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
