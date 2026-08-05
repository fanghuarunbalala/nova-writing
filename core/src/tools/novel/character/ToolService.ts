/**
 * Provider-neutral Novel Character tool semantics: read/list profiles, batch
 * create with host-generated ids, and field-level PATCH updates with null
 * clearing. Entity versions stay inside the host boundary.
 */
import { canonicalStringifyJson, type JsonValue } from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  CharacterQueryService,
  CharacterService,
  NovelDraftSessionService,
  NovelOperationPreconditionError,
  NovelProtocolValidationError,
  canonicalNovelReadScope,
  captureCharacterId,
  captureStableEntityProfile,
  draftNovelReadScope,
  type Character,
  type CharacterId,
  type NovelDraftSession,
  type NovelReadScope,
} from "../../../novel/index.js";
import { ToolError } from "../../../runtime/tools/execution/index.js";
import type {
  NovelCharacterDetails,
  NovelCharacterEditArguments,
  NovelCharacterEditValue,
  NovelCharacterItemDetails,
  NovelCharacterReadArguments,
  NovelCharacterReadDetails,
  NovelCharacterWriteArguments,
  NovelCharacterWriteDetails,
  CharacterProfileWriteValue,
} from "./schemas.js";

export interface NovelCharacterToolServiceOptions {
  readonly characters: CharacterService;
  readonly characterQueries: CharacterQueryService;
  readonly drafts: NovelDraftSessionService;
  readonly identityFactory: { createCharacterId(): CharacterId };
  readonly logger?: Logger;
}

const ITEM_REJECTION = {
  notFound: "not_found",
  duplicateId: "duplicate_id",
  invalidValue: "invalid_value",
  preconditionFailed: "precondition_failed",
} as const;

export class NovelCharacterToolService {
  private readonly logger: Logger;

  constructor(private readonly options: NovelCharacterToolServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_character_tool_service",
    });
  }

  async read(
    conversationId: string,
    arguments_: NovelCharacterReadArguments,
  ): Promise<NovelCharacterReadDetails> {
    const scope = await this.resolveReadScope(conversationId, arguments_.scope);
    if (scope === undefined) {
      return { characters: [] };
    }
    const characters =
      arguments_.characterId === undefined
        ? await this.options.characterQueries.list(scope)
        : [await this.options.characterQueries.get(
            scope,
            captureCharacterId(arguments_.characterId),
          )]
            .filter((value): value is Character => value !== undefined);
    return {
      characters: characters.map((character) => toCharacterDetails(character)),
    };
  }

  async write(
    conversationId: string,
    arguments_: NovelCharacterWriteArguments,
  ): Promise<NovelCharacterWriteDetails> {
    const session = await this.resolveOrStartDraft(conversationId);
    const scope = draftNovelReadScope(session);
    const items: NovelCharacterItemDetails[] = [];
    this.logger.info("novel_character_tool.write.started", {
      conversationId,
      draftSessionId: session.id,
      requestedCount: arguments_.values.length,
    });
    for (const value of arguments_.values) {
      const characterId = captureCharacterId(
        value.id ?? this.options.identityFactory.createCharacterId(),
      );
      try {
        items.push(await this.writeOne(session, scope, value, characterId));
      } catch (error) {
        const reason = mapItemError(error);
        if (reason === undefined) {
          throw new ToolError({
            code: "NOVEL_CHARACTER_WRITE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "possible",
            conversationId,
          });
        }
        items.push(rejectedItem(characterId, reason));
        break;
      }
    }
    this.logger.info("novel_character_tool.write.completed", {
      conversationId,
      draftSessionId: session.id,
      appliedCount: items.filter((item) => item.status === "appended").length,
      rejectedCount: items.filter((item) => item.status === "rejected").length,
    });
    return { items };
  }

  async edit(
    conversationId: string,
    arguments_: NovelCharacterEditArguments,
  ): Promise<NovelCharacterWriteDetails> {
    const session = await this.resolveOrStartDraft(conversationId);
    const scope = draftNovelReadScope(session);
    const items: NovelCharacterItemDetails[] = [];
    this.logger.info("novel_character_tool.edit.started", {
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
            code: "NOVEL_CHARACTER_EDIT_FAILED",
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
    this.logger.info("novel_character_tool.edit.completed", {
      conversationId,
      draftSessionId: session.id,
      appliedCount: items.filter((item) => item.status === "appended").length,
      rejectedCount: items.filter((item) => item.status === "rejected").length,
    });
    return { items };
  }

  private async writeOne(
    session: NovelDraftSession,
    scope: NovelReadScope,
    value: CharacterProfileWriteValue,
    characterId: CharacterId,
  ): Promise<NovelCharacterItemDetails> {
    if (
      (await this.options.characterQueries.get(scope, characterId)) !==
      undefined
    ) {
      throw new NovelCharacterItemFailure(ITEM_REJECTION.duplicateId);
    }
    const profile = captureStableEntityProfile({
      name: value.name,
      aliases: value.aliases,
      ...(value.summary === undefined ? {} : { summary: value.summary }),
      ...(value.initialState === undefined
        ? {}
        : { initialState: value.initialState }),
      ...(value.authorNotes === undefined
        ? {}
        : { authorNotes: value.authorNotes }),
    });
    const receipt = await this.options.characters.create(
      session,
      characterId,
      profile,
    );
    return Object.freeze({
      id: characterId,
      status: "appended",
      sequence: receipt.sequence,
    });
  }

  private async editOne(
    session: NovelDraftSession,
    scope: NovelReadScope,
    idInput: string,
    patch: NovelCharacterEditValue,
  ): Promise<NovelCharacterItemDetails> {
    const id = captureCharacterId(idInput);
    const current = await this.options.characterQueries.get(scope, id);
    if (current === undefined) {
      throw new NovelCharacterItemFailure(ITEM_REJECTION.notFound);
    }
    const merged = captureStableEntityProfile({
      name: patch.name ?? current.name,
      aliases: patch.aliases ?? current.aliases,
      ...mergeOptional("summary", current.summary, patch.summary),
      ...mergeOptional("initialState", current.initialState, patch.initialState),
      ...mergeOptional("authorNotes", current.authorNotes, patch.authorNotes),
    });
    if (
      canonicalStringifyJson(merged as unknown as JsonValue) ===
      canonicalStringifyJson(profileOf(current) as unknown as JsonValue)
    ) {
      return Object.freeze({ id, status: "duplicate" });
    }
    const receipt = await this.options.characters.replace(
      session,
      id,
      current.entityVersion,
      merged,
    );
    return Object.freeze({
      id,
      status: "appended",
      sequence: receipt.sequence,
    });
  }

  private async resolveOrStartDraft(
    conversationId: string,
  ): Promise<NovelDraftSession> {
    const existing = await this.options.drafts.getActiveDraft(conversationId);
    if (existing !== undefined) return existing;
    try {
      return await this.options.drafts.startDraft(conversationId);
    } catch {
      this.logger.warn("novel_character_tool.draft.start_failed", {
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
    scope: NovelCharacterReadArguments["scope"],
  ): Promise<NovelReadScope | undefined> {
    if (scope === "canonical") return canonicalNovelReadScope;
    const session = await this.options.drafts.getActiveDraft(conversationId);
    return session === undefined ? undefined : draftNovelReadScope(session);
  }
}

class NovelCharacterItemFailure extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "NovelCharacterItemFailure";
  }
}

function rejectedItem(
  id: string,
  reason: string,
): NovelCharacterItemDetails {
  return Object.freeze({ id, status: "rejected", reason });
}

function mapItemError(error: unknown): string | undefined {
  if (error instanceof NovelCharacterItemFailure) return error.reason;
  if (error instanceof NovelProtocolValidationError) {
    return ITEM_REJECTION.invalidValue;
  }
  if (error instanceof NovelOperationPreconditionError) {
    return ITEM_REJECTION.preconditionFailed;
  }
  return undefined;
}

function mergeOptional(
  field: "summary" | "initialState" | "authorNotes",
  current: string | undefined,
  patch: string | null | undefined,
): Partial<{ summary: string; initialState: string; authorNotes: string }> {
  if (patch === undefined) {
    return current === undefined ? {} : { [field]: current };
  }
  if (patch === null) return {};
  return { [field]: patch };
}

function profileOf(character: Character): {
  name: string;
  aliases: readonly string[];
  summary?: string;
  initialState?: string;
  authorNotes?: string;
} {
  return {
    name: character.name,
    aliases: character.aliases,
    ...(character.summary === undefined ? {} : { summary: character.summary }),
    ...(character.initialState === undefined
      ? {}
      : { initialState: character.initialState }),
    ...(character.authorNotes === undefined
      ? {}
      : { authorNotes: character.authorNotes }),
  };
}

function toCharacterDetails(character: Character): NovelCharacterDetails {
  return Object.freeze({
    id: character.id,
    name: character.name,
    aliases: [...character.aliases],
    ...(character.summary === undefined ? {} : { summary: character.summary }),
    ...(character.initialState === undefined
      ? {}
      : { initialState: character.initialState }),
    ...(character.authorNotes === undefined
      ? {}
      : { authorNotes: character.authorNotes }),
    createdAt: character.createdAt,
    updatedAt: character.updatedAt,
  });
}
