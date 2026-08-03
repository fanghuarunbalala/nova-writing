/** Draft-only Publication mutation service that emits deterministic Operations. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  captureNovelDraftSession,
  type NovelDraftSession,
} from "../draft/index.js";
import {
  capturePublicationChapterId,
  capturePublicationStructureId,
  capturePublicationVolumeId,
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
import type { NovelDraftOperationReceipt } from "../port/index.js";
import type { NovelMutationService } from "./NovelMutationService.js";

export interface PublicationServiceOptions {
  readonly mutations: NovelMutationService;
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
    session: NovelDraftSession,
    id: PublicationStructureId,
  ): Promise<NovelDraftOperationReceipt> {
    const draft = captureNovelDraftSession(session);
    const publicationId = capturePublicationStructureId(id);
    return this.execute(
      draft,
      createPublicationCreateOperation({
        operationId: this.options.identityFactory.createOperationId(),
        publication: { id: publicationId, novelId: draft.novelId },
      }),
      "create",
      { publicationId },
    );
  }

  createVolume(
    session: NovelDraftSession,
    volume: PublicationVolume,
  ): Promise<NovelDraftOperationReceipt> {
    const draft = captureNovelDraftSession(session);
    const value = capturePublicationVolume(volume);
    return this.execute(
      draft,
      createPublicationVolumeCreateOperation({
        operationId: this.options.identityFactory.createOperationId(),
        volume: value,
      }),
      "volume.create",
      { publicationId: value.publicationId, volumeId: value.id },
    );
  }

  replaceVolume(
    session: NovelDraftSession,
    volume: PublicationVolume,
    expectedRecordDigest: string,
  ): Promise<NovelDraftOperationReceipt> {
    const draft = captureNovelDraftSession(session);
    const value = capturePublicationVolume(volume);
    return this.execute(
      draft,
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
    session: NovelDraftSession,
    id: PublicationVolumeId,
    expectedRecordDigest: string,
  ): Promise<NovelDraftOperationReceipt> {
    const draft = captureNovelDraftSession(session);
    const volumeId = capturePublicationVolumeId(id);
    return this.execute(
      draft,
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
    session: NovelDraftSession,
    chapter: PublicationChapter,
  ): Promise<NovelDraftOperationReceipt> {
    const draft = captureNovelDraftSession(session);
    const value = capturePublicationChapter(chapter);
    return this.execute(
      draft,
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
    session: NovelDraftSession,
    chapter: PublicationChapter,
    expectedRecordDigest: string,
  ): Promise<NovelDraftOperationReceipt> {
    const draft = captureNovelDraftSession(session);
    const value = capturePublicationChapter(chapter);
    return this.execute(
      draft,
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
    session: NovelDraftSession,
    id: PublicationChapterId,
    expectedRecordDigest: string,
  ): Promise<NovelDraftOperationReceipt> {
    const draft = captureNovelDraftSession(session);
    const chapterId = capturePublicationChapterId(id);
    return this.execute(
      draft,
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
    session: NovelDraftSession,
    operation: Parameters<NovelMutationService["execute"]>[1],
    action: string,
    identities: Readonly<Record<string, string>>,
  ): Promise<NovelDraftOperationReceipt> {
    this.logger.debug("novel_publication.mutation.started", {
      novelId: session.novelId,
      draftSessionId: session.id,
      operationId: operation.operationId,
      action,
      ...identities,
    });
    const receipt = await this.options.mutations.execute(session, operation);
    this.logger.info("novel_publication.mutation.completed", {
      novelId: session.novelId,
      draftSessionId: session.id,
      operationId: operation.operationId,
      action,
      sequence: receipt.sequence,
      status: receipt.status,
      ...identities,
    });
    return receipt;
  }
}
