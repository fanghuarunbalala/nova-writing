/** Rebuilds disposable projection cache entries from current authoritative sources. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  captureNovelId,
  type NovelId,
} from "../identity/index.js";
import type {
  NovelProjectionSourceReader,
  NovelProjectionStore,
} from "../port/index.js";
import {
  NOVEL_PROJECTION_TARGET_KIND,
  NovelProjectionPlanner,
  canonicalizeNovelProjectionTarget,
  captureNovelProjectionCacheEntry,
  captureNovelProjectionTarget,
  type EntityProfileReadinessPolicy,
  type NovelProjectionCacheEntry,
  type NovelProjectionTarget,
  type NovelProjectionValue,
} from "../projection/index.js";
import {
  NOVEL_RECOVERY_PHASE,
  captureNovelRecoveryPhaseResult,
  type NovelRecoveryPhaseResult,
} from "./NovelRecovery.js";
import type { NovelRecoveryStage } from "./NovelRecoveryCoordinator.js";

export interface NovelProjectionRecoveryServiceOptions {
  readonly sourceReader: NovelProjectionSourceReader;
  readonly store: NovelProjectionStore;
  readonly readinessPolicy: EntityProfileReadinessPolicy;
  readonly logger?: Logger;
}

export class NovelProjectionRecoveryService implements NovelRecoveryStage {
  readonly phase = NOVEL_RECOVERY_PHASE.projection;
  private readonly logger: Logger;

  constructor(private readonly options: NovelProjectionRecoveryServiceOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_projection_recovery_service",
    });
  }

  async recover(novelIdInput: NovelId): Promise<NovelRecoveryPhaseResult> {
    const novelId = captureNovelId(novelIdInput);
    this.logger.info("novel_projection_recovery.started", { novelId });
    const [context, inventory] = await Promise.all([
      this.options.sourceReader.readProjectionContext(novelId),
      this.options.store.inspectTargets(novelId),
    ]);
    const targets = captureInventory(inventory);
    const planner = new NovelProjectionPlanner(
      context.outline,
      context.source,
      context.ranges,
      this.options.readinessPolicy,
    );
    const entries: NovelProjectionCacheEntry[] = [];
    let removedCount = inventory.corruptCount;
    for (const target of targets) {
      const projection = projectTarget(planner, target);
      if (projection === undefined) {
        removedCount += 1;
        continue;
      }
      entries.push(captureNovelProjectionCacheEntry({ target, projection }));
    }
    await this.options.store.replaceCache({
      novelId,
      rebuildRevision: context.source.currentRevision,
      entries,
    });
    const result = captureNovelRecoveryPhaseResult({
      phase: this.phase,
      inspectedCount: inventory.storedCount,
      repairedCount: entries.length,
      removedCount,
      retainedCount: 0,
      publishedCount: 0,
    });
    this.logger.info("novel_projection_recovery.completed", {
      novelId,
      inspectedCount: result.inspectedCount,
      rebuiltCount: result.repairedCount,
      removedCount: result.removedCount,
    });
    return result;
  }
}

function projectTarget(
  planner: NovelProjectionPlanner,
  target: NovelProjectionTarget,
): NovelProjectionValue | undefined {
  switch (target.kind) {
    case NOVEL_PROJECTION_TARGET_KIND.characterState:
      return planner.projectCharacterState(target);
    case NOVEL_PROJECTION_TARGET_KIND.locationState:
      return planner.projectLocationState(target);
    case NOVEL_PROJECTION_TARGET_KIND.readiness:
      return planner.projectReadiness(target);
    case NOVEL_PROJECTION_TARGET_KIND.characterRelationship:
      return planner.projectCharacterRelationship(target);
    case NOVEL_PROJECTION_TARGET_KIND.storyUnitConformance:
      return planner.projectStoryUnitConformance(target.storyUnitId);
  }
}

function captureInventory(value: Awaited<ReturnType<NovelProjectionStore["inspectTargets"]>>): readonly NovelProjectionTarget[] {
  if (
    !Number.isSafeInteger(value.storedCount) ||
    value.storedCount < 0 ||
    !Number.isSafeInteger(value.corruptCount) ||
    value.corruptCount < 0 ||
    !Array.isArray(value.targets) ||
    value.storedCount !== value.targets.length + value.corruptCount
  ) {
    throw new TypeError("Novel projection inventory is invalid");
  }
  const targets = value.targets.map(captureNovelProjectionTarget);
  const keys = targets.map(canonicalizeNovelProjectionTarget);
  if (new Set(keys).size !== keys.length) {
    throw new TypeError("Novel projection inventory is invalid");
  }
  return Object.freeze(targets);
}
