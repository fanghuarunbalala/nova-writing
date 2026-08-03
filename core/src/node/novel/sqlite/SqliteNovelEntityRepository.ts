/** SQLite Character/Location mutation context and explicit-scope query adapter. */
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  NOVEL_INVARIANT_FAILURE,
  NovelInvariantViolationError,
  canonicalNovelReadScope,
  captureCharacter,
  captureCharacterId,
  captureLocation,
  captureLocationId,
  captureNovelEntityVersion,
  captureNovelId,
  captureNovelReadScope,
  captureNovelTimestamp,
  type Character,
  type CharacterId,
  type Location,
  type LocationId,
  type NovelEntityMutationContext,
  type NovelEntityQueryStore,
  type NovelEntityVersion,
  type NovelId,
  type NovelMutableEntityRepository,
  type NovelReadScope,
} from "../../../novel/index.js";
import { canonicalStringifyJson } from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";

interface EntityRow {
  id: string;
  name: string;
  aliases_json: string;
  summary: string | null;
  initial_state: string | null;
  author_notes: string | null;
  entity_version: number;
  created_at: string;
  updated_at: string;
}

export function createSqliteNovelEntityMutationContext(
  database: DatabaseSync,
): NovelEntityMutationContext {
  return Object.freeze({
    characters: new SqliteEntityRepository(
      database,
      "novel_characters",
      captureCharacter,
      captureCharacterId,
    ),
    locations: new SqliteEntityRepository(
      database,
      "novel_locations",
      captureLocation,
      captureLocationId,
    ),
  });
}

export interface SqliteNovelEntityQueryStoreOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly logger?: Logger;
}

export class SqliteNovelEntityQueryStore implements NovelEntityQueryStore {
  private readonly logger: Logger;
  private readonly novelId: NovelId;

  constructor(private readonly options: SqliteNovelEntityQueryStoreOptions) {
    this.novelId = captureNovelId(options.novelId);
    this.logger = (options.logger ?? noopLogger).child({
      component: "sqlite_novel_entity_query_store",
      workspaceId: options.location.workspaceId,
      novelId: this.novelId,
    });
  }

  getCharacter(
    scope: NovelReadScope,
    id: CharacterId,
  ): Promise<Character | undefined> {
    const characterId = captureCharacterId(id);
    return this.read(scope, (database) =>
      readEntity<Character, CharacterId>(
        database,
        "novel_characters",
        characterId,
        captureCharacterId,
      ),
    ).then((value) =>
      value === undefined ? undefined : captureCharacter(value),
    );
  }

  listCharacters(scope: NovelReadScope): Promise<readonly Character[]> {
    return this.list(
      scope,
      "novel_characters",
      captureCharacter,
      captureCharacterId,
    );
  }

  getLocation(
    scope: NovelReadScope,
    id: LocationId,
  ): Promise<Location | undefined> {
    const locationId = captureLocationId(id);
    return this.read(scope, (database) =>
      readEntity<Location, LocationId>(
        database,
        "novel_locations",
        locationId,
        captureLocationId,
      ),
    ).then((value) =>
      value === undefined ? undefined : captureLocation(value),
    );
  }

  listLocations(scope: NovelReadScope): Promise<readonly Location[]> {
    return this.list(
      scope,
      "novel_locations",
      captureLocation,
      captureLocationId,
    );
  }

  private async read<T>(
    scope: NovelReadScope,
    query: (database: DatabaseSync) => T,
  ): Promise<T> {
    const capturedScope = captureNovelReadScope(scope);
    if (
      capturedScope.kind === "draft" &&
      capturedScope.session.novelId !== this.novelId
    ) {
      throw new NovelInvariantViolationError(
        NOVEL_INVARIANT_FAILURE.novelIdentityMismatch,
        this.novelId,
        capturedScope.session.id,
      );
    }
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(this.databasePath(capturedScope), {
        readOnly: true,
      });
      configure(database);
      assertReadIdentity(database, capturedScope, this.novelId);
      const result = query(database);
      this.logger.debug("novel_entity_query.completed", {
        scope: capturedScope.kind,
      });
      return result;
    } catch (error) {
      if (error instanceof NovelInvariantViolationError) throw error;
      throw new NovelInvariantViolationError(
        NOVEL_INVARIANT_FAILURE.persistenceInvariant,
        this.novelId,
        capturedScope.kind === "draft" ? capturedScope.session.id : undefined,
      );
    } finally {
      try {
        database?.close();
      } catch {}
    }
  }

  private async list<TEntity, TId>(
    scope: NovelReadScope,
    table: EntityTable,
    captureEntity: (value: TEntity) => TEntity,
    captureId: (value: unknown) => TId,
  ): Promise<readonly TEntity[]> {
    return this.read(scope, (database) => {
      const rows = database
        .prepare(`${ENTITY_SELECT} FROM ${table} ORDER BY name, id`)
        .all() as unknown as EntityRow[];
      return Object.freeze(
        rows.map((row) =>
          captureEntity(decodeEntity(row, captureId) as TEntity),
        ),
      );
    });
  }

  private databasePath(scope: NovelReadScope): string {
    if (scope === canonicalNovelReadScope || scope.kind === "canonical") {
      return this.options.location.canonicalDatabasePath;
    }
    return join(
      this.options.location.stagingDir,
      scope.session.ownerConversationId,
      scope.session.id,
      "draft.sqlite",
    );
  }
}

type EntityTable = "novel_characters" | "novel_locations";

class SqliteEntityRepository<TEntity, TId>
  implements NovelMutableEntityRepository<TEntity, TId>
{
  constructor(
    private readonly database: DatabaseSync,
    private readonly table: EntityTable,
    private readonly captureEntity: (value: TEntity) => TEntity,
    private readonly captureId: (value: unknown) => TId,
  ) {}

  get(id: TId): TEntity | undefined {
    const value = readEntity<TEntity, TId>(
      this.database,
      this.table,
      id,
      this.captureId,
    );
    return value === undefined
      ? undefined
      : this.captureEntity(value);
  }

  list(): readonly TEntity[] {
    const rows = this.database
      .prepare(`${ENTITY_SELECT} FROM ${this.table} ORDER BY id`)
      .all() as unknown as EntityRow[];
    return Object.freeze(rows.map((row) =>
      this.captureEntity(decodeEntity(row, this.captureId) as TEntity)
    ));
  }

  insert(entity: TEntity): boolean {
    const value = this.captureEntity(entity) as Character | Location;
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO ${this.table}(
           id, name, aliases_json, summary, initial_state, author_notes,
           entity_version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...encodeEntity(value));
    return Number(result.changes) === 1;
  }

  replace(entity: TEntity, expectedVersion: NovelEntityVersion): boolean {
    const value = this.captureEntity(entity) as Character | Location;
    const expected = captureNovelEntityVersion(expectedVersion);
    const encoded = encodeEntity(value);
    const result = this.database
      .prepare(
        `UPDATE ${this.table}
         SET name = ?, aliases_json = ?, summary = ?, initial_state = ?,
             author_notes = ?, entity_version = ?, created_at = ?, updated_at = ?
         WHERE id = ? AND entity_version = ?`,
      )
      .run(
        encoded[1],
        encoded[2],
        encoded[3],
        encoded[4],
        encoded[5],
        encoded[6],
        encoded[7],
        encoded[8],
        encoded[0],
        expected,
      );
    return Number(result.changes) === 1;
  }

  delete(id: TId, expectedVersion: NovelEntityVersion): boolean {
    const result = this.database
      .prepare(`DELETE FROM ${this.table} WHERE id = ? AND entity_version = ?`)
      .run(id as string, captureNovelEntityVersion(expectedVersion));
    return Number(result.changes) === 1;
  }
}

const ENTITY_SELECT = `SELECT id, name, aliases_json, summary, initial_state,
  author_notes, entity_version, created_at, updated_at`;

function readEntity<TEntity, TId>(
  database: DatabaseSync,
  table: EntityTable,
  id: TId,
  captureId: (value: unknown) => TId,
): TEntity | undefined {
  const row = database
    .prepare(`${ENTITY_SELECT} FROM ${table} WHERE id = ?`)
    .get(id as string) as EntityRow | undefined;
  return row === undefined
    ? undefined
    : (decodeEntity(row, captureId) as TEntity);
}

function encodeEntity(value: Character | Location): readonly SQLInputValue[] {
  return [
    value.id,
    value.name,
    canonicalStringifyJson([...value.aliases]),
    value.summary ?? null,
    value.initialState ?? null,
    value.authorNotes ?? null,
    value.entityVersion,
    value.createdAt,
    value.updatedAt,
  ];
}

function decodeEntity<TId>(row: EntityRow, captureId: (value: unknown) => TId) {
  const aliases = JSON.parse(row.aliases_json) as unknown;
  if (!Array.isArray(aliases)) throw new Error();
  return {
    id: captureId(row.id),
    name: row.name,
    aliases,
    ...(row.summary === null ? {} : { summary: row.summary }),
    ...(row.initial_state === null ? {} : { initialState: row.initial_state }),
    ...(row.author_notes === null ? {} : { authorNotes: row.author_notes }),
    entityVersion: captureNovelEntityVersion(row.entity_version),
    createdAt: captureNovelTimestamp(row.created_at),
    updatedAt: captureNovelTimestamp(row.updated_at),
  };
}

function configure(database: DatabaseSync): void {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
}

function assertReadIdentity(
  database: DatabaseSync,
  scope: NovelReadScope,
  novelId: NovelId,
): void {
  if (scope.kind === "canonical") {
    const metadata = database
      .prepare("SELECT novel_id FROM novel_metadata WHERE singleton = 1")
      .get() as { novel_id: string } | undefined;
    if (metadata?.novel_id !== novelId) throw new Error();
    return;
  }

  const hasDraftMetadata = database
    .prepare(
      `SELECT 1 AS present FROM sqlite_schema
       WHERE type = 'table' AND name = 'draft_metadata'`,
    )
    .get() as { present: number } | undefined;
  if (hasDraftMetadata === undefined) {
    const snapshotMetadata = database
      .prepare(
        `SELECT novel_id, current_revision
         FROM novel_metadata WHERE singleton = 1`,
      )
      .get() as
      | { novel_id: string; current_revision: string }
      | undefined;
    if (
      snapshotMetadata?.novel_id !== scope.session.novelId ||
      snapshotMetadata.current_revision !== scope.session.baseRevision
    ) {
      throw new Error();
    }
    return;
  }

  const metadata = database
    .prepare(
      `SELECT draft_session_id, novel_id, owner_conversation_id, base_revision
       FROM draft_metadata WHERE singleton = 1`,
    )
    .get() as
    | {
        draft_session_id: string;
        novel_id: string;
        owner_conversation_id: string;
        base_revision: string;
      }
    | undefined;
  if (
    metadata?.draft_session_id !== scope.session.id ||
    metadata.novel_id !== scope.session.novelId ||
    metadata.owner_conversation_id !== scope.session.ownerConversationId ||
    metadata.base_revision !== scope.session.baseRevision
  ) {
    throw new Error();
  }
}
