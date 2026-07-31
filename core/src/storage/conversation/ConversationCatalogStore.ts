import type {
  AgentBindingIdentity,
  ConversationAgentBinding,
} from "./ConversationAgentBinding.js";
import type { ConversationMetadata, ConversationStatus } from "./ConversationMetadata.js";

export interface CreateConversationInput {
  id: string;
  workspaceId: string;
  parentConversationId?: string;
  agent: AgentBindingIdentity;
  createdAt?: string;
}

export interface StoredConversation {
  metadata: ConversationMetadata;
  activeAgentBinding: ConversationAgentBinding;
}

export interface ConversationListQuery {
  workspaceId: string;
  rootConversationId?: string;
  parentConversationId?: string;
  status?: ConversationStatus;
  limit?: number;
}

export interface ConversationMetadataStore {
  getConversationMetadata(conversationId: string): Promise<ConversationMetadata | undefined>;

  listConversationMetadata(query: ConversationListQuery): Promise<ConversationMetadata[]>;
}

export interface ConversationAgentBindingStore {
  getActiveAgentBinding(
    conversationId: string,
  ): Promise<ConversationAgentBinding | undefined>;

  listAgentBindings(conversationId: string): Promise<ConversationAgentBinding[]>;
}

export interface ConversationCatalogStore
  extends ConversationMetadataStore,
    ConversationAgentBindingStore {
  createConversation(input: CreateConversationInput): Promise<StoredConversation>;

  getConversation(conversationId: string): Promise<StoredConversation | undefined>;

  close(): Promise<void>;
}
