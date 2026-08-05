/** Deterministic structural StoryUnit conformance evaluation from Paragraphs. */
import {
  STORY_UNIT_CONFORMANCE_STATUS,
  type StoryUnitConformanceResult,
} from "../model/index.js";
import { captureNovelRevision, type NovelRevision } from "../version/index.js";
import type { Paragraph } from "../model/index.js";

export interface StoryUnitConformanceEvaluationInput {
  readonly paragraphs: readonly Paragraph[];
  readonly hasAcceptedPlan: boolean;
  readonly currentRevision: NovelRevision;
}

/**
 * V1 structural conformance: an accepted leaf plan plus non-empty Paragraphs
 * is conforming. Semantic Event/entity-change matching remains a future host
 * extension; finding types are preserved for that purpose.
 */
export class StoryUnitConformanceEvaluator {
  evaluate(
    input: StoryUnitConformanceEvaluationInput,
  ): StoryUnitConformanceResult {
    const currentRevision = captureNovelRevision(input.currentRevision);
    if (input.paragraphs.length === 0) {
      return Object.freeze({
        status: STORY_UNIT_CONFORMANCE_STATUS.pending,
        checkedNovelRevision: currentRevision,
        findings: Object.freeze([]),
      });
    }
    if (!input.hasAcceptedPlan) {
      return Object.freeze({
        status: STORY_UNIT_CONFORMANCE_STATUS.nonConforming,
        checkedNovelRevision: currentRevision,
        findings: Object.freeze([
          Object.freeze({
            type: "missing-event",
            severity: "error",
            note: "StoryUnit has no accepted leaf plan",
            paragraphIds: Object.freeze([]),
          }),
        ]),
      });
    }
    return Object.freeze({
      status: STORY_UNIT_CONFORMANCE_STATUS.conforming,
      checkedNovelRevision: currentRevision,
      findings: Object.freeze([]),
    });
  }
}
