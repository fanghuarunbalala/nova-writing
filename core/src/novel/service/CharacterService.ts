/** Canonical Character mutation service that constructs deterministic Operations. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  captureCharacterId,
  type CharacterId,
  type NovelOperationId,
} from "../identity/index.js";
import type { StableEntityProfile } from "../model/index.js";
import {
  createCharacterCreateOperation,
  createCharacterDeleteOperation,
  createCharacterReplaceOperation,
} from "../operation/index.js";
import type {
  NovelClock,
  NovelCanonicalWritePort,
  NovelCanonicalWriteResult,
} from "../port/index.js";
import {
  captureNovelEntityVersion,
  captureNovelRevision,
  type NovelEntityVersion,
  type NovelRevision,
} from "../version/index.js";
import type { NovelOperation } from "../operation/index.js";

export interface CharacterServiceOptions {
  readonly canonicalWrites: NovelCanonicalWritePort;
  readonly identityFactory: {
    createOperationId(): NovelOperationId;
  };
  readonly clock: NovelClock;
  readonly logger?: Logger;
}

export class CharacterService {
  private readonly logger: Logger;

  constructor(private readonly options: CharacterServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_character_service",
    });
  }

  async create(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    id: CharacterId,
    profile: StableEntityProfile,
  ): Promise<NovelCanonicalWriteResult> {
    const characterId = captureCharacterId(id);
    const operation = createCharacterCreateOperation({
      operationId: this.options.identityFactory.createOperationId(),
      id: characterId,
      profile,
      timestamp: this.options.clock.now(),
    });
    return this.execute(conversationId, baseRevision, operation, "create", {
      characterId,
    });
  }

  async replace(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    id: CharacterId,
    expectedEntityVersion: NovelEntityVersion,
    profile: StableEntityProfile,
  ): Promise<NovelCanonicalWriteResult> {
    const characterId = captureCharacterId(id);
    const operation = createCharacterReplaceOperation({
      operationId: this.options.identityFactory.createOperationId(),
      id: characterId,
      expectedEntityVersion: captureNovelEntityVersion(expectedEntityVersion),
      profile,
      timestamp: this.options.clock.now(),
    });
    return this.execute(conversationId, baseRevision, operation, "replace", {
      characterId,
    });
  }

  async delete(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    id: CharacterId,
    expectedEntityVersion: NovelEntityVersion,
  ): Promise<NovelCanonicalWriteResult> {
    const characterId = captureCharacterId(id);
    const operation = createCharacterDeleteOperation({
      operationId: this.options.identityFactory.createOperationId(),
      id: characterId,
      expectedEntityVersion: captureNovelEntityVersion(expectedEntityVersion),
    });
    return this.execute(conversationId, baseRevision, operation, "delete", {
      characterId,
    });
  }

  private async execute(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    operation: NovelOperation,
    action: string,
    identity: Readonly<Record<string, string>>,
  ): Promise<NovelCanonicalWriteResult> {
    this.logger.debug("novel_character.operation.started", {
      operationId: operation.operationId,
      operationType: operation.type,
      action,
      ...identity,
    });
    const result = await this.options.canonicalWrites.applyOperations({
      operations: [operation],
      conversationId,
      ...(baseRevision === undefined
        ? {}
        : { baseRevision: captureNovelRevision(baseRevision) }),
    });
    this.logger.info("novel_character.operation.completed", {
      operationId: operation.operationId,
      operationType: operation.type,
      action,
      resultRevision: result.resultRevision,
      status: result.status,
      ...identity,
    });
    return result;
  }
}
