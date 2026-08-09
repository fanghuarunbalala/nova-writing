/** Serializable Novel query operations and strict request capture for every client Transport. */
import {
  captureCharacterId,
  captureLocationId,
  captureParagraphId,
  captureStoryUnitId,
  type CharacterId,
  type LocationId,
  type ParagraphId,
  type StoryUnitId,
} from "../../novel/index.js";

export const NOVEL_QUERY_API_OPERATION = Object.freeze({
  overviewGet: "novel.overview.get",
  outlineGet: "novel.outline.get",
  outlineStoryUnitGet: "novel.outline.storyUnit.get",
  charactersList: "novel.characters.list",
  characterGet: "novel.characters.get",
  locationsList: "novel.locations.list",
  locationGet: "novel.locations.get",
  paragraphCatalogGet: "novel.paragraph.catalog.get",
  paragraphGet: "novel.paragraph.get",
  publicationCatalogGet: "novel.publication.catalog.get",
} as const);

export type NovelQueryApiOperation =
  (typeof NOVEL_QUERY_API_OPERATION)[keyof typeof NOVEL_QUERY_API_OPERATION];

export const NOVEL_QUERY_SCOPE_KIND = Object.freeze({
  canonical: "canonical",
  conversationDraft: "conversation-draft",
} as const);

export interface CanonicalNovelQueryScope {
  readonly kind: typeof NOVEL_QUERY_SCOPE_KIND.canonical;
}

export interface ConversationDraftNovelQueryScope {
  readonly kind: typeof NOVEL_QUERY_SCOPE_KIND.conversationDraft;
  readonly conversationId: string;
}

export type NovelQueryScope =
  | CanonicalNovelQueryScope
  | ConversationDraftNovelQueryScope;

export const canonicalNovelQueryScope: CanonicalNovelQueryScope =
  Object.freeze({ kind: NOVEL_QUERY_SCOPE_KIND.canonical });

export interface NovelScopedQueryRequest {
  readonly scope: NovelQueryScope;
}

export interface NovelStoryUnitQueryRequest extends NovelScopedQueryRequest {
  readonly storyUnitId: StoryUnitId;
}

export interface NovelCharacterQueryRequest extends NovelScopedQueryRequest {
  readonly characterId: CharacterId;
}

export interface NovelLocationQueryRequest extends NovelScopedQueryRequest {
  readonly locationId: LocationId;
}

export interface NovelParagraphQueryRequest
  extends NovelScopedQueryRequest {
  readonly paragraphId: ParagraphId;
}

export function captureNovelQueryScope(value: unknown): NovelQueryScope {
  const record = captureRecord(value, ["kind"], ["conversationId"]);
  if (record.kind === NOVEL_QUERY_SCOPE_KIND.canonical) {
    if (record.conversationId !== undefined) throw invalidRequest();
    return canonicalNovelQueryScope;
  }
  if (record.kind !== NOVEL_QUERY_SCOPE_KIND.conversationDraft) {
    throw invalidRequest();
  }
  return Object.freeze({
    kind: NOVEL_QUERY_SCOPE_KIND.conversationDraft,
    conversationId: captureIdentity(record.conversationId),
  });
}

export function captureNovelScopedQueryRequest(
  value: unknown,
): NovelScopedQueryRequest {
  const record = captureRecord(value, ["scope"]);
  return Object.freeze({ scope: captureNovelQueryScope(record.scope) });
}

export function captureNovelStoryUnitQueryRequest(
  value: unknown,
): NovelStoryUnitQueryRequest {
  const record = captureRecord(value, ["scope", "storyUnitId"]);
  return Object.freeze({
    scope: captureNovelQueryScope(record.scope),
    storyUnitId: captureStoryUnitId(record.storyUnitId),
  });
}

export function captureNovelCharacterQueryRequest(
  value: unknown,
): NovelCharacterQueryRequest {
  const record = captureRecord(value, ["scope", "characterId"]);
  return Object.freeze({
    scope: captureNovelQueryScope(record.scope),
    characterId: captureCharacterId(record.characterId),
  });
}

export function captureNovelLocationQueryRequest(
  value: unknown,
): NovelLocationQueryRequest {
  const record = captureRecord(value, ["scope", "locationId"]);
  return Object.freeze({
    scope: captureNovelQueryScope(record.scope),
    locationId: captureLocationId(record.locationId),
  });
}

export function captureNovelParagraphQueryRequest(
  value: unknown,
): NovelParagraphQueryRequest {
  const record = captureRecord(value, ["scope", "paragraphId"]);
  return Object.freeze({
    scope: captureNovelQueryScope(record.scope),
    paragraphId: captureParagraphId(record.paragraphId),
  });
}

function captureRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw invalidRequest();
  }
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  if (
    requiredKeys.some((key) => !(key in record)) ||
    Object.keys(record).some((key) => !allowedKeys.has(key))
  ) {
    throw invalidRequest();
  }
  return record;
}

function captureIdentity(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value.trim() !== value ||
    /[\u0000-\u001F\u007F]/u.test(value)
  ) {
    throw invalidRequest();
  }
  return value;
}

function invalidRequest(): TypeError {
  return new TypeError("Novel query request is invalid");
}
