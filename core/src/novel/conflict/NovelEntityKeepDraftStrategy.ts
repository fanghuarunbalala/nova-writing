/** Rebinds Character and Location keep-draft intent to sequential current state. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  NovelInvariantViolationError,
  NOVEL_INVARIANT_FAILURE,
} from "../error/index.js";
import type { NovelIdentityFactory } from "../identity/index.js";
import type { Character, Location, StableEntityProfile } from "../model/index.js";
import {
  captureNovelEntityProfileOperationIntent,
  createCharacterCreateOperation,
  createCharacterDeleteOperation,
  createCharacterReplaceOperation,
  createLocationCreateOperation,
  createLocationDeleteOperation,
  createLocationReplaceOperation,
  type NovelOperation,
} from "../operation/index.js";
import type { NovelClock, NovelKeepDraftOperationPlanningResult } from "../port/index.js";
import {
  captureNovelConflictRecord,
  type NovelConflictRecord,
} from "./NovelConflict.js";

export interface NovelEntityKeepDraftStrategyOptions {
  readonly identityFactory: Pick<NovelIdentityFactory, "createOperationId">;
  readonly clock: NovelClock;
  readonly logger?: Logger;
}

export interface PlanNovelEntityKeepDraftInput {
  readonly sourceOperation: NovelOperation;
  readonly conflict: NovelConflictRecord;
  readonly currentEntity: Character | Location | undefined;
}

export class NovelEntityKeepDraftStrategy {
  private readonly logger: Logger;

  constructor(private readonly options: NovelEntityKeepDraftStrategyOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_entity_keep_draft_strategy",
    });
  }

  plan(
    input: PlanNovelEntityKeepDraftInput,
  ): NovelKeepDraftOperationPlanningResult {
    const conflict = captureNovelConflictRecord(input.conflict).conflict;
    const intent = captureNovelEntityProfileOperationIntent(
      input.sourceOperation,
    );
    if (
      conflict.operationId !== input.sourceOperation.operationId ||
      conflict.entityType !== intent.entityType ||
      conflict.entityId !== intent.id ||
      (input.currentEntity !== undefined &&
        input.currentEntity.id !== intent.id)
    ) {
      throw rejected();
    }

    const result = intent.entityType === "character"
      ? this.planCharacter(intent, conflict.kind, input.currentEntity)
      : this.planLocation(intent, conflict.kind, input.currentEntity);
    this.logger.debug("novel_keep_draft_strategy.planned", {
      conflictId: conflict.id,
      conflictKind: conflict.kind,
      entityType: intent.entityType,
      action: result.action,
    });
    return result;
  }

  private planCharacter(
    intent: Extract<
      ReturnType<typeof captureNovelEntityProfileOperationIntent>,
      { readonly entityType: "character" }
    >,
    conflictKind: NovelConflictRecord["conflict"]["kind"],
    currentEntity: Character | Location | undefined,
  ): NovelKeepDraftOperationPlanningResult {
    const current = currentEntity as Character | undefined;
    if (intent.action === "create") {
      if (conflictKind !== "entity-created" || current === undefined) {
        throw rejected();
      }
      return profilesEqual(intent.profile, current)
        ? skip()
        : {
            action: "apply-replacement",
            operation: createCharacterReplaceOperation({
              operationId: this.options.identityFactory.createOperationId(),
              id: intent.id,
              expectedEntityVersion: current.entityVersion,
              profile: intent.profile,
              timestamp: this.options.clock.now(),
            }),
          };
    }
    if (intent.action === "replace") {
      if (conflictKind === "entity-deleted" && current === undefined) {
        return {
          action: "apply-replacement",
          operation: createCharacterCreateOperation({
            operationId: this.options.identityFactory.createOperationId(),
            id: intent.id,
            profile: intent.profile,
            timestamp: this.options.clock.now(),
          }),
        };
      }
      if (conflictKind !== "field-modified" || current === undefined) {
        throw rejected();
      }
      return profilesEqual(intent.profile, current)
        ? skip()
        : {
            action: "apply-replacement",
            operation: createCharacterReplaceOperation({
              operationId: this.options.identityFactory.createOperationId(),
              id: intent.id,
              expectedEntityVersion: current.entityVersion,
              profile: intent.profile,
              timestamp: this.options.clock.now(),
            }),
          };
    }
    if (conflictKind === "entity-deleted" && current === undefined) {
      return skip();
    }
    if (
      current === undefined ||
      (conflictKind !== "field-modified" &&
        conflictKind !== "domain-invariant")
    ) {
      throw rejected();
    }
    return {
      action: "apply-replacement",
      operation: createCharacterDeleteOperation({
        operationId: this.options.identityFactory.createOperationId(),
        id: intent.id,
        expectedEntityVersion: current.entityVersion,
      }),
    };
  }

  private planLocation(
    intent: Extract<
      ReturnType<typeof captureNovelEntityProfileOperationIntent>,
      { readonly entityType: "location" }
    >,
    conflictKind: NovelConflictRecord["conflict"]["kind"],
    currentEntity: Character | Location | undefined,
  ): NovelKeepDraftOperationPlanningResult {
    const current = currentEntity as Location | undefined;
    if (intent.action === "create") {
      if (conflictKind !== "entity-created" || current === undefined) {
        throw rejected();
      }
      return profilesEqual(intent.profile, current)
        ? skip()
        : {
            action: "apply-replacement",
            operation: createLocationReplaceOperation({
              operationId: this.options.identityFactory.createOperationId(),
              id: intent.id,
              expectedEntityVersion: current.entityVersion,
              profile: intent.profile,
              timestamp: this.options.clock.now(),
            }),
          };
    }
    if (intent.action === "replace") {
      if (conflictKind === "entity-deleted" && current === undefined) {
        return {
          action: "apply-replacement",
          operation: createLocationCreateOperation({
            operationId: this.options.identityFactory.createOperationId(),
            id: intent.id,
            profile: intent.profile,
            timestamp: this.options.clock.now(),
          }),
        };
      }
      if (conflictKind !== "field-modified" || current === undefined) {
        throw rejected();
      }
      return profilesEqual(intent.profile, current)
        ? skip()
        : {
            action: "apply-replacement",
            operation: createLocationReplaceOperation({
              operationId: this.options.identityFactory.createOperationId(),
              id: intent.id,
              expectedEntityVersion: current.entityVersion,
              profile: intent.profile,
              timestamp: this.options.clock.now(),
            }),
          };
    }
    if (conflictKind === "entity-deleted" && current === undefined) {
      return skip();
    }
    if (
      current === undefined ||
      (conflictKind !== "field-modified" &&
        conflictKind !== "domain-invariant")
    ) {
      throw rejected();
    }
    return {
      action: "apply-replacement",
      operation: createLocationDeleteOperation({
        operationId: this.options.identityFactory.createOperationId(),
        id: intent.id,
        expectedEntityVersion: current.entityVersion,
      }),
    };
  }
}

function profilesEqual(
  expected: StableEntityProfile,
  current: Character | Location,
): boolean {
  return expected.name === current.name &&
    expected.summary === current.summary &&
    expected.initialState === current.initialState &&
    expected.authorNotes === current.authorNotes &&
    expected.aliases.length === current.aliases.length &&
    expected.aliases.every((alias, index) => alias === current.aliases[index]);
}

function skip(): NovelKeepDraftOperationPlanningResult {
  return Object.freeze({ action: "skip" });
}

function rejected(): NovelInvariantViolationError {
  return new NovelInvariantViolationError(
    NOVEL_INVARIANT_FAILURE.operationRejected,
  );
}
