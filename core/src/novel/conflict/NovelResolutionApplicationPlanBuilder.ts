/** Builds and durably records the one-entry-per-source-Operation resolution plan. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  NovelDraftSessionNotFoundError,
  NovelInvariantViolationError,
  NovelResolutionApplicationPlanIdentityConflictError,
  NOVEL_INVARIANT_FAILURE,
} from "../error/index.js";
import type { NovelOperationDigester } from "../operation/index.js";
import type {
  NovelClock,
  NovelConflictStore,
  NovelDraftChangeSetStore,
  NovelDraftStore,
  NovelKeepDraftOperationPlanner,
  NovelResolutionApplicationPlanStore,
} from "../port/index.js";
import {
  captureNovelRebaseCandidate,
  type NovelRebaseCandidate,
} from "./NovelRebaseCandidate.js";
import {
  NOVEL_RESOLUTION_APPLICATION_PLAN_VERSION,
  canonicalizeNovelResolutionApplicationPlan,
  captureNovelResolutionApplicationPlan,
  captureNovelResolutionApplicationPlanContent,
  type NovelResolutionApplicationEntry,
  type NovelResolutionApplicationPlan,
  type NovelResolutionApplicationPlanDigester,
} from "./NovelResolutionApplicationPlan.js";

export interface NovelResolutionApplicationPlanBuilderOptions {
  readonly draftStore: NovelDraftStore;
  readonly operationStore: NovelDraftChangeSetStore;
  readonly conflictStore: NovelConflictStore;
  readonly keepDraftPlanner: NovelKeepDraftOperationPlanner;
  readonly operationDigester: NovelOperationDigester;
  readonly planDigester: NovelResolutionApplicationPlanDigester;
  readonly planStore: NovelResolutionApplicationPlanStore;
  readonly clock: NovelClock;
  readonly logger?: Logger;
}

export interface NovelResolutionApplicationPlanBuildResult {
  readonly status: "recorded" | "duplicate";
  readonly plan: NovelResolutionApplicationPlan;
}

export class NovelResolutionApplicationPlanBuilder {
  private readonly logger: Logger;

  constructor(
    private readonly options: NovelResolutionApplicationPlanBuilderOptions,
  ) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_resolution_application_plan_builder",
    });
  }

  async buildAndSave(
    candidateInput: NovelRebaseCandidate,
  ): Promise<NovelResolutionApplicationPlanBuildResult> {
    const candidate = captureNovelRebaseCandidate(candidateInput);
    const sourceSession = await this.options.draftStore.getDraftSession(
      candidate.session.novelId,
      candidate.sourceDraftSessionId,
    );
    if (sourceSession === undefined) {
      throw new NovelDraftSessionNotFoundError(candidate.sourceDraftSessionId);
    }
    if (
      sourceSession.novelId !== candidate.session.novelId ||
      sourceSession.baseRevision !== candidate.sourceBaseRevision
    ) {
      throw corrupt(candidate);
    }

    const sourceSequence = await this.options.operationStore
      .readOperationSequence(sourceSession);
    for (const entry of sourceSequence.operations) {
      if (
        (await this.options.operationDigester.digest(entry.operation)) !==
        entry.operationDigest
      ) {
        throw corrupt(candidate);
      }
    }

    const conflicts = await this.options.conflictStore.listAllConflicts(
      candidate.session,
    );
    const resolutions = await this.options.conflictStore.listResolutions(
      candidate.session,
    );
    const conflictBySequence = new Map<number, (typeof conflicts)[number]>();
    const sourceEntryBySequence = new Map(
      sourceSequence.operations.map((entry) => [entry.sequence, entry] as const),
    );
    const conflictById = new Map(
      conflicts.map((record) => [record.conflict.id, record] as const),
    );
    for (const record of conflicts) {
      const conflict = record.conflict;
      if (
        conflict.draftSessionId !== candidate.session.id ||
        conflictBySequence.has(conflict.sourceOperationSequence) ||
        sourceEntryBySequence.get(conflict.sourceOperationSequence)?.operation
            .operationId !== conflict.operationId
      ) {
        throw corrupt(candidate);
      }
      conflictBySequence.set(conflict.sourceOperationSequence, record);
    }
    if (
      candidate.operationCount !==
        sourceSequence.operationCount - conflictBySequence.size ||
      candidate.lastOperationSequence !== candidate.operationCount
    ) {
      throw corrupt(candidate);
    }
    const resolutionByConflictId = new Map(
      resolutions.map((resolution) => [resolution.conflictId, resolution] as const),
    );
    if (
      resolutionByConflictId.size !== resolutions.length ||
      resolutions.some(
        (resolution) =>
          resolution.draftSessionId !== candidate.session.id ||
          !conflictById.has(resolution.conflictId),
      ) ||
      conflicts.some((record) => !resolutionByConflictId.has(record.conflict.id))
    ) {
      throw corrupt(candidate);
    }

    const entries: NovelResolutionApplicationEntry[] = [];
    for (const sourceEntry of sourceSequence.operations) {
      const conflictRecord = conflictBySequence.get(sourceEntry.sequence);
      if (conflictRecord === undefined) {
        entries.push(Object.freeze({
          sourceSequence: sourceEntry.sequence,
          action: "apply-original",
          operation: sourceEntry.operation,
          operationDigest: sourceEntry.operationDigest,
        }));
        continue;
      }
      if (conflictRecord.conflict.operationId !== sourceEntry.operation.operationId) {
        throw corrupt(candidate);
      }
      const resolution = resolutionByConflictId.get(conflictRecord.conflict.id);
      if (resolution === undefined) throw corrupt(candidate);
      switch (resolution.resolution.strategy) {
        case "keep-canonical":
        case "drop-operation":
          entries.push(Object.freeze({
            sourceSequence: sourceEntry.sequence,
            action: "skip",
            conflictId: conflictRecord.conflict.id,
            strategy: resolution.resolution.strategy,
          }));
          break;
        case "manual":
          entries.push(Object.freeze({
            sourceSequence: sourceEntry.sequence,
            action: "apply-replacement",
            conflictId: conflictRecord.conflict.id,
            strategy: "manual",
            operation: resolution.resolution.replacement,
            operationDigest: await this.options.operationDigester.digest(
              resolution.resolution.replacement,
            ),
          }));
          break;
        case "keep-draft": {
          const planned = await this.options.keepDraftPlanner.planKeepDraft({
            sourceSession,
            candidate,
            sourceEntry,
            conflict: conflictRecord,
          });
          if (planned.action === "skip") {
            entries.push(Object.freeze({
              sourceSequence: sourceEntry.sequence,
              action: "skip",
              conflictId: conflictRecord.conflict.id,
              strategy: "keep-draft",
            }));
          } else {
            entries.push(Object.freeze({
              sourceSequence: sourceEntry.sequence,
              action: "apply-replacement",
              conflictId: conflictRecord.conflict.id,
              strategy: "keep-draft",
              operation: planned.operation,
              operationDigest: await this.options.operationDigester.digest(
                planned.operation,
              ),
            }));
          }
          break;
        }
      }
    }

    const existing = await this.options.planStore.getPlan(candidate.session);
    const content = captureNovelResolutionApplicationPlanContent({
      planVersion: NOVEL_RESOLUTION_APPLICATION_PLAN_VERSION,
      sourceDraftSessionId: sourceSession.id,
      conflictedCandidateDraftSessionId: candidate.session.id,
      baseRevision: candidate.session.baseRevision,
      sourceOperationCount: sourceSequence.operationCount,
      effectiveOperationCount: entries.filter((entry) => entry.action !== "skip")
        .length,
      entries,
      createdAt: existing?.createdAt ?? this.options.clock.now(),
    });
    const plan = captureNovelResolutionApplicationPlan({
      ...content,
      digest: await this.options.planDigester.digest(content),
    });
    if (existing !== undefined) {
      if (
        existing.digest !== plan.digest ||
        canonicalizeNovelResolutionApplicationPlan(existing) !==
          canonicalizeNovelResolutionApplicationPlan(plan)
      ) {
        throw new NovelResolutionApplicationPlanIdentityConflictError(
          candidate.session.id,
        );
      }
      this.logger.debug("novel_resolution_plan.duplicate", {
        draftSessionId: candidate.session.id,
        sourceDraftSessionId: sourceSession.id,
        sourceOperationCount: plan.sourceOperationCount,
        effectiveOperationCount: plan.effectiveOperationCount,
      });
      return Object.freeze({ status: "duplicate", plan: existing });
    }
    const status = await this.options.planStore.savePlan(candidate.session, plan);
    this.logger.info("novel_resolution_plan.saved", {
      draftSessionId: candidate.session.id,
      sourceDraftSessionId: sourceSession.id,
      sourceOperationCount: plan.sourceOperationCount,
      effectiveOperationCount: plan.effectiveOperationCount,
    });
    return Object.freeze({ status, plan });
  }
}

function corrupt(
  candidate: NovelRebaseCandidate,
): NovelInvariantViolationError {
  return new NovelInvariantViolationError(
    NOVEL_INVARIANT_FAILURE.persistenceInvariant,
    candidate.session.novelId,
    candidate.session.id,
  );
}
