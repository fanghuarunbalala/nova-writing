/** Fixed Runtime persistence RPC allowlist and serializable request/response contracts. */
import type { OutputEventSnapshot } from "../../../event/index.js";
import type {
  ConversationEventPage,
  ConversationEventQuery,
  ConversationMessageFilePage,
  ConversationMessageFileQuery,
  PersistedConversationEventSnapshot,
} from "../../../storage/index.js";
import type { RuntimeRecoverySnapshot } from "./RuntimeRecoverySnapshot.js";

export const RUNTIME_PERSISTENCE_RPC_METHOD = Object.freeze({
  journalGetEvent: "journal.getEvent",
  journalListEvents: "journal.listEvents",
  journalAppendOutput: "journal.appendOutput",
  messagesList: "messages.list",
  runtimeStateLoad: "runtimeState.load",
} as const);

export type RuntimePersistenceRpcMethod =
  (typeof RUNTIME_PERSISTENCE_RPC_METHOD)[keyof typeof RUNTIME_PERSISTENCE_RPC_METHOD];

export interface RuntimeJournalGetEventRequest {
  readonly conversationId: string;
  readonly sequence: number;
}

export type RuntimeJournalGetEventResponse =
  | { readonly found: false }
  | {
      readonly found: true;
      readonly event: PersistedConversationEventSnapshot;
    };

export type RuntimeJournalListEventsRequest = ConversationEventQuery;
export type RuntimeJournalListEventsResponse = ConversationEventPage;

export interface RuntimeJournalAppendOutputRequest {
  readonly conversationId: string;
  readonly snapshot: OutputEventSnapshot;
}

export interface RuntimeJournalAppendOutputReceipt {
  readonly status: "appended" | "duplicate";
  readonly conversationId: string;
  readonly eventId: string;
  readonly sequence: number;
  readonly recordedAt: string;
}

export type RuntimeMessagesListRequest = ConversationMessageFileQuery;
export type RuntimeMessagesListResponse = ConversationMessageFilePage;

export interface RuntimeStateLoadRequest {
  readonly conversationId: string;
}

export type RuntimeStateLoadResponse = RuntimeRecoverySnapshot;
