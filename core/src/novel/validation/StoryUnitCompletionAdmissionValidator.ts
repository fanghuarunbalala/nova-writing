/** Deterministically admits a current conforming leaf StoryUnit to completed state. */
import {
  STORY_UNIT_CONFORMANCE_STATUS,
  type Paragraph,
  type StoryOutlineTree,
  type StoryUnit,
  type StoryUnitConformanceResult,
} from "../model/index.js";
import { captureStoryUnit } from "../model/outline/StoryUnit.js";
import { STORY_UNIT_REALIZATION_STATUS } from "../model/outline/StoryUnitStatus.js";
import type { NovelRevision } from "../version/index.js";
export const STORY_UNIT_COMPLETION_REJECTION = {
  storyUnitMissing: "story-unit-missing",
  storyUnitNotLeaf: "story-unit-not-leaf",
  storyUnitInactive: "story-unit-inactive",
  paragraphsMissing: "paragraphs-missing",
  planMissing: "plan-missing",
  conformanceNotConforming: "conformance-not-conforming",
} as const;

export type StoryUnitCompletionRejection =
  (typeof STORY_UNIT_COMPLETION_REJECTION)[keyof typeof STORY_UNIT_COMPLETION_REJECTION];

export type StoryUnitCompletionAdmission =
  | {
      readonly status: "admitted";
      readonly storyUnit: StoryUnit;
      readonly conformance: StoryUnitConformanceResult;
    }
  | {
      readonly status: "rejected";
      readonly storyUnitId: StoryUnit["id"];
      readonly reason: StoryUnitCompletionRejection;
    };

export interface StoryUnitCompletionEvaluationInput {
  readonly storyUnitId: StoryUnit["id"];
  readonly paragraphs: readonly Paragraph[];
  readonly hasAcceptedPlan: boolean;
  readonly conformance: StoryUnitConformanceResult;
  readonly currentRevision: NovelRevision;
}

export class StoryUnitCompletionAdmissionValidator {
  constructor(private readonly outline: StoryOutlineTree) {}

  evaluate(input: StoryUnitCompletionEvaluationInput): StoryUnitCompletionAdmission {
    const unit = this.outline.getUnit(input.storyUnitId);
    if (unit === undefined) {
      return rejected(input.storyUnitId, STORY_UNIT_COMPLETION_REJECTION.storyUnitMissing);
    }
    if (this.outline.listChildren(unit.id).length > 0) {
      return rejected(input.storyUnitId, STORY_UNIT_COMPLETION_REJECTION.storyUnitNotLeaf);
    }
    if (
      unit.realizationStatus === STORY_UNIT_REALIZATION_STATUS.abandoned ||
      unit.blockState !== undefined
    ) {
      return rejected(input.storyUnitId, STORY_UNIT_COMPLETION_REJECTION.storyUnitInactive);
    }
    if (input.paragraphs.length === 0) {
      return rejected(input.storyUnitId, STORY_UNIT_COMPLETION_REJECTION.paragraphsMissing);
    }
    if (!input.hasAcceptedPlan) {
      return rejected(input.storyUnitId, STORY_UNIT_COMPLETION_REJECTION.planMissing);
    }
    if (input.conformance.checkedNovelRevision !== input.currentRevision) {
      return rejected(input.storyUnitId, STORY_UNIT_COMPLETION_REJECTION.conformanceNotConforming);
    }
    if (input.conformance.status !== STORY_UNIT_CONFORMANCE_STATUS.conforming) {
      return rejected(input.storyUnitId, STORY_UNIT_COMPLETION_REJECTION.conformanceNotConforming);
    }
    return Object.freeze({
      status: "admitted",
      storyUnit: captureStoryUnit({
        ...unit,
        realizationStatus: STORY_UNIT_REALIZATION_STATUS.completed,
      }),
      conformance: input.conformance,
    });
  }
}

function rejected(
  storyUnitId: StoryUnit["id"],
  reason: StoryUnitCompletionRejection,
): StoryUnitCompletionAdmission {
  return Object.freeze({ status: "rejected", storyUnitId, reason });
}
