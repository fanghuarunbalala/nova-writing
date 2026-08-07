/** Synchronous transaction-local repository used by deterministic Paragraph Operations. */
import type {
  ParagraphId,
  StoryUnitId,
} from "../identity/index.js";
import type {
  OrderKey,
  Paragraph,
} from "../model/index.js";
import type { NovelReadScope } from "../query/index.js";
import type { NovelEntityVersion } from "../version/index.js";

export type ParagraphDigestField = "text" | "orderKey" | "storyUnitId";

export interface NovelMutableParagraphRepository {
  getParagraph(id: ParagraphId): Paragraph | undefined;
  listAllParagraphs(): readonly Paragraph[];
  listParagraphsByStoryUnit(storyUnitId: StoryUnitId): readonly Paragraph[];
  findParagraphAt(storyUnitId: StoryUnitId, orderKey: OrderKey): Paragraph | undefined;
  getParagraphDigest(
    id: ParagraphId,
    field: ParagraphDigestField,
  ): string | undefined;
  /** 读取实体的当前版本（per-entity 乐观锁）。Current entity version. */
  getParagraphVersion(id: ParagraphId): NovelEntityVersion | undefined;
  insertParagraph(paragraph: Paragraph): boolean;
  replaceParagraph(
    paragraph: Paragraph,
    expectedEntityVersion?: NovelEntityVersion,
  ): boolean;
  deleteParagraph(
    id: ParagraphId,
    expectedEntityVersion?: NovelEntityVersion,
  ): boolean;
  removeParagraphFromChapters(paragraphId: ParagraphId): boolean;
  hasStoryUnit(storyUnitId: StoryUnitId): boolean;
}

export interface NovelParagraphMutationContext {
  readonly paragraph: NovelMutableParagraphRepository;
}

export interface ParagraphReadModel {
  readonly paragraph: Paragraph;
  readonly textDigest: string;
  readonly orderDigest: string;
  readonly storyUnitDigest: string;
}

export interface ParagraphCatalogReadModel {
  readonly snapshot: {
    readonly paragraphs: readonly Paragraph[];
  };
  readonly paragraphDigests: Readonly<Record<string, {
    readonly textDigest: string;
    readonly orderDigest: string;
    readonly storyUnitDigest: string;
  }>>;
}

export interface NovelParagraphQueryStore {
  getCatalog(scope: NovelReadScope): Promise<ParagraphCatalogReadModel | undefined>;
  getParagraph(
    scope: NovelReadScope,
    id: ParagraphId,
  ): Promise<ParagraphReadModel | undefined>;
  /** 读取实体当前版本（per-entity 乐观锁）。Current entity version. */
  getParagraphVersion(
    scope: NovelReadScope,
    id: ParagraphId,
  ): Promise<NovelEntityVersion | undefined>;
  listParagraphsByStoryUnit(
    scope: NovelReadScope,
    storyUnitId: StoryUnitId,
  ): Promise<readonly ParagraphReadModel[]>;
}
