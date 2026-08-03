/** Hashes entity and Story Outline conflict evidence without exposing content. */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import {
  canonicalStringifyJson,
  type JsonObject,
  type JsonValue,
} from "../../../event/index.js";
import {
  NOVEL_INVARIANT_FAILURE,
  NovelInvariantViolationError,
  canonicalizeNovelConflict,
  captureNovelConflictDigest,
  captureNovelDraftSession,
  captureNovelOperation,
  captureNovelOperationId,
  captureNovelOperationVersion,
  type NovelConflict,
  type NovelConflictDigest,
  type NovelConflictDigester,
  type NovelDraftSession,
  type NovelId,
  type NovelOperationPrecondition,
} from "../../../novel/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";

export interface NodeSha256NovelConflictDigesterOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
}

export class NodeSha256NovelConflictDigester
  implements NovelConflictDigester
{
  constructor(private readonly options: NodeSha256NovelConflictDigesterOptions) {}

  async digestPrecondition(
    precondition: NovelOperationPrecondition,
  ): Promise<NovelConflictDigest> {
    const captured = captureNovelOperation({
      operationId: captureNovelOperationId("operation_conflict_digest"),
      operationVersion: captureNovelOperationVersion(1),
      type: "conflict.snapshot",
      expected: [precondition],
      payload: {},
    }).expected[0];
    if (captured === undefined) throw new TypeError();
    return digestNovelConflictText(
      canonicalStringifyJson({
        snapshotVersion: 1,
        kind: "operation-precondition",
        precondition: { ...captured },
      }),
    );
  }

  async digestEntitySnapshot(
    sessionInput: NovelDraftSession,
    entityType: string,
    entityId: string,
  ): Promise<NovelConflictDigest> {
    const session = captureNovelDraftSession(sessionInput);
    if (session.novelId !== this.options.novelId) throw new TypeError();
    const database = new DatabaseSync(this.databasePath(session), {
      readOnly: true,
    });
    try {
      const snapshot = readSnapshot(database, entityType, entityId);
      return digestNovelConflictText(canonicalStringifyJson(snapshot));
    } catch {
      throw new NovelInvariantViolationError(
        NOVEL_INVARIANT_FAILURE.persistenceInvariant,
        session.novelId,
        session.id,
      );
    } finally {
      database.close();
    }
  }

  async digestConflict(
    conflict: NovelConflict,
  ): Promise<NovelConflictDigest> {
    return digestNovelConflictText(canonicalizeNovelConflict(conflict));
  }

  private databasePath(session: NovelDraftSession): string {
    return join(
      this.options.location.stagingDir,
      session.ownerConversationId,
      session.id,
      "draft.sqlite",
    );
  }
}

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

interface StoryUnitRow {
  id: string;
  outline_id: string;
  parent_id: string | null;
  order_key: string;
  content_json: string;
  content_digest: string;
  parent_digest: string;
  order_digest: string;
}

function readSnapshot(
  database: DatabaseSync,
  entityType: string,
  entityId: string,
): JsonObject {
  if (entityType === "character" || entityType === "location") {
    return readProfileSnapshot(database, entityType, entityId);
  }
  if (entityType === "story-outline") {
    const row = database
      .prepare("SELECT id, novel_id FROM novel_story_outlines WHERE id = ?")
      .get(entityId) as { id: string; novel_id: string } | undefined;
    return row === undefined
      ? missingSnapshot(entityType, entityId)
      : presentSnapshot(entityType, entityId, {
          id: row.id,
          novelId: row.novel_id,
        });
  }
  if (entityType === "story-unit") {
    const row = database
      .prepare(
        `SELECT id, outline_id, parent_id, order_key, content_json,
                content_digest, parent_digest, order_digest
         FROM novel_story_units WHERE id = ?`,
      )
      .get(entityId) as StoryUnitRow | undefined;
    return row === undefined
      ? missingSnapshot(entityType, entityId)
      : presentSnapshot(entityType, entityId, {
          id: row.id,
          outlineId: row.outline_id,
          parentId: row.parent_id,
          orderKey: row.order_key,
          content: JSON.parse(row.content_json) as JsonValue,
          contentDigest: row.content_digest,
          parentDigest: row.parent_digest,
          orderDigest: row.order_digest,
        });
  }
  if (entityType === "leaf-story-unit-plan") {
    const row = database
      .prepare(
        `SELECT story_unit_id, plan_json, plan_digest
         FROM novel_leaf_story_unit_plans WHERE story_unit_id = ?`,
      )
      .get(entityId) as
      | { story_unit_id: string; plan_json: string; plan_digest: string }
      | undefined;
    return row === undefined
      ? missingSnapshot(entityType, entityId)
      : presentSnapshot(entityType, entityId, {
          storyUnitId: row.story_unit_id,
          plan: JSON.parse(row.plan_json) as JsonValue,
          planDigest: row.plan_digest,
        });
  }
  if (entityType === "story-entity") {
    const character = readProfileEntity(database, "character", entityId);
    const location = readProfileEntity(database, "location", entityId);
    return character === undefined && location === undefined
      ? missingSnapshot(entityType, entityId)
      : presentSnapshot(entityType, entityId, {
          character: character ?? null,
          location: location ?? null,
        });
  }
  return {
    snapshotVersion: 1,
    entityType,
    entityId,
    state: "unsupported",
  };
}

function readProfileSnapshot(
  database: DatabaseSync,
  entityType: "character" | "location",
  entityId: string,
): JsonObject {
  const entity = readProfileEntity(database, entityType, entityId);
  return entity === undefined
    ? missingSnapshot(entityType, entityId)
    : presentSnapshot(entityType, entityId, entity);
}

function readProfileEntity(
  database: DatabaseSync,
  entityType: "character" | "location",
  entityId: string,
): JsonObject | undefined {
  const table = entityType === "character"
    ? "novel_characters"
    : "novel_locations";
  const row = database
    .prepare(
      `SELECT id, name, aliases_json, summary, initial_state,
              author_notes, entity_version, created_at, updated_at
       FROM ${table} WHERE id = ?`,
    )
    .get(entityId) as EntityRow | undefined;
  return row === undefined
    ? undefined
    : {
        id: row.id,
        name: row.name,
        aliases: JSON.parse(row.aliases_json) as JsonValue,
        summary: row.summary,
        initialState: row.initial_state,
        authorNotes: row.author_notes,
        entityVersion: row.entity_version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
}

function missingSnapshot(entityType: string, entityId: string): JsonObject {
  return {
    snapshotVersion: 1,
    entityType,
    entityId,
    state: "missing",
  };
}

function presentSnapshot(
  entityType: string,
  entityId: string,
  entity: JsonObject,
): JsonObject {
  return {
    snapshotVersion: 1,
    entityType,
    entityId,
    state: "present",
    entity,
  };
}

export function digestNovelConflictText(value: string): NovelConflictDigest {
  return captureNovelConflictDigest(
    `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`,
  );
}
