import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AgentBindingIdentity,
  ConversationAgentBinding,
  ConversationCatalogStore,
  ConversationListQuery,
  ConversationMetadata,
  ConversationStatus,
  CreateConversationInput,
  StoredConversation,
  WorkspaceStoreLocation,
} from "../../storage/index.js";
import {
  ConversationAgentBindingMissingError,
  ConversationAlreadyExistsError,
  ConversationParentNotFoundError,
  ConversationWorkspaceMismatchError,
  WorkspaceDatabaseMismatchError,
} from "./ConversationCatalogErrors.js";
import { runCoreSqliteMigrations } from "./migrations.js";

interface ConversationRow {
  id: string;
  workspace_id: string;
  parent_conversation_id: string | null;
  root_conversation_id: string;
  status: ConversationStatus;
  created_at: string;
  updated_at: string;
  last_journal_sequence: number;
}

interface AgentBindingRow {
  id: string;
  conversation_id: string;
  revision: number;
  agent_type: string;
  definition_version: string;
  manifest_digest: string | null;
  status: "active" | "superseded" | "detached";
  created_at: string;
  superseded_at: string | null;
}

interface WorkspaceMetadataRow {
  workspace_id: string;
}

export interface SqliteConversationCatalogStoreOptions {
  workspace: WorkspaceStoreLocation;
}

export class SqliteConversationCatalogStore implements ConversationCatalogStore {
  private readonly database: DatabaseSync;
  private readonly workspace: WorkspaceStoreLocation;
  private closed = false;

  constructor(options: SqliteConversationCatalogStoreOptions) {
    this.workspace = options.workspace;
    mkdirSync(dirname(this.workspace.databasePath), { recursive: true });
    this.database = new DatabaseSync(this.workspace.databasePath);
    try {
      this.configureDatabase();
      runCoreSqliteMigrations(this.database);
      this.bindWorkspaceMetadata();
    } catch (error) {
      this.database.close();
      this.closed = true;
      throw error;
    }
  }

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
             created_at,
             updated_at,
             last_journal_sequence
           ) VALUES (?, ?, ?, ?, 'active', ?, ?, 0)`,
        )
        .run(
          input.id,
          input.workspaceId,
          input.parentConversationId ?? null,
          rootConversationId,
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
             manifest_digest,
             status,
             created_at
           ) VALUES (?, ?, 1, ?, ?, ?, 'active', ?)`,
        )
        .run(
          bindingId,
          input.id,
          input.agent.agentType,
          input.agent.definitionVersion,
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

  async close(): Promise<void> {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private configureDatabase(): void {
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA synchronous = FULL");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA busy_timeout = 5000");
  }

  private bindWorkspaceMetadata(): void {
    const existing = this.database
      .prepare("SELECT workspace_id FROM workspace_metadata LIMIT 1")
      .get() as WorkspaceMetadataRow | undefined;
    if (existing !== undefined && existing.workspace_id !== this.workspace.workspaceId) {
      throw new WorkspaceDatabaseMismatchError(
        this.workspace.databasePath,
        this.workspace.workspaceId,
        existing.workspace_id,
      );
    }

    this.database
      .prepare(
        `INSERT INTO workspace_metadata(
           workspace_id,
           workspace_root,
           store_dir_name,
           schema_version,
           created_at,
           updated_at
         ) VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT(workspace_id) DO UPDATE SET
           workspace_root = excluded.workspace_root,
           store_dir_name = excluded.store_dir_name,
           updated_at = excluded.updated_at`,
      )
      .run(
        this.workspace.workspaceId,
        this.workspace.workspaceRoot,
        this.workspace.storeDirName,
        this.workspace.createdAt,
        this.workspace.updatedAt,
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
    if (this.closed) throw new Error("SqliteConversationCatalogStore is closed");
  }
}
