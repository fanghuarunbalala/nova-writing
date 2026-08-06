/**
 * Unified Novel Delete tool semantics: batch deletion of story units,
 * characters, locations, paragraphs, volumes, and chapters in the caller's
 * Draft. The host reads current digests/versions for optimistic concurrency;
 * precondition failures (children, plans, non-empty Volumes) reject without
 * cascading.
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
  type NovelCanonicalWritePort,
  type NovelOperation,
  type NovelOperationId,
  type NovelReadScope,
} from "../../../novel/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import type {
  NovelDeleteArguments,
  NovelDeleteDetails,
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
    const baseRevision =
      arguments_.baseRevision === undefined
        ? undefined
        : captureNovelRevision(arguments_.baseRevision);
    const operations: NovelOperation[] = [];
    const items: NovelDeleteItemDetails[] = [];
    this.logger.info("novel_delete_tool.delete.started", {
      conversationId,
      requestedCount: arguments_.values.length,
    });
    for (const value of arguments_.values) {
      try {
        await this.appendDeleteOperation({
          scope,
          value,
          operations,
        });
        items.push({ kind: value.kind, id: value.id, status: "applied" });
      } catch (error) {
        const reason = mapItemError(error);
        if (reason === undefined) {
          throw new ToolError({
            code: "NOVEL_DELETE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId,
          });
        }
        this.logger.info("novel_delete_tool.delete.rejected_batch", {
          conversationId,
          reason,
        });
        return {
          items: [{ kind: value.kind, id: value.id, status: "rejected", reason }],
          revision: { currentRevision },
        };
      }
    }
    if (operations.length === 0) {
      return { items, revision: { currentRevision } };
    }
    try {
      const result = await this.options.canonicalWrites.applyOperations({
        operations,
        conversationId,
        ...(baseRevision === undefined ? {} : { baseRevision }),
      });
      this.logger.info("novel_delete_tool.delete.completed", {
        conversationId,
        appliedCount: items.length,
        resultRevision: result.resultRevision,
      });
      return { items, revision: { currentRevision: result.resultRevision } };
    } catch (error) {
      // 事务内前置条件失败（例如 referenced）映射为整批 rejected（2A 已回滚）。
      if (error instanceof NovelOperationPreconditionError) {
        const first = arguments_.values[0];
        this.logger.info("novel_delete_tool.delete.precondition_batch", {
          conversationId,
          errorName: error.name,
          errorCode: error.code,
        });
        return {
          items: [
            {
              kind: first.kind,
              id: first.id,
              status: "rejected",
              reason:
                error.failure === "entity_referenced"
                  ? ITEM_REJECTION.referenced
                  : ITEM_REJECTION.preconditionFailed,
            },
          ],
          revision: { currentRevision },
        };
      }
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
  }

  private async appendDeleteOperation(input: {
    readonly scope: NovelReadScope;
    readonly value: { kind: NovelDeleteKind; id: string };
    readonly operations: NovelOperation[];
  }): Promise<void> {
    const { scope, value, operations } = input;
    switch (value.kind) {
      case "story_unit":
        await this.appendStoryUnitDelete(scope, value.id, operations);
        return;
      case "character":
        await this.appendCharacterDelete(scope, value.id, operations);
        return;
      case "location":
        await this.appendLocationDelete(scope, value.id, operations);
        return;
      case "paragraph":
        await this.appendParagraphDelete(scope, value.id, operations);
        return;
      case "volume":
        await this.appendVolumeDelete(scope, value.id, operations);
        return;
      case "chapter":
        await this.appendChapterDelete(scope, value.id, operations);
        return;
    }
  }

  private async appendStoryUnitDelete(
    scope: NovelReadScope,
    idInput: string,
    operations: NovelOperation[],
  ): Promise<void> {
    const storyUnitId = captureStoryUnitId(idInput);
    const current = await this.options.outlineQueries.getStoryUnit(scope, storyUnitId);
    if (current === undefined) {
      throw new NovelDeleteItemFailure(ITEM_REJECTION.notFound);
    }
    operations.push(
      createStoryUnitDeleteOperation({
        operationId: this.options.identityFactory.createOperationId(),
        storyUnitId,
        expectedContentDigest: current.contentDigest,
        expectedParentDigest: current.parentDigest,
        expectedOrderDigest: current.orderDigest,
      }),
    );
  }

  private async appendCharacterDelete(
    scope: NovelReadScope,
    idInput: string,
    operations: NovelOperation[],
  ): Promise<void> {
    const characterId = captureCharacterId(idInput);
    const current = await this.options.characterQueries.get(scope, characterId);
    if (current === undefined) {
      throw new NovelDeleteItemFailure(ITEM_REJECTION.notFound);
    }
    operations.push(
      createCharacterDeleteOperation({
        operationId: this.options.identityFactory.createOperationId(),
        id: characterId,
        expectedEntityVersion: current.entityVersion,
      }),
    );
  }

  private async appendLocationDelete(
    scope: NovelReadScope,
    idInput: string,
    operations: NovelOperation[],
  ): Promise<void> {
    const locationId = captureLocationId(idInput);
    const current = await this.options.locationQueries.get(scope, locationId);
    if (current === undefined) {
      throw new NovelDeleteItemFailure(ITEM_REJECTION.notFound);
    }
    operations.push(
      createLocationDeleteOperation({
        operationId: this.options.identityFactory.createOperationId(),
        id: locationId,
        expectedEntityVersion: current.entityVersion,
      }),
    );
  }

  private async appendParagraphDelete(
    scope: NovelReadScope,
    idInput: string,
    operations: NovelOperation[],
  ): Promise<void> {
    const paragraphId = captureParagraphId(idInput);
    const current = await this.options.paragraphQueries.getParagraph(scope, paragraphId);
    if (current === undefined) {
      throw new NovelDeleteItemFailure(ITEM_REJECTION.notFound);
    }
    operations.push(
      createParagraphDeleteOperation({
        operationId: this.options.identityFactory.createOperationId(),
        paragraphId,
        expectedTextDigest: current.textDigest,
        expectedOrderDigest: current.orderDigest,
        expectedStoryUnitDigest: current.storyUnitDigest,
      }),
    );
  }

  private async appendVolumeDelete(
    scope: NovelReadScope,
    idInput: string,
    operations: NovelOperation[],
  ): Promise<void> {
    const volumeId = capturePublicationVolumeId(idInput);
    const current = await this.options.publicationQueries.getVolume(scope, volumeId);
    if (current === undefined) {
      throw new NovelDeleteItemFailure(ITEM_REJECTION.notFound);
    }
    operations.push(
      createPublicationVolumeDeleteOperation({
        operationId: this.options.identityFactory.createOperationId(),
        id: volumeId,
        expectedRecordDigest: current.recordDigest,
      }),
    );
  }

  private async appendChapterDelete(
    scope: NovelReadScope,
    idInput: string,
    operations: NovelOperation[],
  ): Promise<void> {
    const chapterId = capturePublicationChapterId(idInput);
    const current = await this.options.publicationQueries.getChapter(scope, chapterId);
    if (current === undefined) {
      throw new NovelDeleteItemFailure(ITEM_REJECTION.notFound);
    }
    operations.push(
      createPublicationChapterDeleteOperation({
        operationId: this.options.identityFactory.createOperationId(),
        id: chapterId,
        expectedRecordDigest: current.recordDigest,
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
  if (reason === ITEM_REJECTION.notFound) {
    return Object.freeze({ kind, id, status: "rejected", reason });
  }
  return Object.freeze({ kind, id, status: "rejected", reason });
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
