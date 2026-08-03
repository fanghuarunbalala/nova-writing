/** Classifies a Range after resolving structural Redirects against current Block order. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../error/index.js";
import {
  captureManuscriptRange,
  type ManuscriptAnchor,
  type ManuscriptAnchorResolution,
  type ManuscriptCatalog,
  type ManuscriptRange,
  type ManuscriptRepairCatalog,
} from "../model/index.js";
import { ManuscriptAnchorValidator } from "./ManuscriptAnchorValidator.js";

export const MANUSCRIPT_RANGE_REPAIR_STATUS = {
  valid: "valid",
  reviewRequired: "review-required",
  unresolved: "unresolved",
  inverted: "inverted",
} as const;

export type ManuscriptRangeRepairStatus =
  (typeof MANUSCRIPT_RANGE_REPAIR_STATUS)[keyof typeof MANUSCRIPT_RANGE_REPAIR_STATUS];

interface ManuscriptRangeRepairResultBase {
  readonly source: ManuscriptRange;
  readonly start: ManuscriptAnchorResolution;
  readonly end: ManuscriptAnchorResolution;
}

export type ManuscriptRangeRepairResult =
  | (ManuscriptRangeRepairResultBase & {
      readonly status: "valid";
      readonly resolvedRange: ManuscriptRange;
      readonly reviewRequired: false;
    })
  | (ManuscriptRangeRepairResultBase & {
      readonly status: "review-required";
      readonly resolvedRange: ManuscriptRange;
      readonly reviewRequired: true;
    })
  | (ManuscriptRangeRepairResultBase & {
      readonly status: "unresolved";
      readonly reviewRequired: true;
    })
  | (ManuscriptRangeRepairResultBase & {
      readonly status: "inverted";
      readonly resolvedRange: ManuscriptRange;
      readonly reviewRequired: true;
    });

export class ManuscriptRangeRepairValidator {
  private readonly anchors: ManuscriptAnchorValidator;

  constructor(
    manuscript: ManuscriptCatalog,
    private readonly repairs: ManuscriptRepairCatalog,
  ) {
    if (
      manuscript.getSnapshot().manuscript.id !== repairs.getManuscriptId()
    ) {
      throw invalidRepair();
    }
    this.anchors = new ManuscriptAnchorValidator(manuscript);
  }

  resolve(value: unknown): ManuscriptRangeRepairResult {
    const source = captureManuscriptRange(value);
    const start = this.repairs.resolveAnchor(source.start);
    const end = this.repairs.resolveAnchor(source.end);
    if (!hasResolvedAnchor(start) || !hasResolvedAnchor(end)) {
      return Object.freeze({
        status: MANUSCRIPT_RANGE_REPAIR_STATUS.unresolved,
        source,
        start,
        end,
        reviewRequired: true,
      });
    }
    const resolvedRange = captureManuscriptRange({
      start: start.anchor,
      end: end.anchor,
    });
    if (this.anchors.compareAnchors(resolvedRange.start, resolvedRange.end) > 0) {
      return Object.freeze({
        status: MANUSCRIPT_RANGE_REPAIR_STATUS.inverted,
        source,
        start,
        end,
        resolvedRange,
        reviewRequired: true,
      });
    }
    const reviewRequired = start.reviewRequired || end.reviewRequired;
    return Object.freeze({
      status: reviewRequired
        ? MANUSCRIPT_RANGE_REPAIR_STATUS.reviewRequired
        : MANUSCRIPT_RANGE_REPAIR_STATUS.valid,
      source,
      start,
      end,
      resolvedRange,
      reviewRequired,
    }) as ManuscriptRangeRepairResult;
  }
}

function hasResolvedAnchor(
  resolution: ManuscriptAnchorResolution,
): resolution is ManuscriptAnchorResolution & { readonly anchor: ManuscriptAnchor } {
  return resolution.status === "active" || resolution.status === "redirected";
}

function invalidRepair(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidManuscriptRepair,
    "manuscriptRepair",
  );
}
