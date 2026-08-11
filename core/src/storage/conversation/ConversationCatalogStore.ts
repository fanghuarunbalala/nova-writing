import type { ConversationMode } from "../../runtime/compose/index.js";
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

/** 活跃 compose 会话的持久子状态（仅 designing/pending 存行，终态由事件重建）。 */
/** Persisted active compose session sub-state (rows exist only while designing/pending). */
export interface ConversationComposeState {
  phase: "designing" | "pending";
  designFilePath: string;
  preMode: ConversationMode;
  updatedAt: string;
  /** 进入 compose 时的创作目的（EnterComposeMode 的 purpose），重启恢复用。 */
  /** Creation purpose recorded on entry (EnterComposeMode purpose), restored on hydrate. */
  purpose?: string;
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

  /** 设置会话持久模式。Sets the persistent conversation mode. */
  setConversationMode(
    conversationId: string,
    mode: ConversationMode,
  ): Promise<ConversationMetadata>;

  /** 读取活跃 compose 会话子状态；无会话时返回 undefined。 */
  getConversationComposeState(
    conversationId: string,
  ): Promise<ConversationComposeState | undefined>;

  /** 写入/清除活跃 compose 会话子状态（传 undefined 删除行）。 */
  setConversationComposeState(
    conversationId: string,
    state: ConversationComposeState | undefined,
  ): Promise<void>;

  /** 硬删除对话（物理移除会话及其关联记录）。Hard-deletes a conversation. */
  deleteConversation(conversationId: string): Promise<void>;
}
