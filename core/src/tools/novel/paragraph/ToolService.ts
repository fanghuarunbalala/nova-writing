/**
 * Provider-neutral Novel Paragraph tool semantics: read Paragraphs by
 * StoryUnit, batch create with host-generated ids, and field-level PATCH
 * updates. StoryUnit-local OrderKeys and digests stay inside the host.
 */
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  NovelDraftSessionService,
  FractionalOrderKeyFactory,
  NovelOperationPreconditionError,
  NovelProtocolValidationError,
  ParagraphQueryService,
  ParagraphService,
  canonicalNovelReadScope,
  captureOrderKey,
  captureParagraph,
  captureParagraphId,
  captureStoryUnitId,
  draftNovelReadScope,
  type NovelDraftSession,
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
  readonly paragraphs: ParagraphService;
  readonly paragraphQueries: ParagraphQueryService;
  readonly drafts: NovelDraftSessionService;
  readonly identityFactory: { createParagraphId(): ParagraphId };
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
    const scope = await this.resolveReadScope(conversationId, arguments_.scope);
    if (scope === undefined) {
      return { paragraphs: [] };
    }
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
    };
  }

  async write(
    conversationId: string,
    arguments_: NovelParagraphWriteArguments,
  ): Promise<NovelParagraphWriteDetails> {
    const session = await this.resolveOrStartDraft(conversationId);
    const scope = draftNovelReadScope(session);
    const items: NovelParagraphItemDetails[] = [];
    this.logger.info("novel_paragraph_tool.write.started", {
      conversationId,
      draftSessionId: session.id,
      requestedCount: arguments_.values.length,
    });
    for (const value of arguments_.values) {
      const paragraphId = captureParagraphId(
        value.id ?? this.options.identityFactory.createParagraphId(),
      );
      try {
        items.push(await this.writeOne(session, scope, value, paragraphId));
      } catch (error) {
        const reason = mapItemError(error);
        if (reason === undefined) {
          throw new ToolError({
            code: "NOVEL_PARAGRAPH_WRITE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId,
          });
        }
        items.push(rejectedItem(paragraphId, reason));
        break;
      }
    }
    this.logger.info("novel_paragraph_tool.write.completed", {
      conversationId,
      draftSessionId: session.id,
      appliedCount: items.filter((item) => item.status === "appended").length,
      rejectedCount: items.filter((item) => item.status === "rejected").length,
    });
    return { items };
  }

  async edit(
    conversationId: string,
    arguments_: NovelParagraphEditArguments,
  ): Promise<NovelParagraphWriteDetails> {
    const session = await this.resolveOrStartDraft(conversationId);
    const scope = draftNovelReadScope(session);
    const items: NovelParagraphItemDetails[] = [];
    this.logger.info("novel_paragraph_tool.edit.started", {
      conversationId,
      draftSessionId: session.id,
      requestedCount: arguments_.values.length,
    });
    for (const patch of arguments_.values) {
      try {
        items.push(await this.editOne(session, scope, patch.id, patch.value));
      } catch (error) {
        const reason = mapItemError(error);
        if (reason === undefined) {
          throw new ToolError({
            code: "NOVEL_PARAGRAPH_EDIT_FAILED",
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
    this.logger.info("novel_paragraph_tool.edit.completed", {
      conversationId,
      draftSessionId: session.id,
      appliedCount: items.filter((item) => item.status === "updated").length,
      rejectedCount: items.filter((item) => item.status === "rejected").length,
    });
    return { items };
  }

  private async writeOne(
    session: NovelDraftSession,
    scope: NovelReadScope,
    value: ParagraphWriteValue,
    paragraphId: ParagraphId,
  ): Promise<NovelParagraphItemDetails> {
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
    const receipt = await this.options.paragraphs.createParagraph(session, paragraph);
    return Object.freeze({
      id: paragraphId,
      status: "appended",
      sequence: receipt.sequence,
    });
  }

  private async editOne(
    session: NovelDraftSession,
    scope: NovelReadScope,
    idInput: string,
    patch: NovelParagraphEditValue,
  ): Promise<NovelParagraphItemDetails> {
    const id = captureParagraphId(idInput);
    const current = await this.options.paragraphQueries.getParagraph(scope, id);
    if (current === undefined) {
      throw new NovelParagraphItemFailure(ITEM_REJECTION.notFound);
    }
    const storyUnitId = patch.storyUnitId === undefined
      ? current.paragraph.storyUnitId
      : captureStoryUnitId(patch.storyUnitId);
    const orderKey = patch.orderKey === undefined
      ? current.paragraph.orderKey
      : captureOrderKey(patch.orderKey);
    const text = patch.text ?? current.paragraph.text;
    if (
      storyUnitId === current.paragraph.storyUnitId &&
      orderKey === current.paragraph.orderKey &&
      text === current.paragraph.text
    ) {
      return Object.freeze({ id, status: "duplicate" });
    }
    if (orderKey !== current.paragraph.orderKey) {
      await this.options.paragraphs.replaceOrder(
        session,
        id,
        current.orderDigest,
        orderKey as never,
      );
    }
    if (storyUnitId !== current.paragraph.storyUnitId) {
      const refreshed = await this.options.paragraphQueries.getParagraph(scope, id);
      if (refreshed === undefined) {
        throw new NovelParagraphItemFailure(ITEM_REJECTION.notFound);
      }
      await this.options.paragraphs.replaceStoryUnit(
        session,
        id,
        refreshed.storyUnitDigest,
        storyUnitId as never,
      );
    }
    if (text !== current.paragraph.text) {
      const refreshed = await this.options.paragraphQueries.getParagraph(scope, id);
      if (refreshed === undefined) {
        throw new NovelParagraphItemFailure(ITEM_REJECTION.notFound);
      }
      await this.options.paragraphs.replaceText(
        session,
        id,
        refreshed.textDigest,
        text,
      );
    }
    return Object.freeze({ id, status: "updated" });
  }

  private async resolveOrStartDraft(
    conversationId: string,
  ): Promise<NovelDraftSession> {
    const existing = await this.options.drafts.getActiveDraft(conversationId);
    if (existing !== undefined) return existing;
    try {
      return await this.options.drafts.startDraft(conversationId);
    } catch {
      this.logger.warn("novel_paragraph_tool.draft.start_failed", {
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

  private async resolveReadScope(
    conversationId: string,
    scope: NovelParagraphReadArguments["scope"],
  ): Promise<NovelReadScope | undefined> {
    if (scope === "canonical") return canonicalNovelReadScope;
    const session = await this.options.drafts.getActiveDraft(conversationId);
    return session === undefined ? undefined : draftNovelReadScope(session);
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
