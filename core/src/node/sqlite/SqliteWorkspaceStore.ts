import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createCoreEventSchemaRegistry,
  type EventSchemaRegistry,
} from "../../event/index.js";
import type {
  ConversationCatalogStore,
  ConversationJournalStore,
  WorkspaceStoreLocation,
} from "../../storage/index.js";
import { WorkspaceDatabaseMismatchError } from "./ConversationCatalogErrors.js";
import { SqliteConversationCatalogStore } from "./SqliteConversationCatalogStore.js";
import { SqliteConversationJournalStore } from "./SqliteConversationJournalStore.js";
import { runCoreSqliteMigrations } from "./migrations.js";

interface WorkspaceMetadataRow {
  workspace_id: string;
}

export interface SqliteWorkspaceStoreOptions {
  workspace: WorkspaceStoreLocation;
  eventSchemaRegistry?: EventSchemaRegistry;
}

export class SqliteWorkspaceStore {
  readonly conversations: ConversationCatalogStore;
  readonly journal: ConversationJournalStore;

  private closed = false;

  private constructor(
    private readonly database: DatabaseSync,
    public readonly workspace: WorkspaceStoreLocation,
    eventSchemaRegistry: EventSchemaRegistry,
  ) {
    const ensureOpen = (): void => this.assertOpen();
    this.conversations = new SqliteConversationCatalogStore(database, workspace, ensureOpen);
    this.journal = new SqliteConversationJournalStore(database, eventSchemaRegistry, ensureOpen);
  }

  static async open(options: SqliteWorkspaceStoreOptions): Promise<SqliteWorkspaceStore> {
    await mkdir(dirname(options.workspace.databasePath), { recursive: true });
    const database = new DatabaseSync(options.workspace.databasePath);

    try {
      configureDatabase(database);
      runCoreSqliteMigrations(database);
      bindWorkspaceMetadata(database, options.workspace);
      return new SqliteWorkspaceStore(
        database,
        options.workspace,
        options.eventSchemaRegistry ?? createCoreEventSchemaRegistry(),
      );
    } catch (error) {
      database.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("SqliteWorkspaceStore is closed");
  }
}

function configureDatabase(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
}

function bindWorkspaceMetadata(
  database: DatabaseSync,
  workspace: WorkspaceStoreLocation,
): void {
  const existing = database
    .prepare("SELECT workspace_id FROM workspace_metadata LIMIT 1")
    .get() as WorkspaceMetadataRow | undefined;
  if (existing !== undefined && existing.workspace_id !== workspace.workspaceId) {
    throw new WorkspaceDatabaseMismatchError(
      workspace.databasePath,
      workspace.workspaceId,
      existing.workspace_id,
    );
  }

  database
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
      workspace.workspaceId,
      workspace.workspaceRoot,
      workspace.storeDirName,
      workspace.createdAt,
      workspace.updatedAt,
    );
}
