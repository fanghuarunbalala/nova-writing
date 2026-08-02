/** Hashes conflict evidence without exposing Character or Location content. */
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
    const table = entityType === "character"
      ? "novel_characters"
      : entityType === "location"
        ? "novel_locations"
        : undefined;
    if (table === undefined) {
      return digestNovelConflictText(
        canonicalStringifyJson({
          snapshotVersion: 1,
          entityType,
          entityId,
          state: "unsupported",
        }),
      );
    }
    const database = new DatabaseSync(this.databasePath(session), {
      readOnly: true,
    });
    try {
      const row = database
        .prepare(
          `SELECT id, name, aliases_json, summary, initial_state,
                  author_notes, entity_version, created_at, updated_at
           FROM ${table} WHERE id = ?`,
        )
        .get(entityId) as EntityRow | undefined;
      const snapshot: JsonObject = row === undefined
        ? {
            snapshotVersion: 1,
            entityType,
            entityId,
            state: "missing",
          }
        : {
            snapshotVersion: 1,
            entityType,
            entityId,
            state: "present",
            entity: {
              id: row.id,
              name: row.name,
              aliases: JSON.parse(row.aliases_json) as JsonValue,
              summary: row.summary,
              initialState: row.initial_state,
              authorNotes: row.author_notes,
              entityVersion: row.entity_version,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            },
          };
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

export function digestNovelConflictText(value: string): NovelConflictDigest {
  return captureNovelConflictDigest(
    `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`,
  );
}
