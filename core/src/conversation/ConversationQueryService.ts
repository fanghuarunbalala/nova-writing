/** Read-only Conversation service; these operations never activate Runtime. */
import type {
  ConversationEventPage,
  ConversationEventSubscription,
} from "../storage/index.js";
import type { GlobalApprovalProjection } from "./ConversationApprovalProjection.js";
import type {
  BoundConversationEventSubscriptionOptions,
  ConversationEventListOptions,
} from "./ConversationEvents.js";
import type { ConversationSnapshotReader } from "./ConversationSnapshotReader.js";

export interface ConversationQueryService extends ConversationSnapshotReader {
  /** 聚合工作区内全部会话的审批（含 pending 与已决）。Aggregate approvals across conversations. */
  listApprovals(): Promise<readonly GlobalApprovalProjection[]>;

  listEvents(
    conversationId: string,
    options: ConversationEventListOptions,
  ): Promise<ConversationEventPage>;

  subscribeEvents(
    conversationId: string,
    options: BoundConversationEventSubscriptionOptions,
  ): ConversationEventSubscription;
}
