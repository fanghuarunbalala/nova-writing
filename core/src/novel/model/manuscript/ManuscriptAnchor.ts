/** Stable Block-boundary anchors and half-open Manuscript Range value objects. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureManuscriptBlockId,
  type ManuscriptBlockId,
} from "../../identity/index.js";

export const MANUSCRIPT_ANCHOR_BOUNDARY = {
  before: "before",
  after: "after",
} as const;

export type ManuscriptAnchorBoundary =
  (typeof MANUSCRIPT_ANCHOR_BOUNDARY)[keyof typeof MANUSCRIPT_ANCHOR_BOUNDARY];

export interface ManuscriptAnchor {
  readonly blockId: ManuscriptBlockId;
  readonly boundary: ManuscriptAnchorBoundary;
}

export interface ManuscriptRange {
  readonly start: ManuscriptAnchor;
  readonly end: ManuscriptAnchor;
}

const ANCHOR_KEYS = new Set(["blockId", "boundary"]);
const RANGE_KEYS = new Set(["start", "end"]);

export function captureManuscriptAnchor(value: unknown): ManuscriptAnchor {
  const candidate = captureRecord(value, ANCHOR_KEYS, invalidAnchor);
  return Object.freeze({
    blockId: captureManuscriptBlockId(candidate.blockId),
    boundary: captureBoundary(candidate.boundary),
  });
}

export function captureManuscriptRange(value: unknown): ManuscriptRange {
  const candidate = captureRecord(value, RANGE_KEYS, invalidRange);
  try {
    return Object.freeze({
      start: captureManuscriptAnchor(candidate.start),
      end: captureManuscriptAnchor(candidate.end),
    });
  } catch (error) {
    if (error instanceof NovelProtocolValidationError) throw invalidRange();
    throw error;
  }
}

function captureRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  invalid: () => NovelProtocolValidationError,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length > 0 ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (descriptor) => !("value" in descriptor) || !descriptor.enumerable,
    ) ||
    Object.keys(value).some((key) => !allowedKeys.has(key))
  ) {
    throw invalid();
  }
  return value as Record<string, unknown>;
}

function captureBoundary(value: unknown): ManuscriptAnchorBoundary {
  if (
    value !== MANUSCRIPT_ANCHOR_BOUNDARY.before &&
    value !== MANUSCRIPT_ANCHOR_BOUNDARY.after
  ) {
    throw invalidAnchor();
  }
  return value;
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
