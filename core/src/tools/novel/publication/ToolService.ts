/**
 * Provider-neutral Novel Publication tool semantics: read Volumes with their
 * Chapters, batch create/update Volumes and Chapters, and optionally expand a
 * Chapter's ordered Paragraph selection into full content. Digests stay
 * inside the host; the publication root is auto-created on first write.
 */
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  FractionalOrderKeyFactory,
  NovelDraftSessionService,
  NovelOperationPreconditionError,
  NovelProtocolValidationError,
  ParagraphQueryService,
  PublicationQueryService,
  PublicationService,
  canonicalNovelReadScope,
  captureNovelId,
  captureOrderKey,
  capturePublicationChapter,
  capturePublicationChapterId,
  capturePublicationStructureId,
  capturePublicationVolume,
  capturePublicationVolumeId,
  draftNovelReadScope,
  type NovelDraftSession,
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
  readonly publication: PublicationService;
  readonly publicationQueries: PublicationQueryService;
  readonly paragraphs: ParagraphQueryService;
  readonly drafts: NovelDraftSessionService;
  readonly identityFactory: {
    createPublicationStructureId(): PublicationStructureId;
    createPublicationVolumeId(): PublicationVolumeId;
    createPublicationChapterId(): PublicationChapterId;
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
    const scope = await this.resolveReadScope(conversationId, arguments_.scope);
    if (scope === undefined) {
      return { volumes: [] };
    }
    const catalog = await this.options.publicationQueries.getCatalog(scope);
    if (catalog === undefined) {
      return { volumes: [] };
    }
    return {
      volumes: catalog.snapshot.volumes.map((volume) => toVolumeDetails(volume)),
    };
  }

  async readChapters(
    conversationId: string,
    arguments_: NovelChapterReadArguments,
  ): Promise<NovelChapterReadDetails> {
    const scope = await this.resolveReadScope(conversationId, arguments_.scope);
    if (scope === undefined) {
      return { chapters: [] };
    }
    const catalog = await this.options.publicationQueries.getCatalog(scope);
    if (catalog === undefined) {
      return { chapters: [] };
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
    };
  }

  async writeVolumes(
    conversationId: string,
    arguments_: NovelVolumeWriteArguments,
  ): Promise<NovelVolumeWriteDetails> {
    const session = await this.resolveOrStartDraft(conversationId);
    const scope = draftNovelReadScope(session);
    const publication = await this.ensurePublication(session, scope);
    const items: NovelPublicationItemDetails[] = [];
    this.logger.info("novel_publication_tool.volume.write.started", {
      conversationId,
      draftSessionId: session.id,
      requestedCount: arguments_.values.length,
    });
    for (const value of arguments_.values) {
      const volumeId = capturePublicationVolumeId(
        value.id ?? this.options.identityFactory.createPublicationVolumeId(),
      );
      try {
        items.push(await this.writeVolumeOne(session, scope, publication, value, volumeId));
      } catch (error) {
        const reason = mapItemError(error);
        if (reason === undefined) {
          throw new ToolError({
            code: "NOVEL_PUBLICATION_VOLUME_WRITE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId,
          });
        }
        items.push(rejectedItem(volumeId, reason));
        break;
      }
    }
    this.logger.info("novel_publication_tool.volume.write.completed", {
      conversationId,
      draftSessionId: session.id,
      appliedCount: items.filter((item) => item.status === "appended").length,
      rejectedCount: items.filter((item) => item.status === "rejected").length,
    });
    return { items };
  }

  async editVolumes(
    conversationId: string,
    arguments_: NovelVolumeEditArguments,
  ): Promise<NovelVolumeWriteDetails> {
    const session = await this.resolveOrStartDraft(conversationId);
    const scope = draftNovelReadScope(session);
    const items: NovelPublicationItemDetails[] = [];
    for (const patch of arguments_.values) {
      try {
        items.push(await this.editVolumeOne(session, scope, patch.id, patch.value));
      } catch (error) {
        const reason = mapItemError(error);
        if (reason === undefined) {
          throw new ToolError({
            code: "NOVEL_PUBLICATION_VOLUME_EDIT_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId,
          });
        }
        items.push(rejectedItem(patch.id, reason));
        break;
      }
    }
    return { items };
  }

  async writeChapters(
    conversationId: string,
    arguments_: NovelChapterWriteArguments,
  ): Promise<NovelChapterWriteDetails> {
    const session = await this.resolveOrStartDraft(conversationId);
    const scope = draftNovelReadScope(session);
    const publication = await this.ensurePublication(session, scope);
    const items: NovelPublicationItemDetails[] = [];
    this.logger.info("novel_publication_tool.chapter.write.started", {
      conversationId,
      draftSessionId: session.id,
      requestedCount: arguments_.values.length,
    });
    for (const value of arguments_.values) {
      const chapterId = capturePublicationChapterId(
        value.id ?? this.options.identityFactory.createPublicationChapterId(),
      );
      try {
        items.push(await this.writeChapterOne(session, scope, publication, value, chapterId));
      } catch (error) {
        const reason = mapItemError(error);
        if (reason === undefined) {
          throw new ToolError({
            code: "NOVEL_PUBLICATION_CHAPTER_WRITE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId,
          });
        }
        items.push(rejectedItem(chapterId, reason));
        break;
      }
    }
    this.logger.info("novel_publication_tool.chapter.write.completed", {
      conversationId,
      draftSessionId: session.id,
      appliedCount: items.filter((item) => item.status === "appended").length,
      rejectedCount: items.filter((item) => item.status === "rejected").length,
    });
    return { items };
  }

  async editChapters(
    conversationId: string,
    arguments_: NovelChapterEditArguments,
  ): Promise<NovelChapterWriteDetails> {
    const session = await this.resolveOrStartDraft(conversationId);
    const scope = draftNovelReadScope(session);
    const items: NovelPublicationItemDetails[] = [];
    for (const patch of arguments_.values) {
      try {
        items.push(await this.editChapterOne(session, scope, patch.id, patch.value));
      } catch (error) {
        const reason = mapItemError(error);
        if (reason === undefined) {
          throw new ToolError({
            code: "NOVEL_PUBLICATION_CHAPTER_EDIT_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId,
          });
        }
        items.push(rejectedItem(patch.id, reason));
        break;
      }
    }
    return { items };
  }

  private async writeVolumeOne(
    session: NovelDraftSession,
    scope: NovelReadScope,
    publication: { readonly id: PublicationStructureId },
    value: VolumeWriteValue,
    volumeId: PublicationVolumeId,
  ): Promise<NovelPublicationItemDetails> {
    const existing = await this.options.publicationQueries.getVolume(scope, volumeId);
    if (existing !== undefined) {
      throw new NovelPublicationItemFailure(ITEM_REJECTION.duplicateId);
    }
    const orderKey = value.orderKey === undefined
      ? await this.appendVolumeOrderKey(scope, publication.id)
      : captureOrderKey(value.orderKey);
    const receipt = await this.options.publication.createVolume(
      session,
      capturePublicationVolume({
        id: volumeId,
        publicationId: publication.id,
        orderKey,
        title: value.title,
      }),
    );
    return Object.freeze({ id: volumeId, status: "appended", sequence: receipt.sequence });
  }

  private async editVolumeOne(
    session: NovelDraftSession,
    scope: NovelReadScope,
    idInput: string,
    patch: NovelVolumeEditValue,
  ): Promise<NovelPublicationItemDetails> {
    const id = capturePublicationVolumeId(idInput);
    const current = await this.options.publicationQueries.getVolume(scope, id);
    if (current === undefined) {
      throw new NovelPublicationItemFailure(ITEM_REJECTION.notFound);
    }
    const merged = capturePublicationVolume({
      id: current.volume.id,
      publicationId: current.volume.publicationId,
      orderKey:
        patch.orderKey === undefined
          ? current.volume.orderKey
          : captureOrderKey(patch.orderKey),
      title: patch.title ?? current.volume.title,
    });
    if (
      merged.orderKey === current.volume.orderKey &&
      merged.title === current.volume.title
    ) {
      return Object.freeze({ id, status: "duplicate" });
    }
    const receipt = await this.options.publication.replaceVolume(
      session,
      merged,
      current.recordDigest,
    );
    return Object.freeze({ id, status: "updated", sequence: receipt.sequence });
  }

  private async writeChapterOne(
    session: NovelDraftSession,
    scope: NovelReadScope,
    publication: { readonly id: PublicationStructureId },
    value: ChapterWriteValue,
    chapterId: PublicationChapterId,
  ): Promise<NovelPublicationItemDetails> {
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
    const receipt = await this.options.publication.createChapter(
      session,
      capturePublicationChapter({
        id: chapterId,
        publicationId: publication.id,
        volumeId,
        orderKey,
        title: value.title ?? "Untitled Chapter",
        paragraphIds: value.paragraphIds ?? [],
      }),
    );
    return Object.freeze({ id: chapterId, status: "appended", sequence: receipt.sequence });
  }

  private async editChapterOne(
    session: NovelDraftSession,
    scope: NovelReadScope,
    idInput: string,
    patch: NovelChapterEditValue,
  ): Promise<NovelPublicationItemDetails> {
    const id = capturePublicationChapterId(idInput);
    const current = await this.options.publicationQueries.getChapter(scope, id);
    if (current === undefined) {
      throw new NovelPublicationItemFailure(ITEM_REJECTION.notFound);
    }
    const volumeId =
      patch.volumeId === undefined
        ? current.chapter.volumeId
        : capturePublicationVolumeId(patch.volumeId);
    if (patch.volumeId !== undefined) {
      const volume = await this.options.publicationQueries.getVolume(scope, volumeId);
      if (volume === undefined) {
        throw new NovelPublicationItemFailure(ITEM_REJECTION.unknownVolume);
      }
    }
    const paragraphIds =
      patch.paragraphIds === undefined
        ? current.chapter.paragraphIds
        : patch.paragraphIds === null
          ? []
          : patch.paragraphIds;
    const merged = capturePublicationChapter({
      id: current.chapter.id,
      publicationId: current.chapter.publicationId,
      volumeId,
      orderKey:
        patch.orderKey === undefined
          ? current.chapter.orderKey
          : captureOrderKey(patch.orderKey),
      title: patch.title ?? current.chapter.title,
      paragraphIds,
    });
    if (
      merged.volumeId === current.chapter.volumeId &&
      merged.orderKey === current.chapter.orderKey &&
      merged.title === current.chapter.title &&
      sameIds(merged.paragraphIds, current.chapter.paragraphIds)
    ) {
      return Object.freeze({ id, status: "duplicate" });
    }
    const receipt = await this.options.publication.replaceChapter(
      session,
      merged,
      current.recordDigest,
    );
    return Object.freeze({ id, status: "updated", sequence: receipt.sequence });
  }

  private async ensurePublication(
    session: NovelDraftSession,
    scope: NovelReadScope,
  ): Promise<{ readonly id: PublicationStructureId }> {
    const catalog = await this.options.publicationQueries.getCatalog(scope);
    if (catalog !== undefined) {
      return catalog.snapshot.publication;
    }
    const publicationId = this.options.identityFactory.createPublicationStructureId();
    await this.options.publication.createPublication(session, publicationId);
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

  private async resolveOrStartDraft(
    conversationId: string,
  ): Promise<NovelDraftSession> {
    const existing = await this.options.drafts.getActiveDraft(conversationId);
    if (existing !== undefined) return existing;
    try {
      return await this.options.drafts.startDraft(conversationId);
    } catch {
      this.logger.warn("novel_publication_tool.draft.start_failed", {
        conversationId,
      });
      throw new ToolError({
        code: "NOVEL_DRAFT_START_FAILED",
        category: "execution",
        retryable: true,
        sideEffectStatus: "possible",
        conversationId,
      });
    }
  }

  private async resolveReadScope(
    conversationId: string,
    scope: NovelVolumeReadArguments["scope"] | NovelChapterReadArguments["scope"],
  ): Promise<NovelReadScope | undefined> {
    if (scope === "canonical") return canonicalNovelReadScope;
    const session = await this.options.drafts.getActiveDraft(conversationId);
    return session === undefined ? undefined : draftNovelReadScope(session);
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
