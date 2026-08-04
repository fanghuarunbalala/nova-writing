/** Versioned immutable Novel query snapshots validated before crossing a client boundary. */
import {
  ManuscriptCatalog,
  PublicationCatalog,
  StoryOutlineTree,
  captureCharacter,
  captureLocation,
  captureManuscript,
  captureManuscriptBlockId,
  captureNovelId,
  captureNovelRevision,
  captureNovelSchemaVersion,
  captureNovelWorkspaceId,
  captureOrderKey,
  captureParagraphBlock,
  capturePublicationChapterId,
  captureStoryUnit,
  captureStoryUnitId,
  captureStoryUnitRealizationStatus,
  type Character,
  type Location,
  type Manuscript,
  type ManuscriptBlockId,
  type NovelId,
  type NovelRevision,
  type NovelSchemaVersion,
  type OrderKey,
  type ParagraphBlock,
  type PublicationCatalogSnapshot,
  type PublicationChapterId,
  type StoryOutlineTreeSnapshot,
  type StoryUnit,
  type StoryUnitProgressProjection,
} from "../../novel/index.js";
import {
  captureNovelQueryScope,
  type NovelQueryScope,
} from "./NovelQueryApiOperations.js";

export const NOVEL_QUERY_SNAPSHOT_VERSION = 1 as const;

export interface NovelQuerySnapshotBase {
  readonly schemaVersion: typeof NOVEL_QUERY_SNAPSHOT_VERSION;
  readonly scope: NovelQueryScope;
}

export interface NovelOverviewCounts {
  readonly storyUnitCount: number;
  readonly characterCount: number;
  readonly locationCount: number;
  readonly volumeCount: number;
  readonly chapterCount: number;
  readonly manuscriptBlockCount: number;
}

export interface NovelOverviewRoots {
  readonly outlineAvailable: boolean;
  readonly publicationAvailable: boolean;
  readonly manuscriptAvailable: boolean;
}

export interface NovelOverviewSnapshot extends NovelQuerySnapshotBase {
  readonly workspaceId: string;
  readonly novelId: NovelId;
  readonly novelSchemaVersion: NovelSchemaVersion;
  readonly sourceRevision: NovelRevision;
  readonly counts: NovelOverviewCounts;
  readonly roots: NovelOverviewRoots;
}

export interface NovelOutlineSnapshot extends NovelQuerySnapshotBase {
  readonly tree?: StoryOutlineTreeSnapshot;
  readonly progress: readonly StoryUnitProgressProjection[];
}

export interface NovelStoryUnitSnapshot extends NovelQuerySnapshotBase {
  readonly unit?: StoryUnit;
  readonly progress?: StoryUnitProgressProjection;
}

export interface NovelCharactersSnapshot extends NovelQuerySnapshotBase {
  readonly characters: readonly Character[];
}

export interface NovelCharacterSnapshot extends NovelQuerySnapshotBase {
  readonly character?: Character;
}

export interface NovelLocationsSnapshot extends NovelQuerySnapshotBase {
  readonly locations: readonly Location[];
}

export interface NovelLocationSnapshot extends NovelQuerySnapshotBase {
  readonly location?: Location;
}

export interface NovelManuscriptBlockSummary {
  readonly id: ManuscriptBlockId;
  readonly chapterId: PublicationChapterId;
  readonly orderKey: OrderKey;
  readonly textLength: number;
  readonly textDigest: string;
}

export interface NovelManuscriptStructureSnapshot
  extends NovelQuerySnapshotBase {
  readonly publication?: PublicationCatalogSnapshot;
  readonly manuscript?: Manuscript;
  readonly blocks: readonly NovelManuscriptBlockSummary[];
}

export interface NovelManuscriptBlockReadSnapshot {
  readonly block: ParagraphBlock;
  readonly textDigest: string;
  readonly chapterDigest: string;
  readonly orderDigest: string;
}

export interface NovelManuscriptBlockSnapshot extends NovelQuerySnapshotBase {
  readonly readModel?: NovelManuscriptBlockReadSnapshot;
}

export function captureNovelOverviewSnapshot(
  value: unknown,
): NovelOverviewSnapshot {
  const record = captureRecord(value, [
    "schemaVersion",
    "scope",
    "workspaceId",
    "novelId",
    "novelSchemaVersion",
    "sourceRevision",
    "counts",
    "roots",
  ]);
  return Object.freeze({
    schemaVersion: captureSnapshotVersion(record.schemaVersion),
    scope: captureNovelQueryScope(record.scope),
    workspaceId: captureNovelWorkspaceId(record.workspaceId),
    novelId: captureNovelId(record.novelId),
    novelSchemaVersion: captureNovelSchemaVersion(record.novelSchemaVersion),
    sourceRevision: captureNovelRevision(record.sourceRevision),
    counts: captureCounts(record.counts),
    roots: captureRoots(record.roots),
  });
}

export function captureNovelOutlineSnapshot(
  value: unknown,
): NovelOutlineSnapshot {
  const record = captureRecord(value, ["schemaVersion", "scope", "progress"], [
    "tree",
  ]);
  const tree = record.tree === undefined
    ? undefined
    : new StoryOutlineTree(record.tree).getSnapshot();
  const progress = captureProgressList(record.progress);
  const unitIds = new Set(tree?.units.map((unit) => unit.id) ?? []);
  if (
    (tree === undefined && progress.length > 0) ||
    progress.some((entry) => !unitIds.has(entry.storyUnitId))
  ) {
    throw invalidSnapshot();
  }
  return Object.freeze({
    schemaVersion: captureSnapshotVersion(record.schemaVersion),
    scope: captureNovelQueryScope(record.scope),
    ...(tree === undefined ? {} : { tree }),
    progress,
  });
}

export function captureNovelStoryUnitSnapshot(
  value: unknown,
): NovelStoryUnitSnapshot {
  const record = captureRecord(value, ["schemaVersion", "scope"], [
    "unit",
    "progress",
  ]);
  const unit = record.unit === undefined
    ? undefined
    : captureStoryUnitFromTree(record.unit);
  const progress = record.progress === undefined
    ? undefined
    : captureProgress(record.progress);
  if ((unit === undefined) !== (progress === undefined)) throw invalidSnapshot();
  if (unit !== undefined && progress?.storyUnitId !== unit.id) {
    throw invalidSnapshot();
  }
  return Object.freeze({
    schemaVersion: captureSnapshotVersion(record.schemaVersion),
    scope: captureNovelQueryScope(record.scope),
    ...(unit === undefined ? {} : { unit, progress }),
  });
}

export function captureNovelCharactersSnapshot(
  value: unknown,
): NovelCharactersSnapshot {
  const record = captureRecord(value, ["schemaVersion", "scope", "characters"]);
  const characters = captureDenseArray(record.characters).map((entry) =>
    captureCharacter(entry as Character)
  );
  assertUnique(characters.map((character) => character.id));
  return Object.freeze({
    schemaVersion: captureSnapshotVersion(record.schemaVersion),
    scope: captureNovelQueryScope(record.scope),
    characters: Object.freeze(characters),
  });
}

export function captureNovelCharacterSnapshot(
  value: unknown,
): NovelCharacterSnapshot {
  const record = captureRecord(value, ["schemaVersion", "scope"], ["character"]);
  const character = record.character === undefined
    ? undefined
    : captureCharacter(record.character as Character);
  return Object.freeze({
    schemaVersion: captureSnapshotVersion(record.schemaVersion),
    scope: captureNovelQueryScope(record.scope),
    ...(character === undefined ? {} : { character }),
  });
}

export function captureNovelLocationsSnapshot(
  value: unknown,
): NovelLocationsSnapshot {
  const record = captureRecord(value, ["schemaVersion", "scope", "locations"]);
  const locations = captureDenseArray(record.locations).map((entry) =>
    captureLocation(entry as Location)
  );
  assertUnique(locations.map((location) => location.id));
  return Object.freeze({
    schemaVersion: captureSnapshotVersion(record.schemaVersion),
    scope: captureNovelQueryScope(record.scope),
    locations: Object.freeze(locations),
  });
}

export function captureNovelLocationSnapshot(
  value: unknown,
): NovelLocationSnapshot {
  const record = captureRecord(value, ["schemaVersion", "scope"], ["location"]);
  const location = record.location === undefined
    ? undefined
    : captureLocation(record.location as Location);
  return Object.freeze({
    schemaVersion: captureSnapshotVersion(record.schemaVersion),
    scope: captureNovelQueryScope(record.scope),
    ...(location === undefined ? {} : { location }),
  });
}

export function captureNovelManuscriptStructureSnapshot(
  value: unknown,
): NovelManuscriptStructureSnapshot {
  const record = captureRecord(value, ["schemaVersion", "scope", "blocks"], [
    "publication",
    "manuscript",
  ]);
  const publication = record.publication === undefined
    ? undefined
    : new PublicationCatalog(record.publication).getSnapshot();
  const manuscript = record.manuscript === undefined
    ? undefined
    : captureManuscript(record.manuscript);
  if (
    manuscript !== undefined &&
    (publication === undefined ||
      manuscript.novelId !== publication.publication.novelId ||
      manuscript.publicationId !== publication.publication.id)
  ) {
    throw invalidSnapshot();
  }
  const blocks = captureDenseArray(record.blocks).map(captureBlockSummary);
  assertUnique(blocks.map((block) => block.id));
  const chapterIds = new Set(publication?.chapters.map((chapter) => chapter.id) ?? []);
  if (
    (manuscript === undefined && blocks.length > 0) ||
    blocks.some((block) => !chapterIds.has(block.chapterId))
  ) {
    throw invalidSnapshot();
  }
  return Object.freeze({
    schemaVersion: captureSnapshotVersion(record.schemaVersion),
    scope: captureNovelQueryScope(record.scope),
    ...(publication === undefined ? {} : { publication }),
    ...(manuscript === undefined ? {} : { manuscript }),
    blocks: Object.freeze(blocks),
  });
}

export function captureNovelManuscriptBlockSnapshot(
  value: unknown,
): NovelManuscriptBlockSnapshot {
  const record = captureRecord(value, ["schemaVersion", "scope"], ["readModel"]);
  const readModel = record.readModel === undefined
    ? undefined
    : captureBlockReadModel(record.readModel);
  return Object.freeze({
    schemaVersion: captureSnapshotVersion(record.schemaVersion),
    scope: captureNovelQueryScope(record.scope),
    ...(readModel === undefined ? {} : { readModel }),
  });
}

function captureCounts(value: unknown): NovelOverviewCounts {
  const record = captureRecord(value, [
    "storyUnitCount",
    "characterCount",
    "locationCount",
    "volumeCount",
    "chapterCount",
    "manuscriptBlockCount",
  ]);
  return Object.freeze({
    storyUnitCount: captureCount(record.storyUnitCount),
    characterCount: captureCount(record.characterCount),
    locationCount: captureCount(record.locationCount),
    volumeCount: captureCount(record.volumeCount),
    chapterCount: captureCount(record.chapterCount),
    manuscriptBlockCount: captureCount(record.manuscriptBlockCount),
  });
}

function captureRoots(value: unknown): NovelOverviewRoots {
  const record = captureRecord(value, [
    "outlineAvailable",
    "publicationAvailable",
    "manuscriptAvailable",
  ]);
  const roots = Object.freeze({
    outlineAvailable: captureBoolean(record.outlineAvailable),
    publicationAvailable: captureBoolean(record.publicationAvailable),
    manuscriptAvailable: captureBoolean(record.manuscriptAvailable),
  });
  if (roots.manuscriptAvailable && !roots.publicationAvailable) {
    throw invalidSnapshot();
  }
  return roots;
}

function captureProgressList(value: unknown): readonly StoryUnitProgressProjection[] {
  const progress = captureDenseArray(value).map(captureProgress);
  assertUnique(progress.map((entry) => entry.storyUnitId));
  return Object.freeze(progress);
}

function captureProgress(value: unknown): StoryUnitProgressProjection {
  const record = captureRecord(value, [
    "storyUnitId",
    "effectiveStatus",
    "isBlocked",
    "isDirectlyBlocked",
    "isBlockedByAncestor",
    "blockedLeafCount",
    "completedLeafCount",
    "totalLeafCount",
  ]);
  const result = Object.freeze({
    storyUnitId: captureStoryUnitId(record.storyUnitId),
    effectiveStatus: captureStoryUnitRealizationStatus(record.effectiveStatus),
    isBlocked: captureBoolean(record.isBlocked),
    isDirectlyBlocked: captureBoolean(record.isDirectlyBlocked),
    isBlockedByAncestor: captureBoolean(record.isBlockedByAncestor),
    blockedLeafCount: captureCount(record.blockedLeafCount),
    completedLeafCount: captureCount(record.completedLeafCount),
    totalLeafCount: captureCount(record.totalLeafCount),
  });
  if (
    result.blockedLeafCount > result.totalLeafCount ||
    result.completedLeafCount > result.totalLeafCount ||
    result.isBlocked !==
      (result.isDirectlyBlocked || result.isBlockedByAncestor)
  ) {
    throw invalidSnapshot();
  }
  return result;
}

function captureStoryUnitFromTree(value: unknown): StoryUnit {
  return captureStoryUnit(value);
}

function captureBlockSummary(value: unknown): NovelManuscriptBlockSummary {
  const record = captureRecord(value, [
    "id",
    "chapterId",
    "orderKey",
    "textLength",
    "textDigest",
  ]);
  return Object.freeze({
    id: captureManuscriptBlockId(record.id),
    chapterId: capturePublicationChapterId(record.chapterId),
    orderKey: captureOrderKey(record.orderKey),
    textLength: captureCount(record.textLength),
    textDigest: captureDigest(record.textDigest),
  });
}

function captureBlockReadModel(value: unknown): NovelManuscriptBlockReadSnapshot {
  const record = captureRecord(value, [
    "block",
    "textDigest",
    "chapterDigest",
    "orderDigest",
  ]);
  return Object.freeze({
    block: captureParagraphBlock(record.block),
    textDigest: captureDigest(record.textDigest),
    chapterDigest: captureDigest(record.chapterDigest),
    orderDigest: captureDigest(record.orderDigest),
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
    throw invalidSnapshot();
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (
    requiredKeys.some((key) => !(key in record)) ||
    Object.keys(record).some((key) => !allowed.has(key))
  ) {
    throw invalidSnapshot();
  }
  return record;
}

function captureDenseArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length) {
    throw invalidSnapshot();
  }
  return value;
}

function captureSnapshotVersion(
  value: unknown,
): typeof NOVEL_QUERY_SNAPSHOT_VERSION {
  if (value !== NOVEL_QUERY_SNAPSHOT_VERSION) throw invalidSnapshot();
  return NOVEL_QUERY_SNAPSHOT_VERSION;
}

function captureCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidSnapshot();
  }
  return value as number;
}

function captureBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw invalidSnapshot();
  return value;
}

function captureDigest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw invalidSnapshot();
  }
  return value;
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) throw invalidSnapshot();
}

function invalidSnapshot(): TypeError {
  return new TypeError("Novel query snapshot is invalid");
}
