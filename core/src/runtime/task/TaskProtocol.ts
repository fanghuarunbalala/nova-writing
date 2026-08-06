/** Provider-neutral Runtime work-item (Task) state shared by Task Tools and projections. */

export const TASK_STATUS = {
  pending: "pending",
  inProgress: "in_progress",
  completed: "completed",
  deleted: "deleted",
} as const;

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

export const TASK_LIMITS = {
  maximumItemsPerList: 256,
  maximumSubjectLength: 200,
  maximumDescriptionLength: 4_000,
  maximumActiveFormLength: 120,
  maximumIdLength: 128,
  maximumOwnerLength: 128,
  maximumRelationCount: 32,
  maximumMetadataEntries: 16,
  maximumMetadataKeyLength: 64,
  maximumMetadataValueLength: 2_000,
} as const;

export interface WorkItemSnapshot {
  readonly id: string;
  readonly subject: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly activeForm?: string;
  readonly owner?: string;
  readonly blocks: readonly string[];
  readonly blockedBy: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkItemListSnapshot {
  readonly listId: string;
  readonly revision: number;
  readonly nextTaskSequence: number;
  readonly items: readonly WorkItemSnapshot[];
  readonly updatedAt: string;
}

export interface WorkItemListStore {
  read(listId: string): Promise<WorkItemListSnapshot | undefined>;
  save(snapshot: WorkItemListSnapshot): Promise<void>;
}

export interface WorkItemListReader {
  read(listId: string): Promise<WorkItemListSnapshot | undefined>;
}

export interface WorkItemListFilter {
  readonly status?: TaskStatus;
  readonly owner?: string;
}

export interface WorkItemMutationRequest {
  readonly conversationId: string;
  readonly listId: string;
  readonly runId: string;
  readonly toolCallId: string;
  readonly turnId?: string;
}

export interface WorkItemCreateRequest extends WorkItemMutationRequest {
  readonly subject: string;
  readonly description: string;
  readonly activeForm?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface WorkItemUpdateRequest extends WorkItemMutationRequest {
  readonly taskId: string;
  readonly subject?: string;
  readonly description?: string;
  readonly activeForm?: string;
  readonly status?: TaskStatus;
  readonly owner?: string;
  readonly blocks?: readonly string[];
  readonly addBlockedBy?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface WorkItemWriteResult {
  readonly listId: string;
  readonly revision: number;
  readonly task: WorkItemSnapshot;
  readonly eventSequence: number;
}

export interface WorkItemWriter {
  create(request: WorkItemCreateRequest): Promise<WorkItemWriteResult>;
  update(request: WorkItemUpdateRequest): Promise<WorkItemWriteResult>;
}

export interface WorkItemListQuerier {
  list(
    listId: string,
    filter?: WorkItemListFilter,
  ): Promise<readonly WorkItemSnapshot[]>;
  get(listId: string, taskId: string): Promise<WorkItemSnapshot | undefined>;
}

export interface TaskListContext {
  readonly conversationId: string;
  readonly teamName?: string;
}

export interface TaskListResolver {
  resolve(context: TaskListContext): Promise<string>;
}

export class WorkItemNotFoundError extends Error {
  readonly listId: string;
  readonly taskId: string;

  constructor(listId: string, taskId: string) {
    super(`Work item ${taskId} does not exist in list ${listId}`);
    this.name = "WorkItemNotFoundError";
    this.listId = listId;
    this.taskId = taskId;
  }
}
