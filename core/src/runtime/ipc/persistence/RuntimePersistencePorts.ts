/** Narrow child-side persistence Ports; no SQL, paths, or generic key/value access. */
import type { OutputEventSnapshot } from "../../../event/index.js";
import type {
  ConversationEventPage,
  ConversationEventQuery,
  ConversationMessageFilePage,
  ConversationMessageFileQuery,
  PersistedConversationEventSnapshot,
} from "../../../storage/index.js";
import type {
  RuntimeJournalAppendOutputReceipt,
} from "./RuntimePersistenceProtocol.js";
import type { RuntimeRecoverySnapshot } from "./RuntimeRecoverySnapshot.js";

export interface RuntimeJournalPersistencePort {
  getEvent(
    conversationId: string,
    sequence: number,
    options?: RuntimePersistenceRequestOptions,
  ): Promise<PersistedConversationEventSnapshot | undefined>;

  listEvents(
    query: ConversationEventQuery,
    options?: RuntimePersistenceRequestOptions,
  ): Promise<ConversationEventPage>;

  appendOutput(
    conversationId: string,
    snapshot: OutputEventSnapshot,
    options?: RuntimePersistenceRequestOptions,
  ): Promise<RuntimeJournalAppendOutputReceipt>;
}

export interface RuntimeMessagePersistencePort {
  list(
    query: ConversationMessageFileQuery,
    options?: RuntimePersistenceRequestOptions,
  ): Promise<ConversationMessageFilePage>;
}

export interface RuntimeStatePersistencePort {
  load(
    conversationId: string,
    options?: RuntimePersistenceRequestOptions,
  ): Promise<RuntimeRecoverySnapshot>;
}

export interface RuntimePersistencePorts {
  readonly journal: RuntimeJournalPersistencePort;
  readonly messages: RuntimeMessagePersistencePort;
  readonly runtimeState: RuntimeStatePersistencePort;
}

export interface RuntimePersistenceRequestOptions {
  readonly signal?: AbortSignal;
}
