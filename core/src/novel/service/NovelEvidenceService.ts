/** Draft-only authoritative Evidence mutation service. */
import { noopLogger, type Logger } from "../../observability/index.js";
import { captureNovelDraftSession, type NovelDraftSession } from "../draft/index.js";
import {
  captureCharacterId,
  captureLocationId,
  captureStoryUnitEntityChangeId,
  captureStoryUnitId,
  type CharacterId,
  type LocationId,
  type NovelOperationId,
  type StoryUnitEntityChangeId,
  type StoryUnitId,
} from "../identity/index.js";
import {
  captureStoryUnitCharacterBinding,
  captureStoryUnitEntityChange,
  captureStoryUnitLocationBinding,
  captureStoryUnitRealization,
  type StoryUnitCharacterBinding,
  type StoryUnitEntityChange,
  type StoryUnitLocationBinding,
  type StoryUnitRealization,
} from "../model/index.js";
import {
  createStoryUnitCharacterBindingDeleteOperation,
  createStoryUnitCharacterBindingPutOperation,
  createStoryUnitEntityChangeDeleteOperation,
  createStoryUnitEntityChangePutOperation,
  createStoryUnitLocationBindingDeleteOperation,
  createStoryUnitLocationBindingPutOperation,
  createStoryUnitRealizationDeleteOperation,
  createStoryUnitRealizationPutOperation,
  type NovelOperation,
} from "../operation/index.js";
import type { NovelDraftOperationReceipt } from "../port/index.js";
import type { NovelMutationService } from "./NovelMutationService.js";

export interface NovelEvidenceServiceOptions {
  readonly mutations: NovelMutationService;
  readonly identityFactory: { createOperationId(): NovelOperationId };
  readonly logger?: Logger;
}

export class NovelEvidenceService {
  private readonly logger: Logger;
  constructor(private readonly options: NovelEvidenceServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({ component: "novel_evidence_service" });
  }

  putCharacterBinding(session: NovelDraftSession, binding: StoryUnitCharacterBinding, expectedRecordDigest?: string) {
    const value = captureStoryUnitCharacterBinding(binding);
    return this.execute(session, createStoryUnitCharacterBindingPutOperation({
      operationId: this.operationId(), binding: value,
      ...(expectedRecordDigest === undefined ? {} : { expectedRecordDigest }),
    }), "character_binding.put", { storyUnitId: value.storyUnitId, characterId: value.characterId });
  }
  deleteCharacterBinding(session: NovelDraftSession, storyUnitIdInput: StoryUnitId, characterIdInput: CharacterId, expectedRecordDigest: string) {
    const storyUnitId = captureStoryUnitId(storyUnitIdInput);
    const characterId = captureCharacterId(characterIdInput);
    return this.execute(session, createStoryUnitCharacterBindingDeleteOperation({
      operationId: this.operationId(), storyUnitId, characterId, expectedRecordDigest,
    }), "character_binding.delete", { storyUnitId, characterId });
  }
  putLocationBinding(session: NovelDraftSession, binding: StoryUnitLocationBinding, expectedRecordDigest?: string) {
    const value = captureStoryUnitLocationBinding(binding);
    return this.execute(session, createStoryUnitLocationBindingPutOperation({
      operationId: this.operationId(), binding: value,
      ...(expectedRecordDigest === undefined ? {} : { expectedRecordDigest }),
    }), "location_binding.put", { storyUnitId: value.storyUnitId, locationId: value.locationId });
  }
  deleteLocationBinding(session: NovelDraftSession, storyUnitIdInput: StoryUnitId, locationIdInput: LocationId, expectedRecordDigest: string) {
    const storyUnitId = captureStoryUnitId(storyUnitIdInput);
    const locationId = captureLocationId(locationIdInput);
    return this.execute(session, createStoryUnitLocationBindingDeleteOperation({
      operationId: this.operationId(), storyUnitId, locationId, expectedRecordDigest,
    }), "location_binding.delete", { storyUnitId, locationId });
  }
  putEntityChange(session: NovelDraftSession, change: StoryUnitEntityChange, expectedRecordDigest?: string) {
    const value = captureStoryUnitEntityChange(change);
    return this.execute(session, createStoryUnitEntityChangePutOperation({
      operationId: this.operationId(), change: value,
      ...(expectedRecordDigest === undefined ? {} : { expectedRecordDigest }),
    }), "entity_change.put", { storyUnitId: value.storyUnitId, changeId: value.id });
  }
  deleteEntityChange(session: NovelDraftSession, idInput: StoryUnitEntityChangeId, expectedRecordDigest: string) {
    const id = captureStoryUnitEntityChangeId(idInput);
    return this.execute(session, createStoryUnitEntityChangeDeleteOperation({
      operationId: this.operationId(), id, expectedRecordDigest,
    }), "entity_change.delete", { changeId: id });
  }
  putRealization(session: NovelDraftSession, realization: StoryUnitRealization, expectedRecordDigest?: string) {
    const value = captureStoryUnitRealization(realization);
    return this.execute(session, createStoryUnitRealizationPutOperation({
      operationId: this.operationId(), realization: value,
      ...(expectedRecordDigest === undefined ? {} : { expectedRecordDigest }),
    }), "realization.put", { storyUnitId: value.storyUnitId });
  }
  deleteRealization(session: NovelDraftSession, storyUnitIdInput: StoryUnitId, expectedRecordDigest: string) {
    const storyUnitId = captureStoryUnitId(storyUnitIdInput);
    return this.execute(session, createStoryUnitRealizationDeleteOperation({
      operationId: this.operationId(), storyUnitId, expectedRecordDigest,
    }), "realization.delete", { storyUnitId });
  }

  private operationId() { return this.options.identityFactory.createOperationId(); }
  private async execute(sessionInput: NovelDraftSession, operation: NovelOperation, action: string, identities: Readonly<Record<string, string>>): Promise<NovelDraftOperationReceipt> {
    const session = captureNovelDraftSession(sessionInput);
    this.logger.debug("novel_evidence.mutation.started", {
      novelId: session.novelId, draftSessionId: session.id, operationId: operation.operationId, action, ...identities,
    });
    const receipt = await this.options.mutations.execute(session, operation);
    this.logger.info("novel_evidence.mutation.completed", {
      novelId: session.novelId, draftSessionId: session.id, operationId: operation.operationId,
      action, sequence: receipt.sequence, status: receipt.status, ...identities,
    });
    return receipt;
  }
}
