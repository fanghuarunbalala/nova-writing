/** Canonical Paragraph mutation service emitting deterministic Operations. */
import { noopLogger, type Logger } from "../../observability/index.js";
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
import type {
  NovelCanonicalWritePort,
  NovelCanonicalWriteResult,
} from "../port/index.js";
import { captureNovelRevision, type NovelRevision } from "../version/index.js";

export interface ParagraphServiceOptions {
  readonly canonicalWrites: NovelCanonicalWritePort;
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
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    paragraph: Paragraph,
  ): Promise<NovelCanonicalWriteResult> {
    const value = captureParagraph(paragraph);
    return this.execute(conversationId, baseRevision, createParagraphCreateOperation({
      operationId: this.operationId(), paragraph: value,
    }), "paragraph.create", { storyUnitId: value.storyUnitId, paragraphId: value.id });
  }

  replaceText(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    paragraphId: ParagraphId,
    expectedTextDigest: string,
    text: string,
  ): Promise<NovelCanonicalWriteResult> {
    const id = captureParagraphId(paragraphId);
    return this.execute(conversationId, baseRevision, createParagraphTextReplaceOperation({
      operationId: this.operationId(), paragraphId: id,
      expectedTextDigest, text: captureParagraphText(text),
    }), "paragraph.text.replace", { paragraphId: id });
  }

  replaceOrder(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    paragraphId: ParagraphId,
    expectedOrderDigest: string,
    orderKey: OrderKey,
  ): Promise<NovelCanonicalWriteResult> {
    const id = captureParagraphId(paragraphId);
    return this.execute(conversationId, baseRevision, createParagraphOrderReplaceOperation({
      operationId: this.operationId(), paragraphId: id,
      expectedOrderDigest, orderKey: captureOrderKey(orderKey),
    }), "paragraph.order.replace", { paragraphId: id });
  }

  replaceStoryUnit(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    paragraphId: ParagraphId,
    expectedStoryUnitDigest: string,
    storyUnitId: StoryUnitId,
  ): Promise<NovelCanonicalWriteResult> {
    const id = captureParagraphId(paragraphId);
    const target = captureStoryUnitId(storyUnitId);
    return this.execute(conversationId, baseRevision, createParagraphStoryUnitReplaceOperation({
      operationId: this.operationId(), paragraphId: id,
      expectedStoryUnitDigest, storyUnitId: target,
    }), "paragraph.story-unit.replace", { paragraphId: id, storyUnitId: target });
  }

  deleteParagraph(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    paragraphId: ParagraphId,
    expectedTextDigest: string,
    expectedOrderDigest: string,
    expectedStoryUnitDigest: string,
  ): Promise<NovelCanonicalWriteResult> {
    const id = captureParagraphId(paragraphId);
    return this.execute(conversationId, baseRevision, createParagraphDeleteOperation({
      operationId: this.operationId(), paragraphId: id,
      expectedTextDigest, expectedOrderDigest, expectedStoryUnitDigest,
    }), "paragraph.delete", { paragraphId: id });
  }

  private operationId(): NovelOperationId {
    return this.options.identityFactory.createOperationId();
  }

  private async execute(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    operation: NovelOperation,
    action: string,
    identities: Readonly<Record<string, string>>,
  ): Promise<NovelCanonicalWriteResult> {
    this.logger.debug("novel_paragraph.mutation.started", {
      operationId: operation.operationId, action, ...identities,
    });
    const result = await this.options.canonicalWrites.applyOperations({
      operations: [operation],
      conversationId,
      ...(baseRevision === undefined
        ? {}
        : { baseRevision: captureNovelRevision(baseRevision) }),
    });
    this.logger.info("novel_paragraph.mutation.completed", {
      operationId: operation.operationId, action,
      resultRevision: result.resultRevision, status: result.status,
      ...identities,
    });
    return result;
  }
}
