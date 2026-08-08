import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  ConversationAgentBindingMissingError,
  ConversationAlreadyExistsError,
  ConversationParentNotFoundError,
  ConversationWorkspaceMismatchError,
} from "../../storage/index.js";
import {
  isConversationMode,
  type ConversationMode,
} from "../../runtime/compose/index.js";
import type {
  AgentBindingIdentity,
  ConversationAgentBinding,
  ConversationCatalogStore,
  ConversationComposeState,
  ConversationListQuery,
  ConversationMetadata,
  ConversationStatus,
  CreateConversationInput,
  StoredConversation,
  WorkspaceStoreLocation,
} from "../../storage/index.js";

interface ConversationRow {
  id: string;
  workspace_id: string;
  parent_conversation_id: string | null;
  root_conversation_id: string;
  status: ConversationStatus;
  title: string;
  pinned: number;
  mode: string;
  created_at: string;
  updated_at: string;
  last_journal_sequence: number;
}

interface ConversationComposeStateRow {
  conversation_id: string;
  phase: "designing" | "pending";
  design_file_path: string;
  pre_mode: string;
  updated_at: string;
}

interface AgentBindingRow {
  id: string;
  conversation_id: string;
  revision: number;
  agent_type: string;
  definition_version: string;
  manifest_id: string | null;
  manifest_digest: string | null;
  status: "active" | "superseded" | "detached";
  created_at: string;
  superseded_at: string | null;
}

export class SqliteConversationCatalogStore implements ConversationCatalogStore {
  constructor(
    private readonly database: DatabaseSync,
    private readonly workspace: WorkspaceStoreLocation,
    private readonly ensureWorkspaceOpen: () => void,
  ) {}

  async createConversation(input: CreateConversationInput): Promise<StoredConversation> {
    this.assertOpen();
    this.validateCreateInput(input);

    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (this.selectConversationRow(input.id) !== undefined) {
        throw new ConversationAlreadyExistsError(input.id);
      }

      const parent =
        input.parentConversationId === undefined
          ? undefined
          : this.selectConversationRow(input.parentConversationId);
      if (input.parentConversationId !== undefined && parent === undefined) {
        throw new ConversationParentNotFoundError(input.parentConversationId);
      }
      if (parent !== undefined && parent.workspace_id !== input.workspaceId) {
        throw new ConversationWorkspaceMismatchError(
          parent.id,
          input.workspaceId,
          parent.workspace_id,
        );
      }

      const timestamp = input.createdAt ?? new Date().toISOString();
      const rootConversationId = parent?.root_conversation_id ?? input.id;
      this.database
        .prepare(
          `INSERT INTO conversations(
             id,
             workspace_id,
             parent_conversation_id,
             root_conversation_id,
             status,
             title,
             pinned,
             created_at,
             updated_at,
             last_journal_sequence
           ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, 0)`,
        )
        .run(
          input.id,
          input.workspaceId,
          input.parentConversationId ?? null,
          rootConversationId,
          input.title ?? "新对话",
          input.pinned === true ? 1 : 0,
          timestamp,
          timestamp,
        );

      const bindingId = `binding-${randomUUID()}`;
      this.database
        .prepare(
          `INSERT INTO conversation_agent_bindings(
             id,
             conversation_id,
             revision,
             agent_type,
             definition_version,
             manifest_id,
             manifest_digest,
             status,
             created_at
           ) VALUES (?, ?, 1, ?, ?, ?, ?, 'active', ?)`,
        )
        .run(
          bindingId,
          input.id,
          input.agent.agentType,
          input.agent.definitionVersion,
          input.agent.manifestId ?? null,
          input.agent.manifestDigest ?? null,
          timestamp,
        );

      this.database.exec("COMMIT");

      return {
        metadata: {
          id: input.id,
          workspaceId: input.workspaceId,
          ...(input.parentConversationId !== undefined
            ? { parentConversationId: input.parentConversationId }
            : {}),
          rootConversationId,
          status: "active",
          title: input.title ?? "新对话",
          pinned: input.pinned === true,
          mode: "review",
          createdAt: timestamp,
          updatedAt: timestamp,
          lastJournalSequence: 0,
        },
        activeAgentBinding: {
          id: bindingId,
          conversationId: input.id,
          revision: 1,
          ...input.agent,
          status: "active",
          createdAt: timestamp,
        },
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async getConversation(conversationId: string): Promise<StoredConversation | undefined> {
    const metadata = await this.getConversationMetadata(conversationId);
    if (metadata === undefined) return undefined;

    const activeAgentBinding = await this.getActiveAgentBinding(conversationId);
    if (activeAgentBinding === undefined) {
      throw new ConversationAgentBindingMissingError(conversationId);
    }

    return { metadata, activeAgentBinding };
  }

  async getConversationMetadata(conversationId: string): Promise<ConversationMetadata | undefined> {
    this.assertOpen();
    const row = this.selectConversationRow(conversationId);
    return row === undefined ? undefined : this.mapConversationRow(row);
  }

  async listConversationMetadata(query: ConversationListQuery): Promise<ConversationMetadata[]> {
    this.assertOpen();
    if (query.workspaceId !== this.workspace.workspaceId) {
      throw new ConversationWorkspaceMismatchError(
        "catalog",
        this.workspace.workspaceId,
        query.workspaceId,
      );
    }

    const conditions = ["workspace_id = ?"];
    const parameters: Array<string | number> = [query.workspaceId];
    if (query.rootConversationId !== undefined) {
      conditions.push("root_conversation_id = ?");
      parameters.push(query.rootConversationId);
    }
    if (query.parentConversationId !== undefined) {
      conditions.push("parent_conversation_id = ?");
      parameters.push(query.parentConversationId);
    }
    if (query.status !== undefined) {
      conditions.push("status = ?");
      parameters.push(query.status);
    }

    const limit = Math.min(Math.max(query.limit ?? 100, 1), 1_000);
    parameters.push(limit);
    const rows = this.database
      .prepare(
        `SELECT * FROM conversations
         WHERE ${conditions.join(" AND ")}
         ORDER BY created_at ASC, id ASC
         LIMIT ?`,
      )
      .all(...parameters) as unknown as ConversationRow[];

    return rows.map((row) => this.mapConversationRow(row));
  }

  async getActiveAgentBinding(
    conversationId: string,
  ): Promise<ConversationAgentBinding | undefined> {
    this.assertOpen();
    const row = this.database
      .prepare(
        `SELECT * FROM conversation_agent_bindings
         WHERE conversation_id = ? AND status = 'active'`,
      )
      .get(conversationId) as AgentBindingRow | undefined;
    return row === undefined ? undefined : this.mapAgentBindingRow(row);
  }

  async listAgentBindings(conversationId: string): Promise<ConversationAgentBinding[]> {
    this.assertOpen();
    const rows = this.database
      .prepare(
        `SELECT * FROM conversation_agent_bindings
         WHERE conversation_id = ?
         ORDER BY revision ASC`,
      )
      .all(conversationId) as unknown as AgentBindingRow[];
    return rows.map((row) => this.mapAgentBindingRow(row));
  }

  async renameConversation(
    conversationId: string,
    title: string,
  ): Promise<ConversationMetadata> {
    this.assertOpen();
    if (typeof title !== "string" || title.trim().length === 0) {
      throw new TypeError("Conversation title must be a non-empty string");
    }
    const current = this.selectConversationRow(conversationId);
    if (current === undefined) {
      throw new Error("Conversation not found");
    }
    const updatedAt = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`,
      )
      .run(title.trim(), updatedAt, conversationId);
    return this.mapConversationRow({
      ...current,
      title: title.trim(),
      updated_at: updatedAt,
    });
  }

  async setConversationPinned(
    conversationId: string,
    pinned: boolean,
  ): Promise<ConversationMetadata> {
    this.assertOpen();
    const current = this.selectConversationRow(conversationId);
    if (current === undefined) {
      throw new Error("Conversation not found");
    }
    const updatedAt = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE conversations SET pinned = ?, updated_at = ? WHERE id = ?`,
      )
      .run(pinned ? 1 : 0, updatedAt, conversationId);
    return this.mapConversationRow({
      ...current,
      pinned: pinned ? 1 : 0,
      updated_at: updatedAt,
    });
  }

  async setConversationMode(
    conversationId: string,
    mode: ConversationMode,
  ): Promise<ConversationMetadata> {
    this.assertOpen();
    if (!isConversationMode(mode)) {
      throw new TypeError("Conversation mode is invalid");
    }
    const current = this.selectConversationRow(conversationId);
    if (current === undefined) {
      throw new Error("Conversation not found");
    }
    // mode 变化不改 updated_at:catalog 排序按会话活动时间,模式迁移不应置顶列表。
    this.database
      .prepare("UPDATE conversations SET mode = ? WHERE id = ?")
      .run(mode, conversationId);
    return this.mapConversationRow({ ...current, mode });
  }

  async getConversationComposeState(
    conversationId: string,
  ): Promise<ConversationComposeState | undefined> {
    this.assertOpen();
    const row = this.database
      .prepare(
        `SELECT * FROM conversation_compose_state WHERE conversation_id = ?`,
      )
      .get(conversationId) as ConversationComposeStateRow | undefined;
    if (row === undefined) return undefined;
    return {
      phase: row.phase,
      designFilePath: row.design_file_path,
      preMode: isConversationMode(row.pre_mode)
        ? row.pre_mode
        : "review",
      updatedAt: row.updated_at,
    };
  }

  async setConversationComposeState(
    conversationId: string,
    state: ConversationComposeState | undefined,
  ): Promise<void> {
    this.assertOpen();
    if (state === undefined) {
      this.database
        .prepare(
          `DELETE FROM conversation_compose_state WHERE conversation_id = ?`,
        )
        .run(conversationId);
      return;
    }
    this.database
      .prepare(
        `INSERT INTO conversation_compose_state(
           conversation_id, phase, design_file_path, pre_mode, updated_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET
           phase = excluded.phase,
           design_file_path = excluded.design_file_path,
           pre_mode = excluded.pre_mode,
           updated_at = excluded.updated_at`,
      )
      .run(
        conversationId,
        state.phase,
        state.designFilePath,
        state.preMode,
        state.updatedAt,
      );
  }

  async deleteConversation(conversationId: string): Promise<void> {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (this.selectConversationRow(conversationId) === undefined) {
        throw new Error("Conversation not found");
      }
      // 硬删除：物理移除会话及其全部关联记录（journal / bindings / 子代理）。
      this.database
        .prepare("DELETE FROM subagent_binding_changes WHERE conversation_id = ?")
        .run(conversationId);
      this.database
        .prepare("DELETE FROM subagent_bindings WHERE conversation_id = ?")
        .run(conversationId);
      this.database
        .prepare("DELETE FROM conversation_agent_bindings WHERE conversation_id = ?")
        .run(conversationId);
      this.database
        .prepare("DELETE FROM journal_records WHERE conversation_id = ?")
        .run(conversationId);
      this.database
        .prepare("DELETE FROM conversations WHERE id = ?")
        .run(conversationId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    // 删除该会话的消息投影目录（硬删除后不可恢复）。
    await rm(
      join(this.workspace.storeDir, "conversations", conversationId),
      { recursive: true, force: true },
    );
  }

  private selectConversationRow(conversationId: string): ConversationRow | undefined {
    return this.database.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId) as
      | ConversationRow
      | undefined;
  }

  private mapConversationRow(row: ConversationRow): ConversationMetadata {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      ...(row.parent_conversation_id !== null
        ? { parentConversationId: row.parent_conversation_id }
        : {}),
      rootConversationId: row.root_conversation_id,
      status: row.status,
      title: row.title,
      pinned: row.pinned === 1,
      ...(isConversationMode(row.mode)
        ? { mode: row.mode }
        : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastJournalSequence: row.last_journal_sequence,
    };
  }

  private mapAgentBindingRow(row: AgentBindingRow): ConversationAgentBinding {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      revision: row.revision,
      agentType: row.agent_type,
      definitionVersion: row.definition_version,
      ...(row.manifest_id !== null ? { manifestId: row.manifest_id } : {}),
      ...(row.manifest_digest !== null ? { manifestDigest: row.manifest_digest } : {}),
      status: row.status,
      createdAt: row.created_at,
      ...(row.superseded_at !== null ? { supersededAt: row.superseded_at } : {}),
    };
  }

  private validateCreateInput(input: CreateConversationInput): void {
    this.assertNonEmpty("conversation id", input.id);
    this.assertNonEmpty("workspace id", input.workspaceId);
    this.assertNonEmpty("agent type", input.agent.agentType);
    this.assertNonEmpty("agent definition version", input.agent.definitionVersion);
    if (input.workspaceId !== this.workspace.workspaceId) {
      throw new ConversationWorkspaceMismatchError(
        input.id,
        this.workspace.workspaceId,
        input.workspaceId,
      );
    }
  }

  private assertNonEmpty(label: string, value: string): void {
    if (value.trim().length === 0) throw new TypeError(`${label} must not be empty`);
  }

  private assertOpen(): void {
    this.ensureWorkspaceOpen();
  }
}
