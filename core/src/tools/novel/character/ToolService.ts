/**
 * Provider-neutral Novel Character tool semantics: read/list profiles, batch
 * create with host-generated ids, and field-level PATCH updates with null
 * clearing. Entity versions stay inside the host boundary.
 */
import { canonicalStringifyJson, type JsonValue } from "../../../event/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  CharacterQueryService,
  NovelOperationPreconditionError,
  NovelProtocolValidationError,
  SystemNovelClock,
  canonicalNovelReadScope,
  captureCharacterId,
  captureNovelRevision,
  captureStableEntityProfile,
  createCharacterCreateOperation,
  createCharacterReplaceOperation,
  type Character,
  type CharacterId,
  type NovelCanonicalWritePort,
  type NovelClock,
  type NovelOperation,
  type NovelOperationId,
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
  readonly characterQueries: CharacterQueryService;
  readonly canonicalWrites: NovelCanonicalWritePort;
  readonly identityFactory: {
    createCharacterId(): CharacterId;
    createOperationId(): NovelOperationId;
  };
  readonly clock?: NovelClock;
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
  private readonly clock: NovelClock;

  constructor(private readonly options: NovelCharacterToolServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_character_tool_service",
    });
    this.clock = options.clock ?? new SystemNovelClock();
  }

  async read(
    conversationId: string,
    arguments_: NovelCharacterReadArguments,
  ): Promise<NovelCharacterReadDetails> {
    const scope = canonicalNovelReadScope;
    const revision = await this.options.canonicalWrites.getCurrentRevision();
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
      revision: { currentRevision: revision },
    };
  }

  async write(
    conversationId: string,
    arguments_: NovelCharacterWriteArguments,
  ): Promise<NovelCharacterWriteDetails> {
    const scope = canonicalNovelReadScope;
    const currentRevision =
      await this.options.canonicalWrites.getCurrentRevision();
    const baseRevision =
      arguments_.baseRevision === undefined
        ? undefined
        : captureNovelRevision(arguments_.baseRevision);
    const existing = await this.options.characterQueries.list(scope);
    const operations: NovelOperation[] = [];
    const items: NovelCharacterItemDetails[] = [];
    this.logger.info("novel_character_tool.write.started", {
      conversationId,
      requestedCount: arguments_.values.length,
    });
    for (const value of arguments_.values) {
      const characterId = captureCharacterId(
        value.id ?? this.options.identityFactory.createCharacterId(),
      );
      try {
        this.appendWriteOperation({
          existing,
          value,
          characterId,
          operations,
        });
        items.push({ id: characterId, status: "applied" });
      } catch (error) {
        const reason = mapItemError(error);
        if (reason === undefined) {
          throw new ToolError({
            code: "NOVEL_CHARACTER_WRITE_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId,
          });
        }
        this.logger.info("novel_character_tool.write.rejected_batch", {
          conversationId,
          reason,
        });
        return {
          items: [{ id: characterId, status: "rejected", reason }],
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
      this.logger.info("novel_character_tool.write.completed", {
        conversationId,
        appliedCount: items.length,
        resultRevision: result.resultRevision,
      });
      return { items, revision: { currentRevision: result.resultRevision } };
    } catch (error) {
      this.logger.info("novel_character_tool.write.failed", {
        conversationId,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw new ToolError({
        code: "NOVEL_CHARACTER_WRITE_FAILED",
        category: "execution",
        retryable: true,
        sideEffectStatus: "none",
        conversationId,
      });
    }
  }

  async edit(
    conversationId: string,
    arguments_: NovelCharacterEditArguments,
  ): Promise<NovelCharacterWriteDetails> {
    const scope = canonicalNovelReadScope;
    const currentRevision =
      await this.options.canonicalWrites.getCurrentRevision();
    const baseRevision =
      arguments_.baseRevision === undefined
        ? undefined
        : captureNovelRevision(arguments_.baseRevision);
    const existing = await this.options.characterQueries.list(scope);
    const existingById = new Map(
      existing.map((character) => [character.id, character]),
    );
    const operations: NovelOperation[] = [];
    const items: NovelCharacterItemDetails[] = [];
    this.logger.info("novel_character_tool.edit.started", {
      conversationId,
      requestedCount: arguments_.values.length,
    });
    for (const patch of arguments_.values) {
      try {
        this.appendEditOperation({
          existingById,
          id: patch.id,
          patch: patch.value,
          operations,
        });
        items.push({ id: patch.id, status: "applied" });
      } catch (error) {
        const reason = mapItemError(error);
        if (reason === undefined) {
          throw new ToolError({
            code: "NOVEL_CHARACTER_EDIT_FAILED",
            category: "execution",
            retryable: true,
            sideEffectStatus: "none",
            conversationId,
          });
        }
        this.logger.info("novel_character_tool.edit.rejected_batch", {
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
      this.logger.info("novel_character_tool.edit.completed", {
        conversationId,
        appliedCount: items.length,
        resultRevision: result.resultRevision,
      });
      return { items, revision: { currentRevision: result.resultRevision } };
    } catch (error) {
      this.logger.info("novel_character_tool.edit.failed", {
        conversationId,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw new ToolError({
        code: "NOVEL_CHARACTER_EDIT_FAILED",
        category: "execution",
        retryable: true,
        sideEffectStatus: "none",
        conversationId,
      });
    }
  }

  private appendWriteOperation(input: {
    readonly existing: readonly Character[];
    readonly value: CharacterProfileWriteValue;
    readonly characterId: CharacterId;
    readonly operations: NovelOperation[];
  }): void {
    const { existing, value, characterId, operations } = input;
    if (existing.some((character) => character.id === characterId)) {
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
    operations.push(
      createCharacterCreateOperation({
        operationId: this.options.identityFactory.createOperationId(),
        id: characterId,
        profile,
        timestamp: this.clock.now(),
      }),
    );
  }

  private appendEditOperation(input: {
    readonly existingById: ReadonlyMap<string, Character>;
    readonly id: string;
    readonly patch: NovelCharacterEditValue;
    readonly operations: NovelOperation[];
  }): void {
    const id = captureCharacterId(input.id);
    const current = input.existingById.get(id);
    if (current === undefined) {
      throw new NovelCharacterItemFailure(ITEM_REJECTION.notFound);
    }
    const merged = captureStableEntityProfile({
      name: input.patch.name ?? current.name,
      aliases: input.patch.aliases ?? current.aliases,
      ...mergeOptional("summary", current.summary, input.patch.summary),
      ...mergeOptional(
        "initialState",
        current.initialState,
        input.patch.initialState,
      ),
      ...mergeOptional("authorNotes", current.authorNotes, input.patch.authorNotes),
    });
    if (
      canonicalStringifyJson(merged as unknown as JsonValue) ===
      canonicalStringifyJson(profileOf(current) as unknown as JsonValue)
    ) {
      return;
    }
    input.operations.push(
      createCharacterReplaceOperation({
        operationId: this.options.identityFactory.createOperationId(),
        id,
        expectedEntityVersion: current.entityVersion,
        profile: merged,
        timestamp: this.clock.now(),
      }),
    );
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
