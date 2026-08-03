/** Resolves Anchor and Range ordering against one current immutable Manuscript. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../error/index.js";
import type { ManuscriptBlockId } from "../identity/index.js";
import {
  MANUSCRIPT_ANCHOR_BOUNDARY,
  captureManuscriptAnchor,
  captureManuscriptRange,
  type ManuscriptAnchor,
  type ManuscriptCatalog,
  type ManuscriptRange,
} from "../model/manuscript/index.js";

export class ManuscriptAnchorValidator {
  private readonly positionsByBlockId: ReadonlyMap<ManuscriptBlockId, number>;

  constructor(private readonly manuscript: ManuscriptCatalog) {
    this.positionsByBlockId = new Map(
      manuscript.listAllBlocks().map((block, index) => [block.id, index * 2]),
    );
  }

  validateAnchor(value: unknown): ManuscriptAnchor {
    const anchor = captureManuscriptAnchor(value);
    this.resolvePosition(anchor, invalidAnchor);
    return anchor;
  }

  validateRange(value: unknown): ManuscriptRange {
    const range = captureManuscriptRange(value);
    const start = this.resolvePosition(range.start, invalidRange);
    const end = this.resolvePosition(range.end, invalidRange);
    if (start > end) throw invalidRange();
    return range;
  }

  compareAnchors(leftValue: unknown, rightValue: unknown): -1 | 0 | 1 {
    const left = this.validateAnchor(leftValue);
    const right = this.validateAnchor(rightValue);
    const leftPosition = this.resolvePosition(left, invalidAnchor);
    const rightPosition = this.resolvePosition(right, invalidAnchor);
    return leftPosition < rightPosition ? -1 : leftPosition > rightPosition ? 1 : 0;
  }

  private resolvePosition(
    anchor: ManuscriptAnchor,
    invalid: () => NovelProtocolValidationError,
  ): number {
    const blockPosition = this.positionsByBlockId.get(anchor.blockId);
    if (blockPosition === undefined) throw invalid();
    return anchor.boundary === MANUSCRIPT_ANCHOR_BOUNDARY.before
      ? blockPosition
      : blockPosition + 1;
  }
}

function invalidAnchor(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidManuscriptAnchor,
    "manuscriptAnchor",
  );
}

function invalidRange(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidManuscriptRange,
    "manuscriptRange",
  );
}
