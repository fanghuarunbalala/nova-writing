/** Canonical authoritative Evidence mutation service. */
import { noopLogger, type Logger } from "../../observability/index.js";
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
  type StoryUnitCharacterBinding,
  type StoryUnitEntityChange,
  type StoryUnitLocationBinding,
} from "../model/index.js";
import {
  createStoryUnitCharacterBindingDeleteOperation,
  createStoryUnitCharacterBindingPutOperation,
  createStoryUnitEntityChangeDeleteOperation,
  createStoryUnitEntityChangePutOperation,
  createStoryUnitLocationBindingDeleteOperation,
  createStoryUnitLocationBindingPutOperation,
  type NovelOperation,
} from "../operation/index.js";
import type {
  NovelCanonicalWritePort,
  NovelCanonicalWriteResult,
} from "../port/index.js";
import { captureNovelRevision, type NovelRevision } from "../version/index.js";

export interface NovelEvidenceServiceOptions {
  readonly canonicalWrites: NovelCanonicalWritePort;
  readonly identityFactory: { createOperationId(): NovelOperationId };
  readonly logger?: Logger;
}

export class NovelEvidenceService {
  private readonly logger: Logger;
  constructor(private readonly options: NovelEvidenceServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({ component: "novel_evidence_service" });
  }

  putCharacterBinding(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    binding: StoryUnitCharacterBinding,
    expectedRecordDigest?: string,
  ) {
    const value = captureStoryUnitCharacterBinding(binding);
    return this.execute(conversationId, baseRevision, createStoryUnitCharacterBindingPutOperation({
      operationId: this.operationId(), binding: value,
      ...(expectedRecordDigest === undefined ? {} : { expectedRecordDigest }),
    }), "character_binding.put", { storyUnitId: value.storyUnitId, characterId: value.characterId });
  }
  deleteCharacterBinding(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    storyUnitIdInput: StoryUnitId,
    characterIdInput: CharacterId,
    expectedRecordDigest: string,
  ) {
    const storyUnitId = captureStoryUnitId(storyUnitIdInput);
    const characterId = captureCharacterId(characterIdInput);
    return this.execute(conversationId, baseRevision, createStoryUnitCharacterBindingDeleteOperation({
      operationId: this.operationId(), storyUnitId, characterId, expectedRecordDigest,
    }), "character_binding.delete", { storyUnitId, characterId });
  }
  putLocationBinding(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    binding: StoryUnitLocationBinding,
    expectedRecordDigest?: string,
  ) {
    const value = captureStoryUnitLocationBinding(binding);
    return this.execute(conversationId, baseRevision, createStoryUnitLocationBindingPutOperation({
      operationId: this.operationId(), binding: value,
      ...(expectedRecordDigest === undefined ? {} : { expectedRecordDigest }),
    }), "location_binding.put", { storyUnitId: value.storyUnitId, locationId: value.locationId });
  }
  deleteLocationBinding(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    storyUnitIdInput: StoryUnitId,
    locationIdInput: LocationId,
    expectedRecordDigest: string,
  ) {
    const storyUnitId = captureStoryUnitId(storyUnitIdInput);
    const locationId = captureLocationId(locationIdInput);
    return this.execute(conversationId, baseRevision, createStoryUnitLocationBindingDeleteOperation({
      operationId: this.operationId(), storyUnitId, locationId, expectedRecordDigest,
    }), "location_binding.delete", { storyUnitId, locationId });
  }
  putEntityChange(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    change: StoryUnitEntityChange,
    expectedRecordDigest?: string,
  ) {
    const value = captureStoryUnitEntityChange(change);
    return this.execute(conversationId, baseRevision, createStoryUnitEntityChangePutOperation({
      operationId: this.operationId(), change: value,
      ...(expectedRecordDigest === undefined ? {} : { expectedRecordDigest }),
    }), "entity_change.put", { storyUnitId: value.storyUnitId, changeId: value.id });
  }
  deleteEntityChange(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    idInput: StoryUnitEntityChangeId,
    expectedRecordDigest: string,
  ) {
    const id = captureStoryUnitEntityChangeId(idInput);
    return this.execute(conversationId, baseRevision, createStoryUnitEntityChangeDeleteOperation({
      operationId: this.operationId(), id, expectedRecordDigest,
    }), "entity_change.delete", { changeId: id });
  }

  private operationId() { return this.options.identityFactory.createOperationId(); }
  private async execute(
    conversationId: string,
    baseRevision: NovelRevision | undefined,
    operation: NovelOperation,
    action: string,
    identities: Readonly<Record<string, string>>,
  ): Promise<NovelCanonicalWriteResult> {
    this.logger.debug("novel_evidence.mutation.started", {
      operationId: operation.operationId, action, ...identities,
    });
    const result = await this.options.canonicalWrites.applyOperations({
      operations: [operation],
      conversationId,
      ...(baseRevision === undefined
        ? {}
        : { baseRevision: captureNovelRevision(baseRevision) }),
    });
    this.logger.info("novel_evidence.mutation.completed", {
      operationId: operation.operationId,
      action, resultRevision: result.resultRevision, status: result.status,
      ...identities,
    });
    return result;
  }
}
