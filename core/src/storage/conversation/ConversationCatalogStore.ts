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
  title?: string;
  pinned?: boolean;
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

  /** 重命名对话。Renames a conversation. */
  renameConversation(conversationId: string, title: string): Promise<ConversationMetadata>;

  /** 置顶/取消置顶。Pins or unpins a conversation. */
  setConversationPinned(
    conversationId: string,
    pinned: boolean,
  ): Promise<ConversationMetadata>;

  /** 硬删除对话（物理移除会话及其关联记录）。Hard-deletes a conversation. */
  deleteConversation(conversationId: string): Promise<void>;
}
