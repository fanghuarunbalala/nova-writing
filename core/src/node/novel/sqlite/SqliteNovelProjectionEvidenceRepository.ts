/** SQLite-backed authoritative evidence repository for Projection rebuilds. */
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { canonicalStringifyJson } from "../../../event/index.js";
import {
  captureCharacterId,
  captureLocationId,
  captureStoryEntityId,
  captureStoryUnitCharacterBinding,
  captureStoryUnitEntityChange,
  captureStoryUnitEntityChangeId,
  captureStoryUnitId,
  captureStoryUnitLocationBinding,
  captureStoryUnitRealization,
  type NovelMutableProjectionEvidenceRepository,
  type NovelProjectionEvidenceMutationContext,
  type StoryUnitCharacterBinding,
  type StoryUnitEntityChange,
  type StoryUnitLocationBinding,
  type StoryUnitRealization,
} from "../../../novel/index.js";

interface EvidenceRow {
  readonly value_json: string;
  readonly value_digest: string;
}

export function createSqliteNovelProjectionEvidenceMutationContext(
  database: DatabaseSync,
): NovelProjectionEvidenceMutationContext {
  return Object.freeze({
    projectionEvidence: new SqliteNovelProjectionEvidenceRepository(database),
  });
}

export class SqliteNovelProjectionEvidenceRepository
  implements NovelMutableProjectionEvidenceRepository
{
  constructor(private readonly database: DatabaseSync) {}

  listCharacterBindings(): readonly StoryUnitCharacterBinding[] {
    return this.readAll(
      `SELECT binding_json AS value_json, binding_digest AS value_digest
       FROM novel_story_unit_character_bindings
       ORDER BY story_unit_id, character_id`,
      captureStoryUnitCharacterBinding,
    );
  }

  getCharacterBinding(storyUnitId: StoryUnitCharacterBinding["storyUnitId"], characterId: StoryUnitCharacterBinding["characterId"]) {
    return this.readOne(
      `SELECT binding_json AS value_json, binding_digest AS value_digest
       FROM novel_story_unit_character_bindings WHERE story_unit_id = ? AND character_id = ?`,
      captureStoryUnitCharacterBinding,
      captureStoryUnitId(storyUnitId),
      captureCharacterId(characterId),
    );
  }

  getCharacterBindingDigest(storyUnitId: StoryUnitCharacterBinding["storyUnitId"], characterId: StoryUnitCharacterBinding["characterId"]) {
    return this.readDigest(
      "SELECT binding_digest AS value_digest FROM novel_story_unit_character_bindings WHERE story_unit_id = ? AND character_id = ?",
      captureStoryUnitId(storyUnitId),
      captureCharacterId(characterId),
    );
  }

  putCharacterBinding(binding: StoryUnitCharacterBinding): void {
    const value = captureStoryUnitCharacterBinding(binding);
    this.put(
      `INSERT INTO novel_story_unit_character_bindings(
         story_unit_id, character_id, binding_json, binding_digest
       ) VALUES (?, ?, ?, ?)
       ON CONFLICT(story_unit_id, character_id) DO UPDATE SET
         binding_json = excluded.binding_json,
         binding_digest = excluded.binding_digest`,
      [value.storyUnitId, value.characterId],
      value,
    );
  }

  deleteCharacterBinding(
    storyUnitId: StoryUnitCharacterBinding["storyUnitId"],
    characterId: StoryUnitCharacterBinding["characterId"],
  ): boolean {
    return this.delete(
      `DELETE FROM novel_story_unit_character_bindings
       WHERE story_unit_id = ? AND character_id = ?`,
      captureStoryUnitId(storyUnitId),
      captureCharacterId(characterId),
    );
  }

  listLocationBindings(): readonly StoryUnitLocationBinding[] {
    return this.readAll(
      `SELECT binding_json AS value_json, binding_digest AS value_digest
       FROM novel_story_unit_location_bindings
       ORDER BY story_unit_id, location_id`,
      captureStoryUnitLocationBinding,
    );
  }

  getLocationBinding(storyUnitId: StoryUnitLocationBinding["storyUnitId"], locationId: StoryUnitLocationBinding["locationId"]) {
    return this.readOne(
      `SELECT binding_json AS value_json, binding_digest AS value_digest
       FROM novel_story_unit_location_bindings WHERE story_unit_id = ? AND location_id = ?`,
      captureStoryUnitLocationBinding,
      captureStoryUnitId(storyUnitId),
      captureLocationId(locationId),
    );
  }

  getLocationBindingDigest(storyUnitId: StoryUnitLocationBinding["storyUnitId"], locationId: StoryUnitLocationBinding["locationId"]) {
    return this.readDigest(
      "SELECT binding_digest AS value_digest FROM novel_story_unit_location_bindings WHERE story_unit_id = ? AND location_id = ?",
      captureStoryUnitId(storyUnitId),
      captureLocationId(locationId),
    );
  }

  putLocationBinding(binding: StoryUnitLocationBinding): void {
    const value = captureStoryUnitLocationBinding(binding);
    this.put(
      `INSERT INTO novel_story_unit_location_bindings(
         story_unit_id, location_id, binding_json, binding_digest
       ) VALUES (?, ?, ?, ?)
       ON CONFLICT(story_unit_id, location_id) DO UPDATE SET
         binding_json = excluded.binding_json,
         binding_digest = excluded.binding_digest`,
      [value.storyUnitId, value.locationId],
      value,
    );
  }

  deleteLocationBinding(
    storyUnitId: StoryUnitLocationBinding["storyUnitId"],
    locationId: StoryUnitLocationBinding["locationId"],
  ): boolean {
    return this.delete(
      "DELETE FROM novel_story_unit_location_bindings WHERE story_unit_id = ? AND location_id = ?",
      captureStoryUnitId(storyUnitId),
      captureLocationId(locationId),
    );
  }

  listEntityChanges(): readonly StoryUnitEntityChange[] {
    return this.readAll(
      `SELECT change_json AS value_json, change_digest AS value_digest
       FROM novel_story_unit_entity_changes ORDER BY story_unit_id, id`,
      captureStoryUnitEntityChange,
    );
  }

  getEntityChange(id: StoryUnitEntityChange["id"]) {
    return this.readOne(
      "SELECT change_json AS value_json, change_digest AS value_digest FROM novel_story_unit_entity_changes WHERE id = ?",
      captureStoryUnitEntityChange,
      captureStoryUnitEntityChangeId(id),
    );
  }

  getEntityChangeDigest(id: StoryUnitEntityChange["id"]) {
    return this.readDigest(
      "SELECT change_digest AS value_digest FROM novel_story_unit_entity_changes WHERE id = ?",
      captureStoryUnitEntityChangeId(id),
    );
  }

  putEntityChange(change: StoryUnitEntityChange): void {
    const value = captureStoryUnitEntityChange(change);
    this.assertEntityExists(value.entityId);
    if (value.relatedEntityId !== undefined) {
      this.assertEntityExists(value.relatedEntityId);
    }
    this.put(
      `INSERT INTO novel_story_unit_entity_changes(
         id, story_unit_id, change_json, change_digest
       ) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         story_unit_id = excluded.story_unit_id,
         change_json = excluded.change_json,
         change_digest = excluded.change_digest`,
      [value.id, value.storyUnitId],
      value,
    );
  }

  deleteEntityChange(id: StoryUnitEntityChange["id"]): boolean {
    return this.delete(
      "DELETE FROM novel_story_unit_entity_changes WHERE id = ?",
      captureStoryUnitEntityChangeId(id),
    );
  }

  listRealizations(): readonly StoryUnitRealization[] {
    return this.readAll(
      `SELECT realization_json AS value_json, realization_digest AS value_digest
       FROM novel_story_unit_realizations ORDER BY story_unit_id`,
      captureStoryUnitRealization,
    );
  }

  getRealization(storyUnitId: StoryUnitRealization["storyUnitId"]) {
    return this.readOne(
      "SELECT realization_json AS value_json, realization_digest AS value_digest FROM novel_story_unit_realizations WHERE story_unit_id = ?",
      captureStoryUnitRealization,
      captureStoryUnitId(storyUnitId),
    );
  }

  getRealizationDigest(storyUnitId: StoryUnitRealization["storyUnitId"]) {
    return this.readDigest(
      "SELECT realization_digest AS value_digest FROM novel_story_unit_realizations WHERE story_unit_id = ?",
      captureStoryUnitId(storyUnitId),
    );
  }

  putRealization(realization: StoryUnitRealization): void {
    const value = captureStoryUnitRealization(realization);
    this.put(
      `INSERT INTO novel_story_unit_realizations(
         story_unit_id, realization_json, realization_digest
       ) VALUES (?, ?, ?)
       ON CONFLICT(story_unit_id) DO UPDATE SET
         realization_json = excluded.realization_json,
         realization_digest = excluded.realization_digest`,
      [value.storyUnitId],
      value,
    );
  }

  deleteRealization(storyUnitId: StoryUnitRealization["storyUnitId"]): boolean {
    return this.delete(
      "DELETE FROM novel_story_unit_realizations WHERE story_unit_id = ?",
      captureStoryUnitId(storyUnitId),
    );
  }

  hasStoryUnit(storyUnitId: StoryUnitRealization["storyUnitId"]): boolean {
    return this.exists("novel_story_units", "id", captureStoryUnitId(storyUnitId));
  }

  hasCharacter(characterId: StoryUnitCharacterBinding["characterId"]): boolean {
    return this.exists("novel_characters", "id", captureCharacterId(characterId));
  }

  hasLocation(locationId: StoryUnitLocationBinding["locationId"]): boolean {
    return this.exists("novel_locations", "id", captureLocationId(locationId));
  }

  private readAll<T>(
    sql: string,
    capture: (value: unknown) => T,
  ): readonly T[] {
    const rows = this.database.prepare(sql).all() as unknown as EvidenceRow[];
    return Object.freeze(rows.map((row) => decode(row, capture)));
  }

  private readOne<T>(sql: string, capture: (value: unknown) => T, ...identity: readonly string[]): T | undefined {
    const row = this.database.prepare(sql).get(...identity) as EvidenceRow | undefined;
    return row === undefined ? undefined : decode(row, capture);
  }

  private readDigest(sql: string, ...identity: readonly string[]): string | undefined {
    const row = this.database.prepare(sql).get(...identity) as { value_digest: string } | undefined;
    return row?.value_digest;
  }

  private exists(table: string, column: string, identity: string): boolean {
    return this.database.prepare(
      `SELECT 1 AS present FROM ${table} WHERE ${column} = ? LIMIT 1`,
    ).get(identity) !== undefined;
  }

  private put(sql: string, identity: readonly string[], value: object): void {
    const canonical = canonicalStringifyJson(value as never);
    this.database.prepare(sql).run(...identity, canonical, digest(canonical));
  }

  private delete(sql: string, ...identity: readonly string[]): boolean {
    return Number(this.database.prepare(sql).run(...identity).changes) === 1;
  }

  private assertEntityExists(entityIdInput: string): void {
    const entityId = captureStoryEntityId(entityIdInput);
    const row = this.database.prepare(
      `SELECT 1 AS present FROM novel_characters WHERE id = ?
       UNION ALL
       SELECT 1 AS present FROM novel_locations WHERE id = ?
       LIMIT 1`,
    ).get(entityId, entityId) as { present: number } | undefined;
    if (row === undefined) throw new Error();
  }
}

function decode<T>(row: EvidenceRow, capture: (value: unknown) => T): T {
  if (digest(row.value_json) !== row.value_digest) throw new Error();
  const value = capture(JSON.parse(row.value_json) as unknown);
  if (canonicalStringifyJson(value as never) !== row.value_json) throw new Error();
  return value;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
