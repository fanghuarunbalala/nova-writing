/** SQLite canonical-or-Draft adapter for strict disposable Novel projection caches. */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  canonicalStringifyJson,
  type JsonObject,
} from "../../../event/index.js";
import {
  NOVEL_INVARIANT_FAILURE,
  NovelInvariantViolationError,
  canonicalizeNovelProjectionTarget,
  captureNovelId,
  captureNovelProjectionCacheEntry,
  captureNovelProjectionTarget,
  captureNovelReadScope,
  captureNovelRevision,
  type NovelClock,
  type NovelId,
  type NovelProjectionCacheEntry,
  type NovelProjectionStore,
  type NovelProjectionTarget,
  type NovelProjectionTargetInventory,
  type NovelReadScope,
  type PutNovelProjectionCacheInput,
  type ReplaceNovelProjectionCacheInput,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import { initializeNovelDraftSqliteSchema } from "./NovelDraftSqliteSchema.js";
import { runNovelSqliteMigrations } from "./NovelSqliteMigrations.js";

export interface SqliteNovelProjectionStoreOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly scope: NovelReadScope;
  readonly clock: NovelClock;
  readonly logger?: Logger;
}

interface ProjectionRow {
  readonly projection_key: string;
  readonly target_json: string;
  readonly projection_json: string;
  readonly projection_digest: string;
}

export class SqliteNovelProjectionStore implements NovelProjectionStore {
  private readonly novelId: NovelId;
  private readonly scope: NovelReadScope;
  private readonly logger: Logger;

  constructor(private readonly options: SqliteNovelProjectionStoreOptions) {
    this.novelId = captureNovelId(options.novelId);
    this.scope = captureNovelReadScope(options.scope);
    if (
      this.scope.kind === "draft" &&
      this.scope.session.novelId !== this.novelId
    ) {
      throw mismatch(this.novelId, this.scope);
    }
    this.logger = (options.logger ?? noopLogger).child({
      component: "sqlite_novel_projection_store",
      workspaceId: options.location.workspaceId,
      novelId: this.novelId,
      scope: this.scope.kind,
    });
  }

  async getEntry(
    novelIdInput: NovelId,
    targetInput: NovelProjectionTarget,
  ): Promise<NovelProjectionCacheEntry | undefined> {
    this.assertNovel(novelIdInput);
    const target = captureNovelProjectionTarget(targetInput);
    return this.read((database) => {
      const canonicalTarget = canonicalizeNovelProjectionTarget(target);
      const row = database.prepare(
        `SELECT projection_key, target_json, projection_json, projection_digest
         FROM novel_projection_cache WHERE projection_key = ?`,
      ).get(digest(canonicalTarget)) as ProjectionRow | undefined;
      if (row === undefined) return undefined;
      const captured = captureRow(row);
      if (canonicalizeNovelProjectionTarget(captured.target) !== canonicalTarget) {
        throw new Error();
      }
      return captured;
    });
  }

  async putEntry(input: PutNovelProjectionCacheInput): Promise<void> {
    this.assertNovel(input.novelId);
    const rebuildRevision = captureNovelRevision(input.rebuildRevision);
    const entry = captureNovelProjectionCacheEntry(input.entry);
    await this.write((database) => {
      writeEntry(
        database,
        entry,
        rebuildRevision,
        this.options.clock.now(),
      );
    }, "put", 1);
  }

  async deleteEntry(
    novelIdInput: NovelId,
    targetInput: NovelProjectionTarget,
  ): Promise<void> {
    this.assertNovel(novelIdInput);
    const target = captureNovelProjectionTarget(targetInput);
    await this.write((database) => {
      database.prepare(
        "DELETE FROM novel_projection_cache WHERE projection_key = ?",
      ).run(digest(canonicalizeNovelProjectionTarget(target)));
    }, "delete", 1);
  }

  async inspectTargets(
    novelIdInput: NovelId,
  ): Promise<NovelProjectionTargetInventory> {
    this.assertNovel(novelIdInput);
    return this.read((database) => {
      const rows = database.prepare(
        `SELECT projection_key, target_json
         FROM novel_projection_cache ORDER BY projection_key`,
      ).all() as unknown as Array<{
        projection_key: string;
        target_json: string;
      }>;
      const targets: NovelProjectionTarget[] = [];
      let corruptCount = 0;
      for (const row of rows) {
        try {
          const target = captureNovelProjectionTarget(JSON.parse(row.target_json));
          if (digest(canonicalizeNovelProjectionTarget(target)) !== row.projection_key) {
            throw new Error();
          }
          targets.push(target);
        } catch {
          corruptCount += 1;
        }
      }
      return Object.freeze({
        storedCount: rows.length,
        corruptCount,
        targets: Object.freeze(targets),
      });
    });
  }

  async replaceCache(input: ReplaceNovelProjectionCacheInput): Promise<void> {
    this.assertNovel(input.novelId);
    const rebuildRevision = captureNovelRevision(input.rebuildRevision);
    const entries = Object.freeze(
      input.entries.map(captureNovelProjectionCacheEntry),
    );
    const keys = entries.map((entry) =>
      digest(canonicalizeNovelProjectionTarget(entry.target))
    );
    if (new Set(keys).size !== keys.length) {
      throw new TypeError("Novel projection replacement contains duplicates");
    }
    await this.write((database) => {
      database.exec("DELETE FROM novel_projection_cache");
      const updatedAt = this.options.clock.now();
      for (const entry of entries) {
        writeEntry(database, entry, rebuildRevision, updatedAt);
      }
    }, "replace", entries.length);
  }

  private async read<T>(query: (database: DatabaseSync) => T): Promise<T> {
    return this.withDatabase(false, (database) => {
      database.exec("BEGIN");
      try {
        const result = query(database);
        database.exec("COMMIT");
        return result;
      } catch (error) {
        try { database.exec("ROLLBACK"); } catch {}
        throw error;
      }
    });
  }

  private async write(
    mutation: (database: DatabaseSync) => void,
    operation: "put" | "delete" | "replace",
    entryCount: number,
  ): Promise<void> {
    await this.withDatabase(true, (database) => {
      database.exec("BEGIN IMMEDIATE");
      try {
        mutation(database);
        database.exec("COMMIT");
      } catch (error) {
        try { database.exec("ROLLBACK"); } catch {}
        throw error;
      }
    });
    this.logger.info("novel_projection_store.write.completed", {
      operation,
      entryCount,
    });
  }

  private async withDatabase<T>(
    writable: boolean,
    action: (database: DatabaseSync) => T,
  ): Promise<T> {
    let database: DatabaseSync | undefined;
    try {
      const path = this.databasePath();
      if (this.scope.kind === "draft") {
        initializeNovelDraftSqliteSchema(path, this.scope.session);
      }
      database = new DatabaseSync(path, writable ? {} : { readOnly: true });
      configure(database, writable);
      if (this.scope.kind === "canonical" && writable) {
        runNovelSqliteMigrations(database, this.options.clock);
      }
      assertIdentity(database, this.scope, this.novelId);
      return action(database);
    } catch (error) {
      if (error instanceof NovelInvariantViolationError) throw error;
      throw new NovelInvariantViolationError(
        NOVEL_INVARIANT_FAILURE.persistenceInvariant,
        this.novelId,
        this.scope.kind === "draft" ? this.scope.session.id : undefined,
      );
    } finally {
      try { database?.close(); } catch {}
    }
  }

  private databasePath(): string {
    return this.scope.kind === "canonical"
      ? this.options.location.canonicalDatabasePath
      : join(
          this.options.location.stagingDir,
          this.scope.session.ownerConversationId,
          this.scope.session.id,
          "draft.sqlite",
        );
  }

  private assertNovel(value: NovelId): void {
    if (captureNovelId(value) !== this.novelId) {
      throw mismatch(this.novelId, this.scope);
    }
  }
}

function writeEntry(
  database: DatabaseSync,
  entry: NovelProjectionCacheEntry,
  rebuildRevision: string,
  updatedAt: string,
): void {
  const targetJson = canonicalizeNovelProjectionTarget(entry.target);
  const projectionJson = canonicalJson(entry.projection);
  database.prepare(
    `INSERT INTO novel_projection_cache(
       projection_key, target_json, projection_json, projection_digest,
       rebuild_revision, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(projection_key) DO UPDATE SET
       target_json = excluded.target_json,
       projection_json = excluded.projection_json,
       projection_digest = excluded.projection_digest,
       rebuild_revision = excluded.rebuild_revision,
       updated_at = excluded.updated_at`,
  ).run(
    digest(targetJson),
    targetJson,
    projectionJson,
    digest(projectionJson),
    rebuildRevision,
    updatedAt,
  );
}

function captureRow(row: ProjectionRow): NovelProjectionCacheEntry {
  if (
    digest(row.target_json) !== row.projection_key ||
    digest(row.projection_json) !== row.projection_digest
  ) {
    throw new Error();
  }
  return captureNovelProjectionCacheEntry({
    target: JSON.parse(row.target_json),
    projection: JSON.parse(row.projection_json),
  });
}

function canonicalJson(value: unknown): string {
  return canonicalStringifyJson(
    JSON.parse(JSON.stringify(value)) as JsonObject,
  );
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function configure(database: DatabaseSync, writable: boolean): void {
  if (writable) {
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = FULL");
  }
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
}

function assertIdentity(
  database: DatabaseSync,
  scope: NovelReadScope,
  novelId: NovelId,
): void {
  if (scope.kind === "canonical") {
    const row = database.prepare(
      "SELECT novel_id FROM novel_metadata WHERE singleton = 1",
    ).get() as { novel_id: string } | undefined;
    if (row?.novel_id !== novelId) throw new Error();
    return;
  }
  const row = database.prepare(
    `SELECT draft_session_id, novel_id, owner_conversation_id, base_revision
     FROM draft_metadata WHERE singleton = 1`,
  ).get() as {
    draft_session_id: string;
    novel_id: string;
    owner_conversation_id: string;
    base_revision: string;
  } | undefined;
  if (
    row?.draft_session_id !== scope.session.id ||
    row.novel_id !== novelId ||
    row.owner_conversation_id !== scope.session.ownerConversationId ||
    row.base_revision !== scope.session.baseRevision
  ) {
    throw new Error();
  }
}

function mismatch(novelId: NovelId, scope: NovelReadScope): NovelInvariantViolationError {
  return new NovelInvariantViolationError(
    NOVEL_INVARIANT_FAILURE.novelIdentityMismatch,
    novelId,
    scope.kind === "draft" ? scope.session.id : undefined,
  );
}
