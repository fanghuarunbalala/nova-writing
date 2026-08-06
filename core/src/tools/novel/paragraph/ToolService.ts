/**
 * Provider-neutral Novel Paragraph tool semantics: read Paragraphs by
 * StoryUnit, batch create with host-generated ids, and field-level PATCH
 * updates. StoryUnit-local OrderKeys and digests stay inside the host.
 */
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  FractionalOrderKeyFactory,
  NovelOperationPreconditionError,
  NovelProtocolValidationError,
  ParagraphQueryService,
  canonicalNovelReadScope,
  captureOrderKey,
  captureNovelRevision,
  captureParagraph,
  captureParagraphId,
  captureStoryUnitId,
  createParagraphCreateOperation,
  createParagraphOrderReplaceOperation,
  createParagraphStoryUnitReplaceOperation,
  createParagraphTextReplaceOperation,
  type NovelCanonicalWritePort,
  type NovelOperation,
  type NovelOperationId,
  type NovelReadScope,
  type ParagraphId,
  type StoryUnitId,
  type OrderKey,
} from "../../../novel/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import type {
  NovelParagraphDetails,
  NovelParagraphEditArguments,
  NovelParagraphEditValue,
  NovelParagraphItemDetails,
  NovelParagraphReadArguments,
  NovelParagraphReadDetails,
  NovelParagraphWriteArguments,
  NovelParagraphWriteDetails,
  ParagraphWriteValue,
} from "./schemas.js";

export interface NovelParagraphToolServiceOptions {
  readonly paragraphQueries: ParagraphQueryService;
  readonly canonicalWrites: NovelCanonicalWritePort;
  readonly identityFactory: {
    createParagraphId(): ParagraphId;
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
  invalidValue: "invalid_value",
  preconditionFailed: "precondition_failed",
} as const;

export class NovelParagraphToolService {
  private readonly logger: Logger;
  private readonly orderKeys: {
    initial(): OrderKey;
    after(orderKey: OrderKey): OrderKey;
  };

  constructor(private readonly options: NovelParagraphToolServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_paragraph_tool_service",
    });
    this.orderKeys = options.orderKeys ?? new FractionalOrderKeyFactory();
  }

  async read(
    conversationId: string,
    arguments_: NovelParagraphReadArguments,
  ): Promise<NovelParagraphReadDetails> {
    const scope = canonicalNovelReadScope;
    const revision = await this.options.canonicalWrites.getCurrentRevision();
    const paragraphs =
      arguments_.storyUnitId === undefined
        ? (await this.options.paragraphQueries.getCatalog(scope))?.snapshot
            .paragraphs ?? []
        : (await this.options.paragraphQueries.listParagraphsByStoryUnit(
            scope,
            captureStoryUnitId(arguments_.storyUnitId),
          )).map((readModel) => readModel.paragraph);
    return {
      paragraphs: paragraphs.map((paragraph) => toParagraphDetails(paragraph)),
      revision: { currentRevision: revision },
    };
  }

  async write(
    conversationId: string,
    arguments_: NovelParagraphWriteArguments,
  ): Promise<NovelParagraphWriteDetails> {
    const scope = canonicalNovelReadScope;
    const currentRevision =
      await this.options.canonicalWrites.getCurrentRevision();
    const baseRevision =
      arguments_.baseRevision === undefined
        ? undefined
        : captureNovelRevision(arguments_.baseRevision);
    const operations: NovelOperation[] = [];
    const items: NovelParagraphItemDetails[] = [];
    this.logger.info("novel_paragraph_tool.write.started", {
      conversationId,
      requestedCount: arguments_.values.length,
    });
    for (const value of arguments_.values) {
      const paragraphId = captureParagraphId(
        value.id ?? this.options.identityFactory.createParagraphId(),
      );
      try {
        await this.appendWriteOperation({
          scope,
          value,
          paragraphId,
          operations,
        });
        items.push({ id: paragraphId, status: "applied" });
      } catch (error) {
        const reason = mapItemError(error);
        if (reason === undefined) {
          throw new ToolError({
            code: "NOVEL_PARAGRAPH_WRITE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId,
          });
        }
        this.logger.info("novel_paragraph_tool.write.rejected_batch", {
          conversationId,
          reason,
        });
        return {
          items: [{ id: paragraphId, status: "rejected", reason }],
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
      this.logger.info("novel_paragraph_tool.write.completed", {
        conversationId,
        appliedCount: items.length,
        resultRevision: result.resultRevision,
      });
      return { items, revision: { currentRevision: result.resultRevision } };
    } catch (error) {
      this.logger.info("novel_paragraph_tool.write.failed", {
        conversationId,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw new ToolError({
        code: "NOVEL_PARAGRAPH_WRITE_FAILED",
        category: "execution",
        retryable: true,
        sideEffectStatus: "none",
        conversationId,
      });
    }
  }

  async edit(
    conversationId: string,
    arguments_: NovelParagraphEditArguments,
  ): Promise<NovelParagraphWriteDetails> {
    const scope = canonicalNovelReadScope;
    const currentRevision =
      await this.options.canonicalWrites.getCurrentRevision();
    const baseRevision =
      arguments_.baseRevision === undefined
        ? undefined
        : captureNovelRevision(arguments_.baseRevision);
    const operations: NovelOperation[] = [];
    const items: NovelParagraphItemDetails[] = [];
    this.logger.info("novel_paragraph_tool.edit.started", {
      conversationId,
      requestedCount: arguments_.values.length,
    });
    for (const patch of arguments_.values) {
      try {
        await this.appendEditOperation({
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
            code: "NOVEL_PARAGRAPH_EDIT_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId,
          });
        }
        this.logger.info("novel_paragraph_tool.edit.rejected_batch", {
          conversationId,
          reason,
        });
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
      this.logger.info("novel_paragraph_tool.edit.completed", {
        conversationId,
        appliedCount: items.length,
        resultRevision: result.resultRevision,
      });
      return { items, revision: { currentRevision: result.resultRevision } };
    } catch (error) {
      this.logger.info("novel_paragraph_tool.edit.failed", {
        conversationId,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw new ToolError({
        code: "NOVEL_PARAGRAPH_EDIT_FAILED",
        category: "execution",
        retryable: true,
        sideEffectStatus: "none",
        conversationId,
      });
    }
  }

  private async appendWriteOperation(input: {
    readonly scope: NovelReadScope;
    readonly value: ParagraphWriteValue;
    readonly paragraphId: ParagraphId;
    readonly operations: NovelOperation[];
  }): Promise<void> {
    const { scope, value, paragraphId, operations } = input;
    if ((await this.options.paragraphQueries.getParagraph(scope, paragraphId)) !== undefined) {
      throw new NovelParagraphItemFailure(ITEM_REJECTION.duplicateId);
    }
    const storyUnitId = captureStoryUnitId(value.storyUnitId);
    const orderKey = value.orderKey === undefined
      ? await this.appendOrderKey(scope, storyUnitId)
      : captureOrderKey(value.orderKey);
    const paragraph = captureParagraph({
      id: paragraphId,
      storyUnitId,
      orderKey,
      text: value.text,
    });
    operations.push(
      createParagraphCreateOperation({
        operationId: this.options.identityFactory.createOperationId(),
        paragraph,
      }),
    );
  }

  private async appendEditOperation(input: {
    readonly scope: NovelReadScope;
    readonly id: string;
    readonly patch: NovelParagraphEditValue;
    readonly operations: NovelOperation[];
  }): Promise<void> {
    const id = captureParagraphId(input.id);
    const current = await this.options.paragraphQueries.getParagraph(
      input.scope,
      id,
    );
    if (current === undefined) {
      throw new NovelParagraphItemFailure(ITEM_REJECTION.notFound);
    }
    const storyUnitId = input.patch.storyUnitId === undefined
      ? current.paragraph.storyUnitId
      : captureStoryUnitId(input.patch.storyUnitId);
    const orderKey = input.patch.orderKey === undefined
      ? current.paragraph.orderKey
      : captureOrderKey(input.patch.orderKey);
    const text = input.patch.text ?? current.paragraph.text;
    if (
      storyUnitId === current.paragraph.storyUnitId &&
      orderKey === current.paragraph.orderKey &&
      text === current.paragraph.text
    ) {
      return;
    }
    if (orderKey !== current.paragraph.orderKey) {
      input.operations.push(
        createParagraphOrderReplaceOperation({
          operationId: this.options.identityFactory.createOperationId(),
          paragraphId: id,
          expectedOrderDigest: current.orderDigest,
          orderKey,
        }),
      );
    }
    if (storyUnitId !== current.paragraph.storyUnitId) {
      input.operations.push(
        createParagraphStoryUnitReplaceOperation({
          operationId: this.options.identityFactory.createOperationId(),
          paragraphId: id,
          expectedStoryUnitDigest: current.storyUnitDigest,
          storyUnitId,
        }),
      );
    }
    if (text !== current.paragraph.text) {
      input.operations.push(
        createParagraphTextReplaceOperation({
          operationId: this.options.identityFactory.createOperationId(),
          paragraphId: id,
          expectedTextDigest: current.textDigest,
          text,
        }),
      );
    }
  }

  private async appendOrderKey(
    scope: NovelReadScope,
    storyUnitId: StoryUnitId,
  ): Promise<OrderKey> {
    const siblings = await this.options.paragraphQueries.listParagraphsByStoryUnit(
      scope,
      storyUnitId,
    );
    const last = siblings.at(-1);
    return last === undefined
      ? this.orderKeys.initial()
      : this.orderKeys.after(last.paragraph.orderKey);
  }

}

class NovelParagraphItemFailure extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "NovelParagraphItemFailure";
  }
}

function rejectedItem(
  id: string,
  reason: string,
): NovelParagraphItemDetails {
  return Object.freeze({ id, status: "rejected", reason });
}

function mapItemError(error: unknown): string | undefined {
  if (error instanceof NovelParagraphItemFailure) return error.reason;
  if (error instanceof NovelProtocolValidationError) {
    return ITEM_REJECTION.invalidValue;
  }
  if (error instanceof NovelOperationPreconditionError) {
    return ITEM_REJECTION.preconditionFailed;
  }
  return undefined;
}

function toParagraphDetails(paragraph: {
  id: ParagraphId;
  storyUnitId: StoryUnitId;
  orderKey: string;
  text: string;
}): NovelParagraphDetails {
  return Object.freeze({
    id: paragraph.id,
    storyUnitId: paragraph.storyUnitId,
    orderKey: paragraph.orderKey,
    text: paragraph.text,
  });
}
