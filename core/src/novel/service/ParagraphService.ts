/** Draft-only Paragraph mutation service emitting deterministic Operations. */
import { noopLogger, type Logger } from "../../observability/index.js";
import { captureNovelDraftSession, type NovelDraftSession } from "../draft/index.js";
import {
  captureParagraphId,
  captureStoryUnitId,
  type NovelOperationId,
  type ParagraphId,
  type StoryUnitId,
} from "../identity/index.js";
import {
  captureOrderKey,
  captureParagraph,
  captureParagraphText,
  type OrderKey,
  type Paragraph,
} from "../model/index.js";
import {
  createParagraphCreateOperation,
  createParagraphDeleteOperation,
  createParagraphOrderReplaceOperation,
  createParagraphStoryUnitReplaceOperation,
  createParagraphTextReplaceOperation,
  type NovelOperation,
} from "../operation/index.js";
import type { NovelDraftOperationReceipt } from "../port/index.js";
import type { NovelMutationService } from "./NovelMutationService.js";

export interface ParagraphServiceOptions {
  readonly mutations: NovelMutationService;
  readonly identityFactory: { createOperationId(): NovelOperationId };
  readonly logger?: Logger;
}

export class ParagraphService {
  private readonly logger: Logger;

  constructor(private readonly options: ParagraphServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_paragraph_service",
    });
  }

  createParagraph(
    session: NovelDraftSession,
    paragraph: Paragraph,
  ): Promise<NovelDraftOperationReceipt> {
    const value = captureParagraph(paragraph);
    return this.execute(session, createParagraphCreateOperation({
      operationId: this.operationId(), paragraph: value,
    }), "paragraph.create", { storyUnitId: value.storyUnitId, paragraphId: value.id });
  }

  replaceText(
    session: NovelDraftSession,
    paragraphId: ParagraphId,
    expectedTextDigest: string,
    text: string,
  ): Promise<NovelDraftOperationReceipt> {
    const id = captureParagraphId(paragraphId);
    return this.execute(session, createParagraphTextReplaceOperation({
      operationId: this.operationId(), paragraphId: id,
      expectedTextDigest, text: captureParagraphText(text),
    }), "paragraph.text.replace", { paragraphId: id });
  }

  replaceOrder(
    session: NovelDraftSession,
    paragraphId: ParagraphId,
    expectedOrderDigest: string,
    orderKey: OrderKey,
  ): Promise<NovelDraftOperationReceipt> {
    const id = captureParagraphId(paragraphId);
    return this.execute(session, createParagraphOrderReplaceOperation({
      operationId: this.operationId(), paragraphId: id,
      expectedOrderDigest, orderKey: captureOrderKey(orderKey),
    }), "paragraph.order.replace", { paragraphId: id });
  }

  replaceStoryUnit(
    session: NovelDraftSession,
    paragraphId: ParagraphId,
    expectedStoryUnitDigest: string,
    storyUnitId: StoryUnitId,
  ): Promise<NovelDraftOperationReceipt> {
    const id = captureParagraphId(paragraphId);
    const target = captureStoryUnitId(storyUnitId);
    return this.execute(session, createParagraphStoryUnitReplaceOperation({
      operationId: this.operationId(), paragraphId: id,
      expectedStoryUnitDigest, storyUnitId: target,
    }), "paragraph.story-unit.replace", { paragraphId: id, storyUnitId: target });
  }

  deleteParagraph(
    session: NovelDraftSession,
    paragraphId: ParagraphId,
    expectedTextDigest: string,
    expectedOrderDigest: string,
    expectedStoryUnitDigest: string,
  ): Promise<NovelDraftOperationReceipt> {
    const id = captureParagraphId(paragraphId);
    return this.execute(session, createParagraphDeleteOperation({
      operationId: this.operationId(), paragraphId: id,
      expectedTextDigest, expectedOrderDigest, expectedStoryUnitDigest,
    }), "paragraph.delete", { paragraphId: id });
  }

  private operationId(): NovelOperationId {
    return this.options.identityFactory.createOperationId();
  }

  private async execute(
    sessionInput: NovelDraftSession,
    operation: NovelOperation,
    action: string,
    identities: Readonly<Record<string, string>>,
  ): Promise<NovelDraftOperationReceipt> {
    const session = captureNovelDraftSession(sessionInput);
    this.logger.debug("novel_paragraph.mutation.started", {
      novelId: session.novelId, draftSessionId: session.id,
      operationId: operation.operationId, action, ...identities,
    });
    const receipt = await this.options.mutations.execute(session, operation);
    this.logger.info("novel_paragraph.mutation.completed", {
      novelId: session.novelId, draftSessionId: session.id,
      operationId: operation.operationId, action,
      sequence: receipt.sequence, status: receipt.status, ...identities,
    });
    return receipt;
  }
}
