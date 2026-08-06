/** Canonical Publication mutation service that emits deterministic Operations. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  capturePublicationChapterId,
  capturePublicationStructureId,
  capturePublicationVolumeId,
  type NovelId,
  type NovelOperationId,
  type PublicationChapterId,
  type PublicationStructureId,
  type PublicationVolumeId,
} from "../identity/index.js";
import {
  capturePublicationChapter,
  capturePublicationVolume,
  type PublicationChapter,
  type PublicationVolume,
} from "../model/index.js";
import {
  createPublicationChapterCreateOperation,
  createPublicationChapterDeleteOperation,
  createPublicationChapterReplaceOperation,
  createPublicationCreateOperation,
  createPublicationVolumeCreateOperation,
  createPublicationVolumeDeleteOperation,
  createPublicationVolumeReplaceOperation,
} from "../operation/index.js";
import type {
  NovelCanonicalWritePort,
  NovelCanonicalWriteResult,
} from "../port/index.js";
import { captureNovelRevision, type NovelRevision } from "../version/index.js";
import type { NovelOperation } from "../operation/index.js";

export interface PublicationServiceOptions {
  readonly novelId: NovelId;
  readonly canonicalWrites: NovelCanonicalWritePort;
  readonly identityFactory: {
    createOperationId(): NovelOperationId;
  };
  readonly logger?: Logger;
}

export class PublicationService {
  private readonly logger: Logger;

  constructor(private readonly options: PublicationServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_publication_service",
    });
  }

  createPublication(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    id: PublicationStructureId,
  ): Promise<NovelCanonicalWriteResult> {
    const publicationId = capturePublicationStructureId(id);
    return this.execute(
      conversationId,
      baseRevision,
      createPublicationCreateOperation({
        operationId: this.options.identityFactory.createOperationId(),
        publication: { id: publicationId, novelId: this.options.novelId },
      }),
      "create",
      { publicationId },
    );
  }

  createVolume(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    volume: PublicationVolume,
  ): Promise<NovelCanonicalWriteResult> {
    const value = capturePublicationVolume(volume);
    return this.execute(
      conversationId,
      baseRevision,
      createPublicationVolumeCreateOperation({
        operationId: this.options.identityFactory.createOperationId(),
        volume: value,
      }),
      "volume.create",
      { publicationId: value.publicationId, volumeId: value.id },
    );
  }

  replaceVolume(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    volume: PublicationVolume,
    expectedRecordDigest: string,
  ): Promise<NovelCanonicalWriteResult> {
    const value = capturePublicationVolume(volume);
    return this.execute(
      conversationId,
      baseRevision,
      createPublicationVolumeReplaceOperation({
        operationId: this.options.identityFactory.createOperationId(),
        volume: value,
        expectedRecordDigest,
      }),
      "volume.replace",
      { publicationId: value.publicationId, volumeId: value.id },
    );
  }

  deleteVolume(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    id: PublicationVolumeId,
    expectedRecordDigest: string,
  ): Promise<NovelCanonicalWriteResult> {
    const volumeId = capturePublicationVolumeId(id);
    return this.execute(
      conversationId,
      baseRevision,
      createPublicationVolumeDeleteOperation({
        operationId: this.options.identityFactory.createOperationId(),
        id: volumeId,
        expectedRecordDigest,
      }),
      "volume.delete",
      { volumeId },
    );
  }

  createChapter(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    chapter: PublicationChapter,
  ): Promise<NovelCanonicalWriteResult> {
    const value = capturePublicationChapter(chapter);
    return this.execute(
      conversationId,
      baseRevision,
      createPublicationChapterCreateOperation({
        operationId: this.options.identityFactory.createOperationId(),
        chapter: value,
      }),
      "chapter.create",
      {
        publicationId: value.publicationId,
        volumeId: value.volumeId,
        chapterId: value.id,
      },
    );
  }

  replaceChapter(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    chapter: PublicationChapter,
    expectedRecordDigest: string,
  ): Promise<NovelCanonicalWriteResult> {
    const value = capturePublicationChapter(chapter);
    return this.execute(
      conversationId,
      baseRevision,
      createPublicationChapterReplaceOperation({
        operationId: this.options.identityFactory.createOperationId(),
        chapter: value,
        expectedRecordDigest,
      }),
      "chapter.replace",
      {
        publicationId: value.publicationId,
        volumeId: value.volumeId,
        chapterId: value.id,
      },
    );
  }

  deleteChapter(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    id: PublicationChapterId,
    expectedRecordDigest: string,
  ): Promise<NovelCanonicalWriteResult> {
    const chapterId = capturePublicationChapterId(id);
    return this.execute(
      conversationId,
      baseRevision,
      createPublicationChapterDeleteOperation({
        operationId: this.options.identityFactory.createOperationId(),
        id: chapterId,
        expectedRecordDigest,
      }),
      "chapter.delete",
      { chapterId },
    );
  }

  private async execute(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    operation: NovelOperation,
    action: string,
    identities: Readonly<Record<string, string>>,
  ): Promise<NovelCanonicalWriteResult> {
    this.logger.debug("novel_publication.mutation.started", {
      operationId: operation.operationId,
      action,
      ...identities,
    });
    const result = await this.options.canonicalWrites.applyOperations({
      operations: [operation],
      conversationId,
      ...(baseRevision === undefined
        ? {}
        : { baseRevision: captureNovelRevision(baseRevision) }),
    });
    this.logger.info("novel_publication.mutation.completed", {
      operationId: operation.operationId,
      action,
      resultRevision: result.resultRevision,
      status: result.status,
      ...identities,
    });
    return result;
  }
}
