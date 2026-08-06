/** Draft-only Character mutation service that constructs deterministic Operations. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  captureNovelDraftSession,
  type NovelDraftSession,
} from "../draft/index.js";
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
  NovelDraftOperationReceipt,
} from "../port/index.js";
import {
  captureNovelEntityVersion,
  type NovelEntityVersion,
} from "../version/index.js";
import type { NovelMutationService } from "./NovelMutationService.js";

export interface CharacterServiceOptions {
  readonly mutations: NovelMutationService;
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
    session: NovelDraftSession,
    id: CharacterId,
    profile: StableEntityProfile,
  ): Promise<NovelDraftOperationReceipt> {
    const draft = captureNovelDraftSession(session);
    const characterId = captureCharacterId(id);
    const operation = createCharacterCreateOperation({
      operationId: this.options.identityFactory.createOperationId(),
      id: characterId,
      profile,
      timestamp: this.options.clock.now(),
    });
    const receipt = await this.options.mutations.execute(draft, operation);
    this.logger.info("novel_character.create.completed", {
      novelId: draft.novelId,
      draftSessionId: draft.id,
      characterId,
      operationId: operation.operationId,
    });
    return receipt;
  }

  async replace(
    session: NovelDraftSession,
    id: CharacterId,
    expectedEntityVersion: NovelEntityVersion,
    profile: StableEntityProfile,
  ): Promise<NovelDraftOperationReceipt> {
    const draft = captureNovelDraftSession(session);
    const characterId = captureCharacterId(id);
    const operation = createCharacterReplaceOperation({
      operationId: this.options.identityFactory.createOperationId(),
      id: characterId,
      expectedEntityVersion: captureNovelEntityVersion(expectedEntityVersion),
      profile,
      timestamp: this.options.clock.now(),
    });
    const receipt = await this.options.mutations.execute(draft, operation);
    this.logger.info("novel_character.replace.completed", {
      novelId: draft.novelId,
      draftSessionId: draft.id,
      characterId,
      operationId: operation.operationId,
    });
    return receipt;
  }

  async delete(
    session: NovelDraftSession,
    id: CharacterId,
    expectedEntityVersion: NovelEntityVersion,
  ): Promise<NovelDraftOperationReceipt> {
    const draft = captureNovelDraftSession(session);
    const characterId = captureCharacterId(id);
    const operation = createCharacterDeleteOperation({
      operationId: this.options.identityFactory.createOperationId(),
      id: characterId,
      expectedEntityVersion: captureNovelEntityVersion(expectedEntityVersion),
    });
    const receipt = await this.options.mutations.execute(draft, operation);
    this.logger.info("novel_character.delete.completed", {
      novelId: draft.novelId,
      draftSessionId: draft.id,
      characterId,
      operationId: operation.operationId,
    });
    return receipt;
  }
}
