/** Opens, validates, and owns the canonical Novel SQLite control database. */
import { DatabaseSync } from "node:sqlite";
import {
  RandomNovelIdentityFactory,
  RandomNovelRevisionFactory,
  SystemNovelClock,
  captureNovelCanonicalMetadata,
  captureNovelId,
  captureNovelRevision,
  captureNovelSchemaVersion,
  captureNovelTimestamp,
  captureNovelWorkspaceId,
  type NovelCanonicalMetadata,
  type NovelCanonicalStore,
  type NovelClock,
  type NovelId,
  type NovelIdentityFactory,
  type NovelRevisionFactory,
  type NovelSchemaVersion,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import {
  NOVEL_DATABASE_FAILURE,
  NovelDatabaseError,
} from "./NovelDatabaseErrors.js";
import {
  runNovelSqliteMigrations,
} from "./NovelSqliteMigrations.js";

interface NovelMetadataRow {
  novel_id: string;
  workspace_id: string;
  schema_version: number;
  current_revision: string;
  created_at: string;
  updated_at: string;
}

export interface SqliteNovelCanonicalStoreOptions {
  readonly location: NodeNovelStoreLocation;
  readonly expectedNovelId?: NovelId;
  readonly identityFactory?: NovelIdentityFactory;
  readonly revisionFactory?: NovelRevisionFactory;
  readonly clock?: NovelClock;
  readonly logger?: Logger;
}

export class SqliteNovelCanonicalStore implements NovelCanonicalStore {
  private closed = false;
  private closePromise?: Promise<void>;

  private constructor(
    private readonly database: DatabaseSync,
    private metadata: NovelCanonicalMetadata,
    private readonly logger: Logger,
  ) {}

  static async open(
    options: SqliteNovelCanonicalStoreOptions,
  ): Promise<SqliteNovelCanonicalStore> {
    const workspaceId = captureWorkspaceId(options.location.workspaceId);
    const logger = (options.logger ?? noopLogger).child({
      component: "sqlite_novel_canonical_store",
      workspaceId,
    });
    const clock = options.clock ?? new SystemNovelClock();
    logger.info("novel_store.open.started");

    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(options.location.canonicalDatabasePath);
      configureDatabase(database);
      const schemaVersion = runNovelSqliteMigrations(database, clock);
      validateNovelDatabaseStructure(database);
      logger.debug("novel_store.migrations.completed", { schemaVersion });
      const metadata = bindNovelMetadata(database, {
        workspaceId,
        expectedNovelId: options.expectedNovelId,
        schemaVersion,
        identityFactory: options.identityFactory ?? new RandomNovelIdentityFactory(),
        revisionFactory: options.revisionFactory ?? new RandomNovelRevisionFactory(),
        clock,
      });
      const storeLogger = logger.child({ novelId: metadata.novelId });
      storeLogger.info("novel_store.open.completed", {
        schemaVersion: metadata.schemaVersion,
      });
      return new SqliteNovelCanonicalStore(database, metadata, storeLogger);
    } catch (error) {
      try {
        database?.close();
      } catch {}
      logger.error("novel_store.open.failed", {
        failure:
          error instanceof NovelDatabaseError
            ? error.failure
            : NOVEL_DATABASE_FAILURE.invalidStructure,
      });
      if (error instanceof NovelDatabaseError) throw error;
      throw new NovelDatabaseError(
        NOVEL_DATABASE_FAILURE.invalidStructure,
        workspaceId,
      );
    }
  }

  async getMetadata(): Promise<NovelCanonicalMetadata> {
    this.assertOpen();
    this.metadata = readNovelMetadata(this.database, {
      workspaceId: this.metadata.workspaceId,
      expectedNovelId: this.metadata.novelId,
      schemaVersion: this.metadata.schemaVersion,
    });
    return this.metadata;
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private async closeOnce(): Promise<void> {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
    this.logger.info("novel_store.close.completed");
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new NovelDatabaseError(
        NOVEL_DATABASE_FAILURE.closed,
        this.metadata.workspaceId,
        this.metadata.novelId,
      );
    }
  }
}

function captureWorkspaceId(value: unknown): string {
  try {
    return captureNovelWorkspaceId(value);
  } catch {
    throw new NovelDatabaseError(NOVEL_DATABASE_FAILURE.invalidStructure);
  }
}

function validateNovelDatabaseStructure(database: DatabaseSync): void {
  try {
    const integrity = database.prepare("PRAGMA integrity_check").get() as
      | { integrity_check?: unknown }
      | undefined;
    if (integrity?.integrity_check !== "ok") throw new Error();
    if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
      throw new Error();
    }

    for (const statement of [
      "SELECT version, name, applied_at FROM novel_schema_migrations LIMIT 0",
      `SELECT singleton, novel_id, workspace_id, schema_version, current_revision,
              created_at, updated_at FROM novel_metadata LIMIT 0`,
      `SELECT id, novel_id, owner_conversation_id, base_revision, status,
              staging_key, created_at, updated_at, terminal_at
       FROM novel_draft_sessions LIMIT 0`,
      `SELECT commit_id, novel_id, draft_session_id, owner_conversation_id,
              base_revision, result_revision, change_set_digest, payload_ref,
              payload_digest, payload_size, committed_at
       FROM novel_commits LIMIT 0`,
      `SELECT event_id, novel_id, conversation_id, event_type, schema_version,
              event_json, event_digest, created_at, published_at, attempt_count
       FROM novel_outbox LIMIT 0`,
      `SELECT id, name, aliases_json, summary, initial_state, author_notes,
              entity_version, created_at, updated_at
       FROM novel_characters LIMIT 0`,
      `SELECT id, name, aliases_json, summary, initial_state, author_notes,
              entity_version, created_at, updated_at
       FROM novel_locations LIMIT 0`,
      "SELECT id, novel_id FROM novel_publication_structures LIMIT 0",
      `SELECT id, publication_id, order_key, title, primary_story_unit_id
       FROM novel_publication_volumes LIMIT 0`,
      `SELECT id, publication_id, volume_id, order_key, title
       FROM novel_publication_chapters LIMIT 0`,
      "SELECT id, novel_id, publication_id FROM novel_manuscripts LIMIT 0",
      `SELECT id, manuscript_id, chapter_id, order_key, text, text_digest,
              chapter_digest, order_digest
       FROM novel_manuscript_blocks LIMIT 0`,
      `SELECT block_id, manuscript_id, former_chapter_id, former_order_key,
              reason, replacement_block_id
       FROM novel_manuscript_block_tombstones LIMIT 0`,
      `SELECT source_block_id, source_boundary, target_block_id,
              target_boundary, reason, review
       FROM novel_manuscript_anchor_redirects LIMIT 0`,
      `SELECT story_unit_id, character_id, binding_json, binding_digest
       FROM novel_story_unit_character_bindings LIMIT 0`,
      `SELECT story_unit_id, location_id, binding_json, binding_digest
       FROM novel_story_unit_location_bindings LIMIT 0`,
      `SELECT id, story_unit_id, change_json, change_digest
       FROM novel_story_unit_entity_changes LIMIT 0`,
      `SELECT story_unit_id, realization_json, realization_digest
       FROM novel_story_unit_realizations LIMIT 0`,
    ]) {
      database.prepare(statement);
    }
  } catch {
    throw new NovelDatabaseError(NOVEL_DATABASE_FAILURE.invalidStructure);
  }
}

interface BindNovelMetadataOptions {
  readonly workspaceId: string;
  readonly expectedNovelId?: NovelId;
  readonly schemaVersion: NovelSchemaVersion;
  readonly identityFactory: NovelIdentityFactory;
  readonly revisionFactory: NovelRevisionFactory;
  readonly clock: NovelClock;
}

function bindNovelMetadata(
  database: DatabaseSync,
  options: BindNovelMetadataOptions,
): NovelCanonicalMetadata {
  const existing = database
    .prepare(
      `SELECT novel_id, workspace_id, schema_version, current_revision, created_at, updated_at
       FROM novel_metadata
       WHERE singleton = 1`,
    )
    .get() as NovelMetadataRow | undefined;

  if (existing === undefined) {
    const timestamp = options.clock.now();
    const novelId = options.expectedNovelId ?? options.identityFactory.createNovelId();
    const revision = options.revisionFactory.createRevision();
    database
      .prepare(
        `INSERT INTO novel_metadata(
           singleton,
           novel_id,
           workspace_id,
           schema_version,
           current_revision,
           created_at,
           updated_at
         ) VALUES (1, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        novelId,
        options.workspaceId,
        options.schemaVersion,
        revision,
        timestamp,
        timestamp,
      );
    return captureNovelCanonicalMetadata({
      novelId,
      workspaceId: options.workspaceId,
      schemaVersion: options.schemaVersion,
      currentRevision: revision,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  return validateNovelMetadataRow(existing, options);
}

function readNovelMetadata(
  database: DatabaseSync,
  options: Pick<
    BindNovelMetadataOptions,
    "workspaceId" | "expectedNovelId" | "schemaVersion"
  >,
): NovelCanonicalMetadata {
  const existing = database
    .prepare(
      `SELECT novel_id, workspace_id, schema_version, current_revision, created_at, updated_at
       FROM novel_metadata
       WHERE singleton = 1`,
    )
    .get() as NovelMetadataRow | undefined;
  if (existing === undefined) {
    throw new NovelDatabaseError(NOVEL_DATABASE_FAILURE.invalidStructure);
  }
  return validateNovelMetadataRow(existing, options);
}

function validateNovelMetadataRow(
  existing: NovelMetadataRow,
  options: Pick<
    BindNovelMetadataOptions,
    "workspaceId" | "expectedNovelId" | "schemaVersion"
  >,
): NovelCanonicalMetadata {

  let metadata: NovelCanonicalMetadata;
  try {
    metadata = captureNovelCanonicalMetadata({
      novelId: captureNovelId(existing.novel_id),
      workspaceId: existing.workspace_id,
      schemaVersion: captureNovelSchemaVersion(existing.schema_version),
      currentRevision: captureNovelRevision(existing.current_revision),
      createdAt: captureNovelTimestamp(existing.created_at),
      updatedAt: captureNovelTimestamp(existing.updated_at),
    });
  } catch {
    throw new NovelDatabaseError(NOVEL_DATABASE_FAILURE.invalidStructure);
  }

  if (metadata.workspaceId !== options.workspaceId) {
    throw new NovelDatabaseError(
      NOVEL_DATABASE_FAILURE.workspaceMismatch,
      options.workspaceId,
      metadata.novelId,
    );
  }
  if (
    options.expectedNovelId !== undefined &&
    metadata.novelId !== options.expectedNovelId
  ) {
    throw new NovelDatabaseError(
      NOVEL_DATABASE_FAILURE.novelMismatch,
      options.workspaceId,
      options.expectedNovelId,
    );
  }
  if (metadata.schemaVersion !== options.schemaVersion) {
    throw new NovelDatabaseError(
      NOVEL_DATABASE_FAILURE.unsupportedSchema,
      options.workspaceId,
      metadata.novelId,
    );
  }
  return metadata;
}

function configureDatabase(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
}
