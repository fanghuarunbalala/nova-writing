/**
 * Unified Novel Delete tool semantics: batch deletion of story units,
 * characters, locations, paragraphs, volumes, and chapters in the caller's
 * Draft. The host reads current digests/versions for optimistic concurrency.
 *
 * By default (`cascade:false`) entities with dependencies are rejected without
 * cascading. With `cascade:true` a parent is deleted together with its
 * dependents (story unit subtree + paragraphs + leaf plan; volume + chapters),
 * and every entity actually deleted is returned as its complete model record.
 * Pre-check failures apply partially: valid entries still delete, while failed
 * entries are reported as rejected with the error content returned in-band.
 *
 * 删除语义：默认严格（有引用即拒绝）；`cascade:true` 级联删父带子并返回全部被删
 * 实体的完整记录。预检失败做部分应用；apply 阶段失败把错误内容放进结果而非抛错。
 */
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  CharacterQueryService,
  LocationQueryService,
  NovelOperationPreconditionError,
  NovelProtocolValidationError,
  ParagraphQueryService,
  PublicationQueryService,
  StoryOutlineQueryService,
  canonicalNovelReadScope,
  captureCharacterId,
  captureLocationId,
  captureNovelRevision,
  captureParagraphId,
  capturePublicationChapterId,
  capturePublicationVolumeId,
  captureStoryUnitId,
  createCharacterDeleteOperation,
  createLocationDeleteOperation,
  createParagraphDeleteOperation,
  createPublicationChapterDeleteOperation,
  createPublicationVolumeDeleteOperation,
  createStoryUnitDeleteOperation,
  type Character,
  type Location,
  type NovelCanonicalWritePort,
  type NovelOperation,
  type NovelOperationId,
  type NovelReadScope,
  type Paragraph,
  type ParagraphReadModel,
  type PublicationChapter,
  type PublicationChapterReadModel,
  type PublicationVolume,
  type PublicationVolumeReadModel,
  type StoryUnit,
  type StoryUnitId,
  type StoryUnitReadModel,
} from "../../../novel/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import type { JsonValue } from "../../../event/index.js";
import type {
  NovelDeleteArguments,
  NovelDeleteDetails,
  NovelDeletedEntity,
  NovelDeleteErrorDetails,
  NovelDeleteItemDetails,
  NovelDeleteKind,
} from "./schemas.js";

export interface NovelDeleteToolServiceOptions {
  readonly outlineQueries: StoryOutlineQueryService;
  readonly characterQueries: CharacterQueryService;
  readonly locationQueries: LocationQueryService;
  readonly paragraphQueries: ParagraphQueryService;
  readonly publicationQueries: PublicationQueryService;
  readonly canonicalWrites: NovelCanonicalWritePort;
  readonly identityFactory: { createOperationId(): NovelOperationId };
  readonly logger?: Logger;
}

const ITEM_REJECTION = {
  notFound: "not_found",
  referenced: "referenced",
  invalidValue: "invalid_value",
  preconditionFailed: "precondition_failed",
} as const;

export class NovelDeleteToolService {
  private readonly logger: Logger;

  constructor(private readonly options: NovelDeleteToolServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_delete_tool_service",
    });
  }

  async delete(
    conversationId: string,
    arguments_: NovelDeleteArguments,
  ): Promise<NovelDeleteDetails> {
    const scope = canonicalNovelReadScope;
    const currentRevision =
      await this.options.canonicalWrites.getCurrentRevision();
    const baseRevision = captureNovelRevision(arguments_.baseRevision);
    const cascade = arguments_.cascade === true;
    const operations: NovelOperation[] = [];
    const items: NovelDeleteItemDetails[] = [];
    const deleted: NovelDeletedEntity[] = [];
    const deletedKeys = new Set<string>();
    this.logger.info("novel_delete_tool.delete.started", {
      conversationId,
      requestedCount: arguments_.values.length,
      cascade,
    });
    for (const value of arguments_.values) {
      const item = await this.resolveDeleteItem({
        scope,
        value,
        cascade,
        operations,
        deleted,
        deletedKeys,
      });
      items.push(item);
    }
    if (operations.length === 0) {
      return {
        items,
        ...(deleted.length === 0 ? {} : { deleted }),
        revision: { currentRevision },
      };
    }
    try {
      const result = await this.options.canonicalWrites.applyOperations({
        operations,
        conversationId,
        baseRevision,
      });
      this.logger.info("novel_delete_tool.delete.completed", {
        conversationId,
        appliedCount: items.filter((item) => item.status === "applied").length,
        resultRevision: result.resultRevision,
      });
      return {
        items,
        ...(deleted.length === 0 ? {} : { deleted }),
        revision: { currentRevision: result.resultRevision },
      };
    } catch (error) {
      // 事务内失败：返回结构化错误内容（in-band），不抛 NOVEL_DELETE_FAILED。
      let applyError: NovelDeleteErrorDetails;
      if (error instanceof NovelOperationPreconditionError) {
        applyError = {
          failure: error.failure,
          entityType: error.entityType,
          entityId: error.entityId,
        };
      } else if (error instanceof Error) {
        applyError = { failure: "invalid_structure" };
      } else {
        this.logger.info("novel_delete_tool.delete.failed", {
          conversationId,
          errorName: error instanceof Error ? error.name : typeof error,
        });
        throw new ToolError({
          code: "NOVEL_DELETE_FAILED",
          category: "execution",
          retryable: true,
          sideEffectStatus: "none",
          conversationId,
        });
      }
      const errorCode =
        error instanceof Error && "code" in error
          ? String((error as { code: unknown }).code)
          : undefined;
      this.logger.info("novel_delete_tool.delete.rejected_batch", {
        conversationId,
        errorName: error instanceof Error ? error.name : typeof error,
        ...(errorCode === undefined ? {} : { errorCode }),
      });
      return {
        items: arguments_.values.map((value) =>
          rejectedItem(
            value.kind,
            value.id,
            applyError.failure === "entity_referenced"
              ? ITEM_REJECTION.referenced
              : ITEM_REJECTION.preconditionFailed,
          ),
        ),
        deleted: [],
        error: applyError,
        revision: { currentRevision },
      };
    }
  }

  private async resolveDeleteItem(input: {
    readonly scope: NovelReadScope;
    readonly value: { readonly kind: NovelDeleteKind; readonly id: string };
    readonly cascade: boolean;
    readonly operations: NovelOperation[];
    readonly deleted: NovelDeletedEntity[];
    readonly deletedKeys: Set<string>;
  }): Promise<NovelDeleteItemDetails> {
    const { scope, value, cascade, operations, deleted, deletedKeys } = input;
    try {
      switch (value.kind) {
        case "story_unit":
          return await this.resolveStoryUnitDelete({
            scope,
            value,
            cascade,
            operations,
            deleted,
            deletedKeys,
          });
        case "character": {
          const characterId = captureCharacterId(value.id);
          if (deletedKeys.has(`character:${characterId}`)) {
            return deletedItem(value.kind, value.id);
          }
          const character = await this.options.characterQueries.get(
            scope,
            characterId,
          );
          if (character === undefined) {
            return rejectedItem(value.kind, value.id, ITEM_REJECTION.notFound);
          }
          await this.appendCharacterDelete(scope, character, operations);
          recordDeleted(deleted, deletedKeys, value.kind, character.id, character);
          return deletedItem(value.kind, value.id);
        }
        case "location": {
          const locationId = captureLocationId(value.id);
          if (deletedKeys.has(`location:${locationId}`)) {
            return deletedItem(value.kind, value.id);
          }
          const location = await this.options.locationQueries.get(
            scope,
            locationId,
          );
          if (location === undefined) {
            return rejectedItem(value.kind, value.id, ITEM_REJECTION.notFound);
          }
          await this.appendLocationDelete(scope, location, operations);
          recordDeleted(deleted, deletedKeys, value.kind, location.id, location);
          return deletedItem(value.kind, value.id);
        }
        case "paragraph": {
          const paragraphId = captureParagraphId(value.id);
          if (deletedKeys.has(`paragraph:${paragraphId}`)) {
            return deletedItem(value.kind, value.id);
          }
          const paragraph = await this.options.paragraphQueries.getParagraph(
            scope,
            paragraphId,
          );
          if (paragraph === undefined) {
            return rejectedItem(value.kind, value.id, ITEM_REJECTION.notFound);
          }
          await this.appendParagraphDelete(scope, paragraph, operations);
          recordDeleted(
            deleted,
            deletedKeys,
            value.kind,
            paragraph.paragraph.id,
            paragraph.paragraph,
          );
          return deletedItem(value.kind, value.id);
        }
        case "volume":
          return await this.resolveVolumeDelete({
            scope,
            value,
            cascade,
            operations,
            deleted,
            deletedKeys,
          });
        case "chapter":
          return await this.resolveChapterDelete({
            scope,
            value,
            cascade,
            operations,
            deleted,
            deletedKeys,
          });
      }
    } catch (error) {
      const reason = mapItemError(error);
      if (reason === undefined) throw error;
      return rejectedItem(value.kind, value.id, reason);
    }
  }

  private async resolveStoryUnitDelete(input: {
    readonly scope: NovelReadScope;
    readonly value: { readonly id: string };
    readonly cascade: boolean;
    readonly operations: NovelOperation[];
    readonly deleted: NovelDeletedEntity[];
    readonly deletedKeys: Set<string>;
  }): Promise<NovelDeleteItemDetails> {
    const { scope, value, cascade, operations, deleted, deletedKeys } = input;
    const storyUnitId = captureStoryUnitId(value.id);
    if (deletedKeys.has(`story_unit:${storyUnitId}`)) {
      return deletedItem("story_unit", value.id);
    }
    const current = await this.options.outlineQueries.getStoryUnit(
      scope,
      storyUnitId,
    );
    if (current === undefined) {
      return rejectedItem("story_unit", value.id, ITEM_REJECTION.notFound);
    }
    if (!cascade) {
      if (await this.hasStoryUnitDependencies(scope, storyUnitId)) {
        return rejectedItem("story_unit", value.id, ITEM_REJECTION.referenced);
      }
      await this.appendStoryUnitDelete(scope, current, operations);
      recordDeleted(deleted, deletedKeys, "story_unit", current.unit.id, current.unit);
      return deletedItem("story_unit", value.id);
    }
    // 级联：整棵子树（单元 + 段落）完整记录进 deleted，父单元一个 op。
    const closure: { units: StoryUnit[]; paragraphs: Paragraph[] } = {
      units: [],
      paragraphs: [],
    };
    await this.collectStoryUnitClosure(scope, storyUnitId, closure);
    for (const unit of closure.units) {
      recordDeleted(deleted, deletedKeys, "story_unit", unit.id, unit);
    }
    for (const paragraph of closure.paragraphs) {
      recordDeleted(deleted, deletedKeys, "paragraph", paragraph.id, paragraph);
    }
    await this.appendStoryUnitDelete(scope, current, operations);
    return deletedItem("story_unit", value.id);
  }

  private async resolveVolumeDelete(input: {
    readonly scope: NovelReadScope;
    readonly value: { readonly id: string };
    readonly cascade: boolean;
    readonly operations: NovelOperation[];
    readonly deleted: NovelDeletedEntity[];
    readonly deletedKeys: Set<string>;
  }): Promise<NovelDeleteItemDetails> {
    const { scope, value, cascade, operations, deleted, deletedKeys } = input;
    const volumeId = capturePublicationVolumeId(value.id);
    if (deletedKeys.has(`volume:${volumeId}`)) {
      return deletedItem("volume", value.id);
    }
    const current = await this.options.publicationQueries.getVolume(
      scope,
      volumeId,
    );
    if (current === undefined) {
      return rejectedItem("volume", value.id, ITEM_REJECTION.notFound);
    }
    const chapters = await this.options.publicationQueries.listChapters(
      scope,
      volumeId,
    );
    if (!cascade) {
      if (chapters.length > 0) {
        return rejectedItem("volume", value.id, ITEM_REJECTION.referenced);
      }
      await this.appendVolumeDelete(scope, current, operations);
      recordDeleted(deleted, deletedKeys, "volume", current.volume.id, current.volume);
      return deletedItem("volume", value.id);
    }
    recordDeleted(deleted, deletedKeys, "volume", current.volume.id, current.volume);
    for (const chapter of chapters) {
      recordDeleted(deleted, deletedKeys, "chapter", chapter.chapter.id, chapter.chapter);
    }
    await this.appendVolumeDelete(scope, current, operations);
    return deletedItem("volume", value.id);
  }

  private async resolveChapterDelete(input: {
    readonly scope: NovelReadScope;
    readonly value: { readonly id: string };
    readonly cascade: boolean;
    readonly operations: NovelOperation[];
    readonly deleted: NovelDeletedEntity[];
    readonly deletedKeys: Set<string>;
  }): Promise<NovelDeleteItemDetails> {
    const { scope, value, cascade, operations, deleted, deletedKeys } = input;
    const chapterId = capturePublicationChapterId(value.id);
    if (deletedKeys.has(`chapter:${chapterId}`)) {
      return deletedItem("chapter", value.id);
    }
    const current = await this.options.publicationQueries.getChapter(
      scope,
      chapterId,
    );
    if (current === undefined) {
      return rejectedItem("chapter", value.id, ITEM_REJECTION.notFound);
    }
    if (!cascade) {
      if (current.chapter.paragraphIds.length > 0) {
        return rejectedItem("chapter", value.id, ITEM_REJECTION.referenced);
      }
      await this.appendChapterDelete(scope, current, operations);
      recordDeleted(deleted, deletedKeys, "chapter", current.chapter.id, current.chapter);
      return deletedItem("chapter", value.id);
    }
    // 级联删 chapter：解绑段落（段落实体保留），仅 chapter 自身进入 deleted。
    recordDeleted(deleted, deletedKeys, "chapter", current.chapter.id, current.chapter);
    await this.appendChapterDelete(scope, current, operations);
    return deletedItem("chapter", value.id);
  }

  /** 是否被依赖：有子单元 / leaf plan / 段落任一即拒绝（cascade:false 时）。 */
  private async hasStoryUnitDependencies(
    scope: NovelReadScope,
    storyUnitId: StoryUnitId,
  ): Promise<boolean> {
    const children = await this.options.outlineQueries.listStoryUnitChildren(
      scope,
      storyUnitId,
    );
    if (children.length > 0) return true;
    const plan = await this.options.outlineQueries.getLeafStoryUnitPlan(
      scope,
      storyUnitId,
    );
    if (plan !== undefined) return true;
    const paragraphs =
      await this.options.paragraphQueries.listParagraphsByStoryUnit(
        scope,
        storyUnitId,
      );
    return paragraphs.length > 0;
  }

  /** 递归收集 story unit 子树全部单元与段落（用于 cascade 的完整返回）。 */
  private async collectStoryUnitClosure(
    scope: NovelReadScope,
    storyUnitId: StoryUnitId,
    closure: { units: StoryUnit[]; paragraphs: Paragraph[] },
  ): Promise<void> {
    const current = await this.options.outlineQueries.getStoryUnit(
      scope,
      storyUnitId,
    );
    if (current === undefined) return;
    closure.units.push(current.unit);
    const paragraphs =
      await this.options.paragraphQueries.listParagraphsByStoryUnit(
        scope,
        storyUnitId,
      );
    for (const paragraph of paragraphs) {
      closure.paragraphs.push(paragraph.paragraph);
    }
    const children = await this.options.outlineQueries.listStoryUnitChildren(
      scope,
      storyUnitId,
    );
    for (const child of children) {
      await this.collectStoryUnitClosure(scope, child.id, closure);
    }
  }

  private async appendStoryUnitDelete(
    scope: NovelReadScope,
    current: StoryUnitReadModel,
    operations: NovelOperation[],
  ): Promise<void> {
    const storyUnitId = current.unit.id;
    const currentVersion =
      await this.options.outlineQueries.getStoryUnitVersion(scope, storyUnitId);
    operations.push(
      createStoryUnitDeleteOperation({
        operationId: this.options.identityFactory.createOperationId(),
        storyUnitId,
        expectedContentDigest: current.contentDigest,
        expectedParentDigest: current.parentDigest,
        expectedOrderDigest: current.orderDigest,
        ...(currentVersion === undefined
          ? {}
          : { expectedEntityVersion: currentVersion }),
      }),
    );
  }

  private async appendCharacterDelete(
    scope: NovelReadScope,
    character: Character,
    operations: NovelOperation[],
  ): Promise<void> {
    operations.push(
      createCharacterDeleteOperation({
        operationId: this.options.identityFactory.createOperationId(),
        id: character.id,
        expectedEntityVersion: character.entityVersion,
      }),
    );
    void scope;
  }

  private async appendLocationDelete(
    scope: NovelReadScope,
    location: Location,
    operations: NovelOperation[],
  ): Promise<void> {
    operations.push(
      createLocationDeleteOperation({
        operationId: this.options.identityFactory.createOperationId(),
        id: location.id,
        expectedEntityVersion: location.entityVersion,
      }),
    );
    void scope;
  }

  private async appendParagraphDelete(
    scope: NovelReadScope,
    current: ParagraphReadModel,
    operations: NovelOperation[],
  ): Promise<void> {
    const paragraphId = current.paragraph.id;
    const currentVersion =
      await this.options.paragraphQueries.getParagraphVersion(scope, paragraphId);
    operations.push(
      createParagraphDeleteOperation({
        operationId: this.options.identityFactory.createOperationId(),
        paragraphId,
        expectedTextDigest: current.textDigest,
        expectedOrderDigest: current.orderDigest,
        expectedStoryUnitDigest: current.storyUnitDigest,
        ...(currentVersion === undefined
          ? {}
          : { expectedEntityVersion: currentVersion }),
      }),
    );
  }

  private async appendVolumeDelete(
    scope: NovelReadScope,
    current: PublicationVolumeReadModel,
    operations: NovelOperation[],
  ): Promise<void> {
    const volumeId = current.volume.id;
    const currentVersion =
      await this.options.publicationQueries.getVolumeVersion(scope, volumeId);
    operations.push(
      createPublicationVolumeDeleteOperation({
        operationId: this.options.identityFactory.createOperationId(),
        id: volumeId,
        expectedRecordDigest: current.recordDigest,
        ...(currentVersion === undefined
          ? {}
          : { expectedEntityVersion: currentVersion }),
      }),
    );
  }

  private async appendChapterDelete(
    scope: NovelReadScope,
    current: PublicationChapterReadModel,
    operations: NovelOperation[],
  ): Promise<void> {
    const chapterId = current.chapter.id;
    const currentVersion =
      await this.options.publicationQueries.getChapterVersion(scope, chapterId);
    operations.push(
      createPublicationChapterDeleteOperation({
        operationId: this.options.identityFactory.createOperationId(),
        id: chapterId,
        expectedRecordDigest: current.recordDigest,
        ...(currentVersion === undefined
          ? {}
          : { expectedEntityVersion: currentVersion }),
      }),
    );
  }
}

class NovelDeleteItemFailure extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "NovelDeleteItemFailure";
  }
}

function deletedItem(
  kind: NovelDeleteKind,
  id: string,
): NovelDeleteItemDetails {
  return Object.freeze({
    kind,
    id,
    status: "applied",
  });
}

function rejectedItem(
  kind: NovelDeleteKind,
  id: string,
  reason: string,
): NovelDeleteItemDetails {
  return Object.freeze({ kind, id, status: "rejected", reason });
}

function recordDeleted(
  deleted: NovelDeletedEntity[],
  deletedKeys: Set<string>,
  kind: NovelDeleteKind,
  id: string,
  data: unknown,
): void {
  const key = `${kind}:${id}`;
  if (deletedKeys.has(key)) return;
  deletedKeys.add(key);
  deleted.push(Object.freeze({ kind, data: data as JsonValue }));
}

function mapItemError(error: unknown): string | undefined {
  if (error instanceof NovelDeleteItemFailure) return error.reason;
  if (error instanceof NovelProtocolValidationError) {
    return ITEM_REJECTION.invalidValue;
  }
  if (error instanceof NovelOperationPreconditionError) {
    return error.failure === "entity_referenced"
      ? ITEM_REJECTION.referenced
      : ITEM_REJECTION.preconditionFailed;
  }
  return undefined;
}
