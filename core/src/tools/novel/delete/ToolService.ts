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
  CharacterService,
  LocationQueryService,
  LocationService,
  NovelDraftSessionService,
  NovelOperationPreconditionError,
  NovelProtocolValidationError,
  ParagraphQueryService,
  ParagraphService,
  PublicationQueryService,
  PublicationService,
  StoryOutlineQueryService,
  StoryOutlineService,
  captureCharacterId,
  captureLocationId,
  captureParagraphId,
  capturePublicationChapterId,
  capturePublicationVolumeId,
  captureStoryUnitId,
  draftNovelReadScope,
  type NovelDraftSession,
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
  readonly outline: StoryOutlineService;
  readonly outlineQueries: StoryOutlineQueryService;
  readonly characters: CharacterService;
  readonly characterQueries: CharacterQueryService;
  readonly locations: LocationService;
  readonly locationQueries: LocationQueryService;
  readonly paragraphs: ParagraphService;
  readonly paragraphQueries: ParagraphQueryService;
  readonly publication: PublicationService;
  readonly publicationQueries: PublicationQueryService;
  readonly drafts: NovelDraftSessionService;
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
    const session = await this.resolveOrStartDraft(conversationId);
    const scope = draftNovelReadScope(session);
    const items: NovelDeleteItemDetails[] = [];
    this.logger.info("novel_delete_tool.delete.started", {
      conversationId,
      draftSessionId: session.id,
      requestedCount: arguments_.values.length,
    });
    for (const value of arguments_.values) {
      try {
        items.push(await this.deleteOne(session, scope, value));
      } catch (error) {
        const reason = mapItemError(error);
        if (reason === undefined) {
          throw new ToolError({
            code: "NOVEL_DELETE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId,
          });
        }
        items.push(rejectedItem(value.kind, value.id, reason));
        break;
      }
    }
    this.logger.info("novel_delete_tool.delete.completed", {
      conversationId,
      draftSessionId: session.id,
      appliedCount: items.filter((item) => item.status === "deleted").length,
      rejectedCount: items.filter((item) => item.status === "rejected").length,
    });
    return { items };
  }

  private async deleteOne(
    session: NovelDraftSession,
    scope: NovelReadScope,
    value: { kind: NovelDeleteKind; id: string },
  ): Promise<NovelDeleteItemDetails> {
    switch (value.kind) {
      case "story_unit":
        return this.deleteStoryUnit(session, scope, value.id);
      case "character":
        return this.deleteCharacter(session, scope, value.id);
      case "location":
        return this.deleteLocation(session, scope, value.id);
      case "paragraph":
        return this.deleteParagraph(session, scope, value.id);
      case "volume":
        return this.deleteVolume(session, scope, value.id);
      case "chapter":
        return this.deleteChapter(session, scope, value.id);
    }
  }

  private async deleteStoryUnit(
    session: NovelDraftSession,
    scope: NovelReadScope,
    idInput: string,
  ): Promise<NovelDeleteItemDetails> {
    const storyUnitId = captureStoryUnitId(idInput);
    const current = await this.options.outlineQueries.getStoryUnit(scope, storyUnitId);
    if (current === undefined) {
      throw new NovelDeleteItemFailure(ITEM_REJECTION.notFound);
    }
    const receipt = await this.options.outline.deleteStoryUnit(session, {
      storyUnitId,
      expectedContentDigest: current.contentDigest,
      expectedParentDigest: current.parentDigest,
      expectedOrderDigest: current.orderDigest,
    });
    return deletedItem("story_unit", storyUnitId, receipt.sequence);
  }

  private async deleteCharacter(
    session: NovelDraftSession,
    scope: NovelReadScope,
    idInput: string,
  ): Promise<NovelDeleteItemDetails> {
    const characterId = captureCharacterId(idInput);
    const current = await this.options.characterQueries.get(scope, characterId);
    if (current === undefined) {
      throw new NovelDeleteItemFailure(ITEM_REJECTION.notFound);
    }
    const receipt = await this.options.characters.delete(
      session,
      characterId,
      current.entityVersion,
    );
    return deletedItem("character", characterId, receipt.sequence);
  }

  private async deleteLocation(
    session: NovelDraftSession,
    scope: NovelReadScope,
    idInput: string,
  ): Promise<NovelDeleteItemDetails> {
    const locationId = captureLocationId(idInput);
    const current = await this.options.locationQueries.get(scope, locationId);
    if (current === undefined) {
      throw new NovelDeleteItemFailure(ITEM_REJECTION.notFound);
    }
    const receipt = await this.options.locations.delete(
      session,
      locationId,
      current.entityVersion,
    );
    return deletedItem("location", locationId, receipt.sequence);
  }

  private async deleteParagraph(
    session: NovelDraftSession,
    scope: NovelReadScope,
    idInput: string,
  ): Promise<NovelDeleteItemDetails> {
    const paragraphId = captureParagraphId(idInput);
    const current = await this.options.paragraphQueries.getParagraph(scope, paragraphId);
    if (current === undefined) {
      throw new NovelDeleteItemFailure(ITEM_REJECTION.notFound);
    }
    const receipt = await this.options.paragraphs.deleteParagraph(
      session,
      paragraphId,
      current.textDigest,
      current.orderDigest,
      current.storyUnitDigest,
    );
    return deletedItem("paragraph", paragraphId, receipt.sequence);
  }

  private async deleteVolume(
    session: NovelDraftSession,
    scope: NovelReadScope,
    idInput: string,
  ): Promise<NovelDeleteItemDetails> {
    const volumeId = capturePublicationVolumeId(idInput);
    const current = await this.options.publicationQueries.getVolume(scope, volumeId);
    if (current === undefined) {
      throw new NovelDeleteItemFailure(ITEM_REJECTION.notFound);
    }
    const receipt = await this.options.publication.deleteVolume(
      session,
      volumeId,
      current.recordDigest,
    );
    return deletedItem("volume", volumeId, receipt.sequence);
  }

  private async deleteChapter(
    session: NovelDraftSession,
    scope: NovelReadScope,
    idInput: string,
  ): Promise<NovelDeleteItemDetails> {
    const chapterId = capturePublicationChapterId(idInput);
    const current = await this.options.publicationQueries.getChapter(scope, chapterId);
    if (current === undefined) {
      throw new NovelDeleteItemFailure(ITEM_REJECTION.notFound);
    }
    const receipt = await this.options.publication.deleteChapter(
      session,
      chapterId,
      current.recordDigest,
    );
    return deletedItem("chapter", chapterId, receipt.sequence);
  }

  private async resolveOrStartDraft(
    conversationId: string,
  ): Promise<NovelDraftSession> {
    const existing = await this.options.drafts.getActiveDraft(conversationId);
    if (existing !== undefined) return existing;
    try {
      return await this.options.drafts.startDraft(conversationId);
    } catch {
      this.logger.warn("novel_delete_tool.draft.start_failed", {
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
  sequence?: number,
): NovelDeleteItemDetails {
  return Object.freeze({
    kind,
    id,
    status: "deleted",
    ...(sequence === undefined ? {} : { sequence }),
  });
}

function rejectedItem(
  kind: NovelDeleteKind,
  id: string,
  reason: string,
): NovelDeleteItemDetails {
  if (reason === ITEM_REJECTION.notFound) {
    return Object.freeze({ kind, id, status: "not_found" });
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
