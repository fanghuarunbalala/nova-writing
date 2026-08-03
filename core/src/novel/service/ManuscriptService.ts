/** Draft-only Manuscript mutation service covering writing and structural repair. */
import { noopLogger, type Logger } from "../../observability/index.js";
import { captureNovelDraftSession, type NovelDraftSession } from "../draft/index.js";
import {
  captureManuscriptBlockId,
  captureManuscriptId,
  capturePublicationStructureId,
  type ManuscriptBlockId,
  type ManuscriptId,
  type NovelOperationId,
  type PublicationStructureId,
} from "../identity/index.js";
import {
  captureManuscriptAnchor,
  captureManuscriptText,
  captureOrderKey,
  captureParagraphBlock,
  type ManuscriptAnchor,
  type OrderKey,
  type ParagraphBlock,
} from "../model/index.js";
import {
  createManuscriptAnchorRepairOperation,
  createManuscriptBlockCreateOperation,
  createManuscriptBlockDeleteOperation,
  createManuscriptBlockMergeOperation,
  createManuscriptBlockMoveOperation,
  createManuscriptBlockSplitOperation,
  createManuscriptBlockTextReplaceOperation,
  createManuscriptCreateOperation,
  type NovelOperation,
} from "../operation/index.js";
import type { NovelDraftOperationReceipt } from "../port/index.js";
import type { NovelMutationService } from "./NovelMutationService.js";

export interface ManuscriptServiceOptions {
  readonly mutations: NovelMutationService;
  readonly identityFactory: { createOperationId(): NovelOperationId };
  readonly logger?: Logger;
}

export class ManuscriptService {
  private readonly logger: Logger;

  constructor(private readonly options: ManuscriptServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({ component: "novel_manuscript_service" });
  }

  createManuscript(
    session: NovelDraftSession,
    id: ManuscriptId,
    publicationIdInput: PublicationStructureId,
  ) {
    const draft = captureNovelDraftSession(session);
    const manuscriptId = captureManuscriptId(id);
    const publicationId = capturePublicationStructureId(publicationIdInput);
    return this.execute(draft, createManuscriptCreateOperation({
      operationId: this.operationId(),
      manuscript: { id: manuscriptId, novelId: draft.novelId, publicationId },
    }), "create", { manuscriptId });
  }

  createBlock(session: NovelDraftSession, block: ParagraphBlock) {
    const value = captureParagraphBlock(block);
    return this.execute(session, createManuscriptBlockCreateOperation({
      operationId: this.operationId(), block: value,
    }), "block.create", { manuscriptId: value.manuscriptId, blockId: value.id });
  }

  replaceBlockText(session: NovelDraftSession, blockId: ManuscriptBlockId, expectedTextDigest: string, text: string) {
    const id = captureManuscriptBlockId(blockId);
    return this.execute(session, createManuscriptBlockTextReplaceOperation({
      operationId: this.operationId(), blockId: id, expectedTextDigest, text: captureManuscriptText(text),
    }), "block.text.replace", { blockId: id });
  }

  moveBlock(session: NovelDraftSession, input: Parameters<typeof createManuscriptBlockMoveOperation>[0] extends infer T ? Omit<T & object, "operationId"> : never) {
    const blockId = captureManuscriptBlockId(input.blockId);
    return this.execute(session, createManuscriptBlockMoveOperation({
      ...input,
      operationId: this.operationId(),
      blockId,
      chapterId: input.chapterId,
      orderKey: captureOrderKey(input.orderKey),
    }), "block.move", { blockId });
  }

  splitBlock(session: NovelDraftSession, input: {
    blockId: ManuscriptBlockId; expectedTextDigest: string; leftText: string; rightBlock: ParagraphBlock;
  }) {
    const blockId = captureManuscriptBlockId(input.blockId);
    return this.execute(session, createManuscriptBlockSplitOperation({
      operationId: this.operationId(), blockId, expectedTextDigest: input.expectedTextDigest,
      leftText: captureManuscriptText(input.leftText), rightBlock: captureParagraphBlock(input.rightBlock),
    }), "block.split", { blockId, rightBlockId: input.rightBlock.id });
  }

  mergeBlocks(session: NovelDraftSession, input: Omit<Parameters<typeof createManuscriptBlockMergeOperation>[0], "operationId">) {
    const leftBlockId = captureManuscriptBlockId(input.leftBlockId);
    const rightBlockId = captureManuscriptBlockId(input.rightBlockId);
    return this.execute(session, createManuscriptBlockMergeOperation({
      ...input, operationId: this.operationId(), leftBlockId, rightBlockId,
    }), "block.merge", { leftBlockId, rightBlockId });
  }

  deleteBlock(session: NovelDraftSession, input: Omit<Parameters<typeof createManuscriptBlockDeleteOperation>[0], "operationId">) {
    const blockId = captureManuscriptBlockId(input.blockId);
    return this.execute(session, createManuscriptBlockDeleteOperation({
      ...input, operationId: this.operationId(), blockId,
    }), "block.delete", { blockId });
  }

  repairAnchor(session: NovelDraftSession, source: ManuscriptAnchor, target: ManuscriptAnchor) {
    const capturedSource = captureManuscriptAnchor(source);
    return this.execute(session, createManuscriptAnchorRepairOperation({
      operationId: this.operationId(), source: capturedSource, target: captureManuscriptAnchor(target),
    }), "anchor.repair", { blockId: capturedSource.blockId });
  }

  private operationId(): NovelOperationId { return this.options.identityFactory.createOperationId(); }

  private async execute(
    sessionInput: NovelDraftSession,
    operation: NovelOperation,
    action: string,
    identities: Readonly<Record<string, string>>,
  ): Promise<NovelDraftOperationReceipt> {
    const session = captureNovelDraftSession(sessionInput);
    this.logger.debug("novel_manuscript.mutation.started", {
      novelId: session.novelId, draftSessionId: session.id, operationId: operation.operationId, action, ...identities,
    });
    const receipt = await this.options.mutations.execute(session, operation);
    this.logger.info("novel_manuscript.mutation.completed", {
      novelId: session.novelId, draftSessionId: session.id, operationId: operation.operationId,
      action, sequence: receipt.sequence, status: receipt.status, ...identities,
    });
    return receipt;
  }
}
