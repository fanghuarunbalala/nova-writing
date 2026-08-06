/** Validates and defensively captures Runtime work-item snapshots at async boundaries. */
import {
  TASK_LIMITS,
  TASK_STATUS,
  type TaskStatus,
  type WorkItemListFilter,
  type WorkItemListSnapshot,
  type WorkItemSnapshot,
} from "./TaskProtocol.js";

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function captureTaskListId(value: unknown): string {
  return captureIdentity(value, "Task list ID");
}

export function captureTaskId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > TASK_LIMITS.maximumIdLength ||
    !TASK_ID_PATTERN.test(value)
  ) {
    throw new TypeError("Task ID is invalid");
  }
  return value;
}

export function captureTaskStatus(value: unknown): TaskStatus {
  if (
    value !== TASK_STATUS.pending &&
    value !== TASK_STATUS.inProgress &&
    value !== TASK_STATUS.completed &&
    value !== TASK_STATUS.deleted
  ) {
    throw new TypeError("Task status is invalid");
  }
  return value;
}

export function captureSubject(value: unknown): string {
  return captureBoundedString(
    value,
    "Task subject",
    TASK_LIMITS.maximumSubjectLength,
    true,
  );
}

export function captureDescription(value: unknown): string {
  return captureBoundedString(
    value,
    "Task description",
    TASK_LIMITS.maximumDescriptionLength,
    false,
  );
}

export function captureActiveForm(value: unknown): string | undefined {
  return value === undefined
    ? undefined
    : captureBoundedString(
        value,
        "Task active form",
        TASK_LIMITS.maximumActiveFormLength,
        true,
      );
}

export function captureOwner(value: unknown): string | undefined {
  return value === undefined
    ? undefined
    : captureBoundedString(
        value,
        "Task owner",
        TASK_LIMITS.maximumOwnerLength,
        true,
      );
}

export function captureMetadata(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new TypeError("Task metadata is invalid");
  const entries = Object.entries(value);
  if (entries.length > TASK_LIMITS.maximumMetadataEntries) {
    throw new TypeError("Task metadata is invalid");
  }
  const captured: Record<string, unknown> = {};
  for (const [key, entry] of entries) {
    if (
      typeof key !== "string" ||
      key.length === 0 ||
      key.length > TASK_LIMITS.maximumMetadataKeyLength
    ) {
      throw new TypeError("Task metadata is invalid");
    }
    if (
      typeof entry === "string" &&
      entry.length > TASK_LIMITS.maximumMetadataValueLength
    ) {
      throw new TypeError("Task metadata is invalid");
    }
    captured[key] = entry;
  }
  return Object.freeze(captured);
}

export function captureRelationIds(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > TASK_LIMITS.maximumRelationCount) {
    throw new TypeError("Task relation IDs are invalid");
  }
  const ids = new Set<string>();
  const captured = value.map((id) => {
    const taskId = captureTaskId(id);
    if (ids.has(taskId)) throw new TypeError("Task relation IDs must be unique");
    ids.add(taskId);
    return taskId;
  });
  return Object.freeze(captured);
}

export function captureWorkItemSnapshot(value: unknown): WorkItemSnapshot {
  if (!isRecord(value)) throw new TypeError("Work item is invalid");
  const id = captureTaskId(value.id);
  const subject = captureSubject(value.subject);
  const description = captureDescription(value.description);
  const status = captureTaskStatus(value.status);
  const activeForm = captureActiveForm(value.activeForm);
  const owner = captureOwner(value.owner);
  const blocks = captureRelationIds(value.blocks) ?? Object.freeze([]);
  const blockedBy = captureRelationIds(value.blockedBy) ?? Object.freeze([]);
  const metadata = captureMetadata(value.metadata) ?? Object.freeze({});
  const createdAt = captureIdentity(value.createdAt, "Task creation time");
  const updatedAt = captureIdentity(value.updatedAt, "Task update time");
  return Object.freeze({
    id,
    subject,
    description,
    status,
    ...(activeForm === undefined ? {} : { activeForm }),
    ...(owner === undefined ? {} : { owner }),
    blocks,
    blockedBy,
    metadata,
    createdAt,
    updatedAt,
  });
}

export function captureWorkItemListSnapshot(value: unknown): WorkItemListSnapshot {
  if (!isRecord(value)) throw new TypeError("Work item list snapshot is invalid");
  const listId = captureTaskListId(value.listId);
  const revision = captureRevision(value.revision);
  const nextTaskSequence = captureSequence(value.nextTaskSequence);
  const items = captureWorkItems(value.items);
  const updatedAt = captureIdentity(value.updatedAt, "Task list update time");
  return Object.freeze({
    listId,
    revision,
    nextTaskSequence,
    items,
    updatedAt,
  });
}

export function captureWorkItems(value: unknown): readonly WorkItemSnapshot[] {
  if (
    !Array.isArray(value) ||
    value.length > TASK_LIMITS.maximumItemsPerList
  ) {
    throw new TypeError("Work items are invalid");
  }
  const ids = new Set<string>();
  const captured = value.map((item) => {
    const snapshot = captureWorkItemSnapshot(item);
    if (ids.has(snapshot.id)) throw new TypeError("Work item IDs must be unique");
    ids.add(snapshot.id);
    return snapshot;
  });
  return Object.freeze(captured);
}

export function captureListFilter(value: unknown): WorkItemListFilter {
  if (value === undefined) return Object.freeze({});
  if (!isRecord(value)) throw new TypeError("Task list filter is invalid");
  const status =
    value.status === undefined ? undefined : captureTaskStatus(value.status);
  const owner =
    value.owner === undefined ? undefined : captureOwner(value.owner);
  return Object.freeze({
    ...(status === undefined ? {} : { status }),
    ...(owner === undefined ? {} : { owner }),
  });
}

function captureBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
  requireNonEmpty: boolean,
): string {
  if (
    typeof value !== "string" ||
    value.length > maxLength ||
    (requireNonEmpty && value.trim().length === 0)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function captureRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError("Task list revision is invalid");
  }
  return value as number;
}

function captureSequence(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError("Task sequence is invalid");
  }
  return value as number;
}

function captureIdentity(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 512
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
