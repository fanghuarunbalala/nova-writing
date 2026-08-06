/**
 * Provider-neutral Novel Publication tool semantics: read Volumes with their
 * Chapters, batch create/update Volumes and Chapters, and optionally expand a
 * Chapter's ordered Paragraph selection into full content. Digests stay
 * inside the host; the publication root is auto-created on first write.
 */
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  FractionalOrderKeyFactory,
  NovelOperationPreconditionError,
  NovelProtocolValidationError,
  ParagraphQueryService,
  PublicationQueryService,
  canonicalNovelReadScope,
  captureNovelId,
  captureNovelRevision,
  captureOrderKey,
  capturePublicationChapter,
  capturePublicationChapterId,
  capturePublicationStructureId,
  capturePublicationVolume,
  capturePublicationVolumeId,
  createPublicationChapterCreateOperation,
  createPublicationChapterReplaceOperation,
  createPublicationCreateOperation,
  createPublicationVolumeCreateOperation,
  createPublicationVolumeReplaceOperation,
  type NovelCanonicalWritePort,
  type NovelId,
  type NovelOperation,
  type NovelOperationId,
  type NovelReadScope,
  type OrderKey,
  type Paragraph,
  type PublicationChapterId,
  type PublicationStructureId,
  type PublicationVolumeId,
} from "../../../novel/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import type {
  ChapterWriteValue,
  NovelChapterDetails,
  NovelChapterEditArguments,
  NovelChapterEditValue,
  NovelChapterReadArguments,
  NovelChapterReadDetails,
  NovelChapterWriteArguments,
  NovelChapterWriteDetails,
  NovelPublicationItemDetails,
  NovelVolumeDetails,
  NovelVolumeEditArguments,
  NovelVolumeEditValue,
  NovelVolumeReadArguments,
  NovelVolumeReadDetails,
  NovelVolumeWriteArguments,
  NovelVolumeWriteDetails,
  VolumeWriteValue,
} from "./schemas.js";

export interface NovelPublicationToolServiceOptions {
  readonly novelId: NovelId;
  readonly publicationQueries: PublicationQueryService;
  readonly paragraphs: ParagraphQueryService;
  readonly canonicalWrites: NovelCanonicalWritePort;
  readonly identityFactory: {
    createPublicationStructureId(): PublicationStructureId;
    createPublicationVolumeId(): PublicationVolumeId;
    createPublicationChapterId(): PublicationChapterId;
    createOperationId(): NovelOperationId;
  };
  readonly orderKeys?: {
    initial(): OrderKey;
    after(orderKey: OrderKey): OrderKey;
  };
  readonly logger?: Logger;
}

const ITEM_REJECTION = {
  notFound: "not_found",
  duplicateId: "duplicate_id",
  unknownVolume: "unknown_volume",
  invalidValue: "invalid_value",
  preconditionFailed: "precondition_failed",
} as const;

export class NovelPublicationToolService {
  private readonly logger: Logger;
  private readonly orderKeys: {
    initial(): OrderKey;
    after(orderKey: OrderKey): OrderKey;
  };

  constructor(private readonly options: NovelPublicationToolServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_publication_tool_service",
    });
    this.orderKeys = options.orderKeys ?? new FractionalOrderKeyFactory();
  }

  async readVolumes(
    conversationId: string,
    arguments_: NovelVolumeReadArguments,
  ): Promise<NovelVolumeReadDetails> {
    const scope = canonicalNovelReadScope;
    const revision = await this.options.canonicalWrites.getCurrentRevision();
    const catalog = await this.options.publicationQueries.getCatalog(scope);
    if (catalog === undefined) {
      return { volumes: [], revision: { currentRevision: revision } };
    }
    return {
      volumes: catalog.snapshot.volumes.map((volume) => toVolumeDetails(volume)),
      revision: { currentRevision: revision },
    };
  }

  async readChapters(
    conversationId: string,
    arguments_: NovelChapterReadArguments,
  ): Promise<NovelChapterReadDetails> {
    const scope = canonicalNovelReadScope;
    const revision = await this.options.canonicalWrites.getCurrentRevision();
    const catalog = await this.options.publicationQueries.getCatalog(scope);
    if (catalog === undefined) {
      return { chapters: [], revision: { currentRevision: revision } };
    }
    let chapters = catalog.snapshot.chapters;
    if (arguments_.chapterId !== undefined) {
      const chapterId = capturePublicationChapterId(arguments_.chapterId);
      chapters = chapters.filter((chapter) => chapter.id === chapterId);
    } else if (arguments_.volumeId !== undefined) {
      const volumeId = capturePublicationVolumeId(arguments_.volumeId);
      chapters = chapters.filter((chapter) => chapter.volumeId === volumeId);
    }
    const paragraphById =
      arguments_.includeContent === true
        ? indexParagraphs(
            (await this.options.paragraphs.getCatalog(scope))?.snapshot
              .paragraphs ?? [],
          )
        : undefined;
    return {
      chapters: chapters.map((chapter) =>
        toChapterDetails(
          chapter,
          arguments_.includeContent === true ? paragraphById : undefined,
        )
      ),
      revision: { currentRevision: revision },
    };
  }

  async writeVolumes(
    conversationId: string,
    arguments_: NovelVolumeWriteArguments,
  ): Promise<NovelVolumeWriteDetails> {
    const scope = canonicalNovelReadScope;
    const currentRevision =
      await this.options.canonicalWrites.getCurrentRevision();
    const baseRevision =
      arguments_.baseRevision === undefined
        ? undefined
        : captureNovelRevision(arguments_.baseRevision);
    const operations: NovelOperation[] = [];
    const publication = await this.ensurePublication(scope, operations);
    const items: NovelPublicationItemDetails[] = [];
    this.logger.info("novel_publication_tool.volume.write.started", {
      conversationId,
      requestedCount: arguments_.values.length,
    });
    for (const value of arguments_.values) {
      const volumeId = capturePublicationVolumeId(
        value.id ?? this.options.identityFactory.createPublicationVolumeId(),
      );
      try {
        await this.appendVolumeWrite({
          scope,
          publication,
          value,
          volumeId,
          operations,
        });
        items.push({ id: volumeId, status: "applied" });
      } catch (error) {
        const reason = mapItemError(error);
        if (reason === undefined) {
          throw new ToolError({
            code: "NOVEL_PUBLICATION_VOLUME_WRITE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId,
          });
        }
        this.logger.info(
          "novel_publication_tool.volume.write.rejected_batch",
          { conversationId, reason },
        );
        return {
          items: [{ id: volumeId, status: "rejected", reason }],
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
      this.logger.info("novel_publication_tool.volume.write.completed", {
        conversationId,
        appliedCount: items.length,
        resultRevision: result.resultRevision,
      });
      return { items, revision: { currentRevision: result.resultRevision } };
    } catch (error) {
      this.logger.info("novel_publication_tool.volume.write.failed", {
        conversationId,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw new ToolError({
        code: "NOVEL_PUBLICATION_VOLUME_WRITE_FAILED",
        category: "execution",
        retryable: true,
        sideEffectStatus: "none",
        conversationId,
      });
    }
  }

  async editVolumes(
    conversationId: string,
    arguments_: NovelVolumeEditArguments,
  ): Promise<NovelVolumeWriteDetails> {
    const scope = canonicalNovelReadScope;
    const currentRevision =
      await this.options.canonicalWrites.getCurrentRevision();
    const baseRevision =
      arguments_.baseRevision === undefined
        ? undefined
        : captureNovelRevision(arguments_.baseRevision);
    const operations: NovelOperation[] = [];
    const items: NovelPublicationItemDetails[] = [];
    for (const patch of arguments_.values) {
      try {
        await this.appendVolumeEdit({
          scope,
          id: patch.id,
          patch: patch.value,
          operations,
        });
        items.push({ id: patch.id, status: "applied" });
      } catch (error) {
        const reason = mapItemError(error);
        if (reason === undefined) {
          throw new ToolError({
            code: "NOVEL_PUBLICATION_VOLUME_EDIT_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId,
          });
        }
        this.logger.info(
          "novel_publication_tool.volume.edit.rejected_batch",
          { conversationId, reason },
        );
        return {
          items: [{ id: patch.id, status: "rejected", reason }],
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
      this.logger.info("novel_publication_tool.volume.edit.completed", {
        conversationId,
        appliedCount: items.length,
        resultRevision: result.resultRevision,
      });
      return { items, revision: { currentRevision: result.resultRevision } };
    } catch (error) {
      this.logger.info("novel_publication_tool.volume.edit.failed", {
        conversationId,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw new ToolError({
        code: "NOVEL_PUBLICATION_VOLUME_EDIT_FAILED",
        category: "execution",
        retryable: true,
        sideEffectStatus: "none",
        conversationId,
      });
    }
  }

  async writeChapters(
    conversationId: string,
    arguments_: NovelChapterWriteArguments,
  ): Promise<NovelChapterWriteDetails> {
    const scope = canonicalNovelReadScope;
    const currentRevision =
      await this.options.canonicalWrites.getCurrentRevision();
    const baseRevision =
      arguments_.baseRevision === undefined
        ? undefined
        : captureNovelRevision(arguments_.baseRevision);
    const operations: NovelOperation[] = [];
    const publication = await this.ensurePublication(scope, operations);
    const items: NovelPublicationItemDetails[] = [];
    this.logger.info("novel_publication_tool.chapter.write.started", {
      conversationId,
      requestedCount: arguments_.values.length,
    });
    for (const value of arguments_.values) {
      const chapterId = capturePublicationChapterId(
        value.id ?? this.options.identityFactory.createPublicationChapterId(),
      );
      try {
        await this.appendChapterWrite({
          scope,
          publication,
          value,
          chapterId,
          operations,
        });
        items.push({ id: chapterId, status: "applied" });
      } catch (error) {
        const reason = mapItemError(error);
        if (reason === undefined) {
          throw new ToolError({
            code: "NOVEL_PUBLICATION_CHAPTER_WRITE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId,
          });
        }
        this.logger.info(
          "novel_publication_tool.chapter.write.rejected_batch",
          { conversationId, reason },
        );
        return {
          items: [{ id: chapterId, status: "rejected", reason }],
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
      this.logger.info("novel_publication_tool.chapter.write.completed", {
        conversationId,
        appliedCount: items.length,
        resultRevision: result.resultRevision,
      });
      return { items, revision: { currentRevision: result.resultRevision } };
    } catch (error) {
      this.logger.info("novel_publication_tool.chapter.write.failed", {
        conversationId,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw new ToolError({
        code: "NOVEL_PUBLICATION_CHAPTER_WRITE_FAILED",
        category: "execution",
        retryable: true,
        sideEffectStatus: "none",
        conversationId,
      });
    }
  }

  async editChapters(
    conversationId: string,
    arguments_: NovelChapterEditArguments,
  ): Promise<NovelChapterWriteDetails> {
    const scope = canonicalNovelReadScope;
    const currentRevision =
      await this.options.canonicalWrites.getCurrentRevision();
    const baseRevision =
      arguments_.baseRevision === undefined
        ? undefined
        : captureNovelRevision(arguments_.baseRevision);
    const operations: NovelOperation[] = [];
    const items: NovelPublicationItemDetails[] = [];
    for (const patch of arguments_.values) {
      try {
        await this.appendChapterEdit({
          scope,
          id: patch.id,
          patch: patch.value,
          operations,
        });
        items.push({ id: patch.id, status: "applied" });
      } catch (error) {
        const reason = mapItemError(error);
        if (reason === undefined) {
          throw new ToolError({
            code: "NOVEL_PUBLICATION_CHAPTER_EDIT_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId,
          });
        }
        this.logger.info(
          "novel_publication_tool.chapter.edit.rejected_batch",
          { conversationId, reason },
        );
        return {
          items: [{ id: patch.id, status: "rejected", reason }],
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
      this.logger.info("novel_publication_tool.chapter.edit.completed", {
        conversationId,
        appliedCount: items.length,
        resultRevision: result.resultRevision,
      });
      return { items, revision: { currentRevision: result.resultRevision } };
    } catch (error) {
      this.logger.info("novel_publication_tool.chapter.edit.failed", {
        conversationId,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw new ToolError({
        code: "NOVEL_PUBLICATION_CHAPTER_EDIT_FAILED",
        category: "execution",
        retryable: true,
        sideEffectStatus: "none",
        conversationId,
      });
    }
  }

  private async appendVolumeWrite(input: {
    readonly scope: NovelReadScope;
    readonly publication: { readonly id: PublicationStructureId };
    readonly value: VolumeWriteValue;
    readonly volumeId: PublicationVolumeId;
    readonly operations: NovelOperation[];
  }): Promise<void> {
    const { scope, publication, value, volumeId, operations } = input;
    const existing = await this.options.publicationQueries.getVolume(scope, volumeId);
    if (existing !== undefined) {
      throw new NovelPublicationItemFailure(ITEM_REJECTION.duplicateId);
    }
    const orderKey = value.orderKey === undefined
      ? await this.appendVolumeOrderKey(scope, publication.id)
      : captureOrderKey(value.orderKey);
    operations.push(
      createPublicationVolumeCreateOperation({
        operationId: this.options.identityFactory.createOperationId(),
        volume: capturePublicationVolume({
        id: volumeId,
        publicationId: publication.id,
        orderKey,
        title: value.title,
        }),
      }),
    );
  }

  private async appendVolumeEdit(input: {
    readonly scope: NovelReadScope;
    readonly id: string;
    readonly patch: NovelVolumeEditValue;
    readonly operations: NovelOperation[];
  }): Promise<void> {
    const id = capturePublicationVolumeId(input.id);
    const current = await this.options.publicationQueries.getVolume(
      input.scope,
      id,
    );
    if (current === undefined) {
      throw new NovelPublicationItemFailure(ITEM_REJECTION.notFound);
    }
    const merged = capturePublicationVolume({
      id: current.volume.id,
      publicationId: current.volume.publicationId,
      orderKey:
        input.patch.orderKey === undefined
          ? current.volume.orderKey
          : captureOrderKey(input.patch.orderKey),
      title: input.patch.title ?? current.volume.title,
    });
    if (
      merged.orderKey === current.volume.orderKey &&
      merged.title === current.volume.title
    ) {
      return;
    }
    input.operations.push(
      createPublicationVolumeReplaceOperation({
        operationId: this.options.identityFactory.createOperationId(),
        volume: merged,
        expectedRecordDigest: current.recordDigest,
      }),
    );
  }

  private async appendChapterWrite(input: {
    readonly scope: NovelReadScope;
    readonly publication: { readonly id: PublicationStructureId };
    readonly value: ChapterWriteValue;
    readonly chapterId: PublicationChapterId;
    readonly operations: NovelOperation[];
  }): Promise<void> {
    const { scope, publication, value, chapterId, operations } = input;
    const existing = await this.options.publicationQueries.getChapter(scope, chapterId);
    if (existing !== undefined) {
      throw new NovelPublicationItemFailure(ITEM_REJECTION.duplicateId);
    }
    const volumeId = capturePublicationVolumeId(value.volumeId);
    const volume = await this.options.publicationQueries.getVolume(scope, volumeId);
    if (volume === undefined) {
      throw new NovelPublicationItemFailure(ITEM_REJECTION.unknownVolume);
    }
    const orderKey = value.orderKey === undefined
      ? await this.appendChapterOrderKey(scope, volumeId)
      : captureOrderKey(value.orderKey);
    operations.push(
      createPublicationChapterCreateOperation({
        operationId: this.options.identityFactory.createOperationId(),
        chapter: capturePublicationChapter({
        id: chapterId,
        publicationId: publication.id,
        volumeId,
        orderKey,
        title: value.title ?? "Untitled Chapter",
        paragraphIds: value.paragraphIds ?? [],
        }),
      }),
    );
  }

  private async appendChapterEdit(input: {
    readonly scope: NovelReadScope;
    readonly id: string;
    readonly patch: NovelChapterEditValue;
    readonly operations: NovelOperation[];
  }): Promise<void> {
    const id = capturePublicationChapterId(input.id);
    const current = await this.options.publicationQueries.getChapter(
      input.scope,
      id,
    );
    if (current === undefined) {
      throw new NovelPublicationItemFailure(ITEM_REJECTION.notFound);
    }
    const volumeId =
      input.patch.volumeId === undefined
        ? current.chapter.volumeId
        : capturePublicationVolumeId(input.patch.volumeId);
    if (input.patch.volumeId !== undefined) {
      const volume = await this.options.publicationQueries.getVolume(
        input.scope,
        volumeId,
      );
      if (volume === undefined) {
        throw new NovelPublicationItemFailure(ITEM_REJECTION.unknownVolume);
      }
    }
    const paragraphIds =
      input.patch.paragraphIds === undefined
        ? current.chapter.paragraphIds
        : input.patch.paragraphIds === null
          ? []
          : input.patch.paragraphIds;
    const merged = capturePublicationChapter({
      id: current.chapter.id,
      publicationId: current.chapter.publicationId,
      volumeId,
      orderKey:
        input.patch.orderKey === undefined
          ? current.chapter.orderKey
          : captureOrderKey(input.patch.orderKey),
      title: input.patch.title ?? current.chapter.title,
      paragraphIds,
    });
    if (
      merged.volumeId === current.chapter.volumeId &&
      merged.orderKey === current.chapter.orderKey &&
      merged.title === current.chapter.title &&
      sameIds(merged.paragraphIds, current.chapter.paragraphIds)
    ) {
      return;
    }
    input.operations.push(
      createPublicationChapterReplaceOperation({
        operationId: this.options.identityFactory.createOperationId(),
        chapter: merged,
        expectedRecordDigest: current.recordDigest,
      }),
    );
  }

  private async ensurePublication(
    scope: NovelReadScope,
    operations: NovelOperation[],
  ): Promise<{ readonly id: PublicationStructureId }> {
    const catalog = await this.options.publicationQueries.getCatalog(scope);
    if (catalog !== undefined) {
      return catalog.snapshot.publication;
    }
    const publicationId = this.options.identityFactory.createPublicationStructureId();
    operations.push(
      createPublicationCreateOperation({
        operationId: this.options.identityFactory.createOperationId(),
        publication: {
          id: publicationId,
          novelId: this.options.novelId,
        },
      }),
    );
    return Object.freeze({ id: publicationId });
  }

  private async appendVolumeOrderKey(
    scope: NovelReadScope,
    publicationId: PublicationStructureId,
  ): Promise<OrderKey> {
    const catalog = await this.options.publicationQueries.getCatalog(scope);
    const volumes = (catalog?.snapshot.volumes ?? []).filter(
      (volume) => volume.publicationId === publicationId,
    );
    const last = volumes.at(-1);
    return last === undefined
      ? this.orderKeys.initial()
      : this.orderKeys.after(last.orderKey);
  }

  private async appendChapterOrderKey(
    scope: NovelReadScope,
    volumeId: PublicationVolumeId,
  ): Promise<OrderKey> {
    const chapters = await this.options.publicationQueries.listChapters(scope, volumeId);
    const last = chapters.at(-1);
    return last === undefined
      ? this.orderKeys.initial()
      : this.orderKeys.after(last.chapter.orderKey);
  }

}

class NovelPublicationItemFailure extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "NovelPublicationItemFailure";
  }
}

function rejectedItem(
  id: string,
  reason: string,
): NovelPublicationItemDetails {
  return Object.freeze({ id, status: "rejected", reason });
}

function mapItemError(error: unknown): string | undefined {
  if (error instanceof NovelPublicationItemFailure) return error.reason;
  if (error instanceof NovelProtocolValidationError) {
    return ITEM_REJECTION.invalidValue;
  }
  if (error instanceof NovelOperationPreconditionError) {
    return ITEM_REJECTION.preconditionFailed;
  }
  return undefined;
}

function toVolumeDetails(
  volume: { id: PublicationVolumeId; title: string; orderKey: OrderKey },
): NovelVolumeDetails {
  return Object.freeze({
    id: volume.id,
    title: volume.title,
    orderKey: volume.orderKey,
  });
}

function toChapterDetails(
  chapter: {
    id: PublicationChapterId;
    volumeId: PublicationVolumeId;
    title: string;
    orderKey: OrderKey;
    paragraphIds: readonly string[];
  },
  paragraphById: ReadonlyMap<string, Paragraph> | undefined,
): NovelChapterDetails {
  const paragraphIds = [...chapter.paragraphIds];
  if (paragraphById !== undefined) {
    const paragraphs = paragraphIds
      .map((id) => paragraphById.get(id))
      .filter((paragraph): paragraph is Paragraph => paragraph !== undefined);
    return {
      id: chapter.id,
      volumeId: chapter.volumeId,
      title: chapter.title,
      orderKey: chapter.orderKey,
      paragraphIds,
      paragraphs: paragraphs.map((paragraph) => ({
        id: paragraph.id,
        storyUnitId: paragraph.storyUnitId,
        orderKey: paragraph.orderKey,
        text: paragraph.text,
      })),
      content: paragraphs.map((paragraph) => paragraph.text).join("\n"),
    };
  }
  return {
    id: chapter.id,
    volumeId: chapter.volumeId,
    title: chapter.title,
    orderKey: chapter.orderKey,
    paragraphIds,
  };
}

function indexParagraphs(
  paragraphs: readonly Paragraph[],
): ReadonlyMap<string, Paragraph> {
  return new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph]));
}

function sameIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
