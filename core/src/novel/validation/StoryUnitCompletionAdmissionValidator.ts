/** Deterministically admits a current conforming leaf Realization to completed state. */
import {
  captureStoryUnitRealization,
  STORY_UNIT_CONFORMANCE_STATUS,
  type ManuscriptRange,
  type StoryOutlineTree,
  type StoryUnit,
  type StoryUnitRealization,
} from "../model/index.js";
import {
  captureStoryUnit,
} from "../model/outline/StoryUnit.js";
import { STORY_UNIT_REALIZATION_STATUS } from "../model/outline/StoryUnitStatus.js";
import {
  captureNovelRevision,
  type NovelRevision,
} from "../version/index.js";
import {
  MANUSCRIPT_RANGE_REPAIR_STATUS,
  type ManuscriptRangeRepairValidator,
} from "./ManuscriptRangeRepairValidator.js";

export const STORY_UNIT_COMPLETION_REJECTION = {
  storyUnitMissing: "story-unit-missing",
  storyUnitNotLeaf: "story-unit-not-leaf",
  storyUnitInactive: "story-unit-inactive",
  rangesMissing: "ranges-missing",
  realizationRevisionStale: "realization-revision-stale",
  validationRevisionStale: "validation-revision-stale",
  validationNotConforming: "validation-not-conforming",
  rangeUnresolved: "range-unresolved",
  rangeInverted: "range-inverted",
} as const;

export type StoryUnitCompletionRejection =
  (typeof STORY_UNIT_COMPLETION_REJECTION)[keyof typeof STORY_UNIT_COMPLETION_REJECTION];

export type StoryUnitCompletionAdmission =
  | {
      readonly status: "admitted";
      readonly storyUnit: StoryUnit;
      readonly realization: StoryUnitRealization;
      readonly resolvedRanges: readonly ManuscriptRange[];
      readonly reviewedRepairCount: number;
    }
  | {
      readonly status: "rejected";
      readonly storyUnitId: StoryUnitRealization["storyUnitId"];
      readonly reason: StoryUnitCompletionRejection;
    };

export class StoryUnitCompletionAdmissionValidator {
  private readonly currentRevision: NovelRevision;

  constructor(
    private readonly outline: StoryOutlineTree,
    currentRevision: NovelRevision,
    private readonly ranges: ManuscriptRangeRepairValidator,
  ) {
    this.currentRevision = captureNovelRevision(currentRevision);
  }

  evaluate(value: unknown): StoryUnitCompletionAdmission {
    const realization = captureStoryUnitRealization(value);
    const unit = this.outline.getUnit(realization.storyUnitId);
    if (unit === undefined) {
      return rejected(realization, STORY_UNIT_COMPLETION_REJECTION.storyUnitMissing);
    }
    if (this.outline.listChildren(unit.id).length > 0) {
      return rejected(realization, STORY_UNIT_COMPLETION_REJECTION.storyUnitNotLeaf);
    }
    if (
      unit.realizationStatus === STORY_UNIT_REALIZATION_STATUS.abandoned ||
      unit.blockState !== undefined
    ) {
      return rejected(realization, STORY_UNIT_COMPLETION_REJECTION.storyUnitInactive);
    }
    if (realization.ranges.length === 0) {
      return rejected(realization, STORY_UNIT_COMPLETION_REJECTION.rangesMissing);
    }
    if (realization.sourceRevision !== this.currentRevision) {
      return rejected(
        realization,
        STORY_UNIT_COMPLETION_REJECTION.realizationRevisionStale,
      );
    }
    if (realization.validation.checkedNovelRevision !== this.currentRevision) {
      return rejected(
        realization,
        STORY_UNIT_COMPLETION_REJECTION.validationRevisionStale,
      );
    }
    if (
      realization.validation.status !== STORY_UNIT_CONFORMANCE_STATUS.conforming
    ) {
      return rejected(
        realization,
        STORY_UNIT_COMPLETION_REJECTION.validationNotConforming,
      );
    }

    const resolvedRanges: ManuscriptRange[] = [];
    let reviewedRepairCount = 0;
    for (const range of realization.ranges) {
      const resolution = this.ranges.resolve(range);
      if (resolution.status === MANUSCRIPT_RANGE_REPAIR_STATUS.unresolved) {
        return rejected(realization, STORY_UNIT_COMPLETION_REJECTION.rangeUnresolved);
      }
      if (resolution.status === MANUSCRIPT_RANGE_REPAIR_STATUS.inverted) {
        return rejected(realization, STORY_UNIT_COMPLETION_REJECTION.rangeInverted);
      }
      resolvedRanges.push(resolution.resolvedRange);
      if (resolution.reviewRequired) reviewedRepairCount += 1;
    }
    return Object.freeze({
      status: "admitted",
      storyUnit: captureStoryUnit({
        ...unit,
        realizationStatus: STORY_UNIT_REALIZATION_STATUS.completed,
      }),
      realization,
      resolvedRanges: Object.freeze(resolvedRanges),
      reviewedRepairCount,
    });
  }
}

function rejected(
  realization: StoryUnitRealization,
  reason: StoryUnitCompletionRejection,
): StoryUnitCompletionAdmission {
  return Object.freeze({
    status: "rejected",
    storyUnitId: realization.storyUnitId,
    reason,
  });
}
