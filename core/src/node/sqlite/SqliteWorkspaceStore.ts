import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createCoreEventSchemaRegistry,
  type EventSchemaRegistry,
} from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type {
  ConversationCatalogStore,
  ConversationJournalStore,
  WorkspaceStoreLocation,
} from "../../storage/index.js";
import {
  NodeConversationMessageProjectionContextFactory,
  SqliteWorkspaceStoreClosedError,
  SqliteWorkspaceStoreClosingError,
  type CreateMessageProjectionContextOptions,
  type NodeConversationMessageProjectionContext,
} from "../message/index.js";
import { WorkspaceDatabaseMismatchError } from "./ConversationCatalogErrors.js";
import { SqliteConversationCatalogStore } from "./SqliteConversationCatalogStore.js";
import { SqliteConversationJournalStore } from "./SqliteConversationJournalStore.js";
import { SqliteAgentManifestStore } from "../agent/manifest/index.js";
import { runCoreSqliteMigrations } from "./migrations.js";

interface WorkspaceMetadataRow {
  workspace_id: string;
}

export interface SqliteWorkspaceStoreOptions {
  workspace: WorkspaceStoreLocation;
  eventSchemaRegistry?: EventSchemaRegistry;
  logger?: Logger;
}

export class SqliteWorkspaceStore {
  readonly conversations: ConversationCatalogStore;
  readonly journal: ConversationJournalStore;
  readonly agentManifests: SqliteAgentManifestStore;

  private readonly logger: Logger;
  private readonly projectionContextFactory: NodeConversationMessageProjectionContextFactory;
  private readonly projectionContexts = new Set<NodeConversationMessageProjectionContext>();
  private closing = false;
  private closed = false;
  private closePromise?: Promise<void>;

  private constructor(
    private readonly database: DatabaseSync,
    public readonly workspace: WorkspaceStoreLocation,
    eventSchemaRegistry: EventSchemaRegistry,
    logger: Logger,
  ) {
    this.logger = logger.child({
      component: "sqlite_workspace_store",
      workspaceId: workspace.workspaceId,
    });
    const ensureOpen = (): void => this.assertOpen();
    this.conversations = new SqliteConversationCatalogStore(database, workspace, ensureOpen);
    this.journal = new SqliteConversationJournalStore(database, eventSchemaRegistry, ensureOpen);
    this.agentManifests = new SqliteAgentManifestStore(database, ensureOpen, {
      logger: this.logger,
    });
    this.projectionContextFactory = new NodeConversationMessageProjectionContextFactory({
      workspace,
      journal: this.journal,
      logger: this.logger,
      onContextClosed: (context) => {
        this.projectionContexts.delete(context);
        this.logger.debug("message_projection.context.unregistered", {
          projectionContextCount: this.projectionContexts.size,
        });
      },
    });
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
        options.logger ?? noopLogger,
      );
    } catch (error) {
      database.close();
      throw error;
    }
  }

  createMessageProjectionContext(
    options: CreateMessageProjectionContextOptions,
  ): NodeConversationMessageProjectionContext {
    this.assertOpen();
    const context = this.projectionContextFactory.create(options);
    this.projectionContexts.add(context);
    this.logger.debug("message_projection.context.registered", {
      projectionContextCount: this.projectionContexts.size,
      projectorId: options.projector.id,
      projectorVersion: options.projector.version,
    });
    return context;
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private async closeOnce(): Promise<void> {
    this.closing = true;
    const contexts = [...this.projectionContexts];
    this.logger.info("workspace_store.close.started", {
      projectionContextCount: contexts.length,
    });
    const errors: unknown[] = [];

    const contextResults = await Promise.allSettled(
      contexts.map((context) => context.close()),
    );
    for (const result of contextResults) {
      if (result.status === "rejected") errors.push(result.reason);
    }
    this.logger.debug("workspace_store.close.contexts_completed", {
      projectionContextCount: contexts.length,
      contextErrorCount: errors.length,
    });

    try {
      this.database.close();
      this.logger.debug("workspace_store.close.database_completed");
    } catch (error) {
      errors.push(error);
    } finally {
      this.closed = true;
      this.closing = false;
    }

    if (errors.length > 0) {
      this.logger.error("workspace_store.close.failed", {
        errorCount: errors.length,
      });
      if (errors.length === 1) throw errors[0];
      throw new AggregateError(errors, "Failed to close SqliteWorkspaceStore resources");
    }
    this.logger.info("workspace_store.close.completed");
  }

  private assertOpen(): void {
    if (this.closing) throw new SqliteWorkspaceStoreClosingError();
    if (this.closed) throw new SqliteWorkspaceStoreClosedError();
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
