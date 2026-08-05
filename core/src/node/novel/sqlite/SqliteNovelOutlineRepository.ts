/** SQLite transaction-local Outline repository and combined Novel mutation context. */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { canonicalStringifyJson } from "../../../event/index.js";
import {
  captureLeafStoryUnitPlan,
  captureNovelId,
  captureOrderKey,
  captureStoryOutline,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitContent,
  captureStoryUnitId,
  type CharacterId,
  type LeafStoryUnitPlan,
  type LocationId,
  type NovelId,
  type NovelMutableOutlineRepository,
  type NovelMutationContext,
  type NovelOutlineMutationContext,
  type OrderKey,
  type StoryEntityId,
  type StoryOutline,
  type StoryOutlineId,
  type StoryUnit,
  type StoryUnitDigestField,
  type StoryUnitId,
} from "../../../novel/index.js";
import { createSqliteNovelEntityMutationContext } from "./SqliteNovelEntityRepository.js";
import { createSqliteNovelParagraphMutationContext } from "./SqliteNovelParagraphRepository.js";
import { createSqliteNovelPublicationMutationContext } from "./SqliteNovelPublicationRepository.js";
import { createSqliteNovelProjectionEvidenceMutationContext } from "./SqliteNovelProjectionEvidenceRepository.js";

interface OutlineRow {
  id: string;
  novel_id: string;
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

interface LeafPlanRow {
  story_unit_id: string;
  plan_json: string;
  plan_digest: string;
}

const STORY_UNIT_SELECT = `SELECT id, outline_id, parent_id, order_key,
  content_json, content_digest, parent_digest, order_digest`;

export function createSqliteNovelOutlineMutationContext(
  database: DatabaseSync,
): NovelOutlineMutationContext {
  return Object.freeze({
    outline: new SqliteNovelOutlineRepository(database),
  });
}

export function createSqliteNovelMutationContext(
  database: DatabaseSync,
): NovelMutationContext {
  return Object.freeze({
    ...createSqliteNovelEntityMutationContext(database),
    ...createSqliteNovelOutlineMutationContext(database),
    ...createSqliteNovelPublicationMutationContext(database),
    ...createSqliteNovelParagraphMutationContext(database),
    ...createSqliteNovelProjectionEvidenceMutationContext(database),
  });
}

export class SqliteNovelOutlineRepository
  implements NovelMutableOutlineRepository
{
  constructor(private readonly database: DatabaseSync) {}

  getOutline(id: StoryOutlineId): StoryOutline | undefined {
    const row = this.database
      .prepare("SELECT id, novel_id FROM novel_story_outlines WHERE id = ?")
      .get(captureStoryOutlineId(id)) as OutlineRow | undefined;
    return row === undefined ? undefined : decodeOutline(row);
  }

  findOutlineByNovelId(novelId: NovelId): StoryOutline | undefined {
    const row = this.database
      .prepare("SELECT id, novel_id FROM novel_story_outlines WHERE novel_id = ?")
      .get(captureNovelId(novelId)) as OutlineRow | undefined;
    return row === undefined ? undefined : decodeOutline(row);
  }

  insertOutline(outline: StoryOutline): boolean {
    const value = captureStoryOutline(outline);
    const result = this.database
      .prepare(
        "INSERT OR IGNORE INTO novel_story_outlines(id, novel_id) VALUES (?, ?)",
      )
      .run(value.id, value.novelId);
    return Number(result.changes) === 1;
  }

  getStoryUnit(id: StoryUnitId): StoryUnit | undefined {
    const row = this.database
      .prepare(`${STORY_UNIT_SELECT} FROM novel_story_units WHERE id = ?`)
      .get(captureStoryUnitId(id)) as StoryUnitRow | undefined;
    return row === undefined ? undefined : decodeStoryUnit(row);
  }

  listStoryUnits(outlineId: StoryOutlineId): readonly StoryUnit[] {
    const rows = this.database
      .prepare(
        `${STORY_UNIT_SELECT} FROM novel_story_units
         WHERE outline_id = ? ORDER BY parent_id, order_key, id`,
      )
      .all(captureStoryOutlineId(outlineId)) as unknown as StoryUnitRow[];
    return Object.freeze(rows.map(decodeStoryUnit));
  }

  listStoryUnitChildren(parentId: StoryUnitId): readonly StoryUnit[] {
    const rows = this.database
      .prepare(
        `${STORY_UNIT_SELECT} FROM novel_story_units
         WHERE parent_id = ? ORDER BY order_key, id`,
      )
      .all(captureStoryUnitId(parentId)) as unknown as StoryUnitRow[];
    return Object.freeze(rows.map(decodeStoryUnit));
  }

  findStoryUnitAt(
    outlineId: StoryOutlineId,
    parentId: StoryUnitId | undefined,
    orderKey: OrderKey,
  ): StoryUnit | undefined {
    const outline = captureStoryOutlineId(outlineId);
    const parent = parentId === undefined ? null : captureStoryUnitId(parentId);
    const order = captureOrderKey(orderKey);
    const row = this.database
      .prepare(
        `${STORY_UNIT_SELECT} FROM novel_story_units
         WHERE outline_id = ? AND order_key = ?
           AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)
         LIMIT 1`,
      )
      .get(outline, order, parent, parent) as StoryUnitRow | undefined;
    return row === undefined ? undefined : decodeStoryUnit(row);
  }

  isStoryUnitDescendant(
    ancestorId: StoryUnitId,
    candidateDescendantId: StoryUnitId,
  ): boolean {
    const row = this.database
      .prepare(
        `WITH RECURSIVE descendants(id) AS (
           SELECT id FROM novel_story_units WHERE parent_id = ?
           UNION ALL
           SELECT unit.id
           FROM novel_story_units AS unit
           JOIN descendants ON unit.parent_id = descendants.id
         )
         SELECT 1 AS present FROM descendants WHERE id = ? LIMIT 1`,
      )
      .get(
        captureStoryUnitId(ancestorId),
        captureStoryUnitId(candidateDescendantId),
      ) as { present: number } | undefined;
    return row !== undefined;
  }

  getStoryUnitDigest(
    id: StoryUnitId,
    field: StoryUnitDigestField,
  ): string | undefined {
    const column = field === "content"
      ? "content_digest"
      : field === "parentId"
        ? "parent_digest"
        : "order_digest";
    const row = this.database
      .prepare(`SELECT ${column} AS digest FROM novel_story_units WHERE id = ?`)
      .get(captureStoryUnitId(id)) as { digest: string } | undefined;
    return row?.digest;
  }

  insertStoryUnit(unit: StoryUnit): boolean {
    const encoded = encodeStoryUnit(unit);
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO novel_story_units(
           id, outline_id, parent_id, order_key, content_json,
           content_digest, parent_digest, order_digest
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...encoded);
    return Number(result.changes) === 1;
  }

  replaceStoryUnit(unit: StoryUnit): boolean {
    const encoded = encodeStoryUnit(unit);
    const result = this.database
      .prepare(
        `UPDATE novel_story_units
         SET outline_id = ?, parent_id = ?, order_key = ?, content_json = ?,
             content_digest = ?, parent_digest = ?, order_digest = ?
         WHERE id = ?`,
      )
      .run(
        encoded[1],
        encoded[2],
        encoded[3],
        encoded[4],
        encoded[5],
        encoded[6],
        encoded[7],
        encoded[0],
      );
    return Number(result.changes) === 1;
  }

  deleteStoryUnit(id: StoryUnitId): boolean {
    const result = this.database
      .prepare("DELETE FROM novel_story_units WHERE id = ?")
      .run(captureStoryUnitId(id));
    return Number(result.changes) === 1;
  }

  getLeafStoryUnitPlan(id: StoryUnitId): LeafStoryUnitPlan | undefined {
    const row = this.database
      .prepare(
        `SELECT story_unit_id, plan_json, plan_digest
         FROM novel_leaf_story_unit_plans WHERE story_unit_id = ?`,
      )
      .get(captureStoryUnitId(id)) as LeafPlanRow | undefined;
    return row === undefined ? undefined : decodeLeafPlan(row);
  }

  getLeafStoryUnitPlanDigest(id: StoryUnitId): string | undefined {
    const row = this.database
      .prepare(
        "SELECT plan_digest FROM novel_leaf_story_unit_plans WHERE story_unit_id = ?",
      )
      .get(captureStoryUnitId(id)) as { plan_digest: string } | undefined;
    return row?.plan_digest;
  }

  replaceLeafStoryUnitPlan(plan: LeafStoryUnitPlan): boolean {
    const value = captureLeafStoryUnitPlan(plan);
    const planJson = canonicalStringifyJson(value as never);
    const result = this.database
      .prepare(
        `INSERT INTO novel_leaf_story_unit_plans(
           story_unit_id, plan_json, plan_digest
         ) VALUES (?, ?, ?)
         ON CONFLICT(story_unit_id) DO UPDATE SET
           plan_json = excluded.plan_json,
           plan_digest = excluded.plan_digest`,
      )
      .run(value.storyUnitId, planJson, digest(planJson));
    return Number(result.changes) === 1;
  }

  clearLeafStoryUnitPlan(id: StoryUnitId): boolean {
    const result = this.database
      .prepare("DELETE FROM novel_leaf_story_unit_plans WHERE story_unit_id = ?")
      .run(captureStoryUnitId(id));
    return Number(result.changes) === 1;
  }

  hasCharacter(id: CharacterId): boolean {
    return hasEntity(this.database, "novel_characters", id);
  }

  hasLocation(id: LocationId): boolean {
    return hasEntity(this.database, "novel_locations", id);
  }

  hasStoryEntity(id: StoryEntityId): boolean {
    return this.hasCharacter(id as CharacterId) || this.hasLocation(id as LocationId);
  }
}

function decodeOutline(row: OutlineRow): StoryOutline {
  return captureStoryOutline({
    id: row.id,
    novelId: row.novel_id,
  });
}

function decodeStoryUnit(row: StoryUnitRow): StoryUnit {
  const unit = captureStoryUnit({
    id: row.id,
    outlineId: row.outline_id,
    ...(row.parent_id === null ? {} : { parentId: row.parent_id }),
    orderKey: row.order_key,
    ...captureStoryUnitContent(parseJson(row.content_json)),
  });
  const encoded = encodeStoryUnit(unit);
  if (
    encoded[4] !== row.content_json ||
    encoded[5] !== row.content_digest ||
    encoded[6] !== row.parent_digest ||
    encoded[7] !== row.order_digest
  ) {
    throw new Error();
  }
  return unit;
}

function decodeLeafPlan(row: LeafPlanRow): LeafStoryUnitPlan {
  const plan = captureLeafStoryUnitPlan(parseJson(row.plan_json));
  if (
    plan.storyUnitId !== captureStoryUnitId(row.story_unit_id) ||
    digest(row.plan_json) !== row.plan_digest
  ) {
    throw new Error();
  }
  return plan;
}

function encodeStoryUnit(unit: StoryUnit): readonly [
  string,
  string,
  string | null,
  string,
  string,
  string,
  string,
  string,
] {
  const value = captureStoryUnit(unit);
  const content = captureStoryUnitContent({
    title: value.title,
    intent: value.intent,
    synopsis: value.synopsis,
    scope: value.scope,
    planningStatus: value.planningStatus,
    realizationStatus: value.realizationStatus,
    blockState: value.blockState,
    abandonment: value.abandonment,
  });
  const contentJson = canonicalStringifyJson(content as never);
  return [
    value.id,
    value.outlineId,
    value.parentId ?? null,
    value.orderKey,
    contentJson,
    digest(contentJson),
    digest(canonicalStringifyJson({ parentId: value.parentId ?? null })),
    digest(canonicalStringifyJson({ orderKey: value.orderKey })),
  ];
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function digest(canonicalJson: string): string {
  return createHash("sha256").update(canonicalJson).digest("hex");
}

function hasEntity(
  database: DatabaseSync,
  table: "novel_characters" | "novel_locations",
  id: string,
): boolean {
  const row = database
    .prepare(`SELECT 1 AS present FROM ${table} WHERE id = ? LIMIT 1`)
    .get(id) as { present: number } | undefined;
  return row !== undefined;
}
