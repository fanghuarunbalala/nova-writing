/** Revision-bound StoryUnit conformance value contracts referencing Paragraphs. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureParagraphId,
  type ParagraphId,
} from "../../identity/index.js";
import {
  captureNovelRevision,
  type NovelRevision,
} from "../../version/index.js";

export const STORY_UNIT_CONFORMANCE_STATUS = {
  pending: "pending",
  conforming: "conforming",
  nonConforming: "non-conforming",
  stale: "stale",
} as const;

export type StoryUnitConformanceStatus =
  (typeof STORY_UNIT_CONFORMANCE_STATUS)[keyof typeof STORY_UNIT_CONFORMANCE_STATUS];

export const STORY_UNIT_CONFORMANCE_FINDING_TYPE = {
  missingEvent: "missing-event",
  unexpectedEvent: "unexpected-event",
  characterMismatch: "character-mismatch",
  locationMismatch: "location-mismatch",
  timeMismatch: "time-mismatch",
  missingEntityChange: "missing-entity-change",
  contradictoryEntityChange: "contradictory-entity-change",
  rhythmMismatch: "rhythm-mismatch",
  other: "other",
} as const;

export type StoryUnitConformanceFindingType =
  (typeof STORY_UNIT_CONFORMANCE_FINDING_TYPE)[keyof typeof STORY_UNIT_CONFORMANCE_FINDING_TYPE];

export const STORY_UNIT_CONFORMANCE_SEVERITY = {
  warning: "warning",
  error: "error",
} as const;

export type StoryUnitConformanceSeverity =
  (typeof STORY_UNIT_CONFORMANCE_SEVERITY)[keyof typeof STORY_UNIT_CONFORMANCE_SEVERITY];

export interface StoryUnitConformanceFinding {
  readonly type: StoryUnitConformanceFindingType;
  readonly severity: StoryUnitConformanceSeverity;
  readonly note: string;
  readonly paragraphIds: readonly ParagraphId[];
}

export interface StoryUnitConformanceResult {
  readonly status: StoryUnitConformanceStatus;
  readonly checkedNovelRevision: NovelRevision;
  readonly findings: readonly StoryUnitConformanceFinding[];
}

const FINDING_KEYS = new Set([
  "type",
  "severity",
  "note",
  "paragraphIds",
]);
const RESULT_KEYS = new Set([
  "status",
  "checkedNovelRevision",
  "findings",
]);

export function captureStoryUnitConformanceFinding(
  value: unknown,
): StoryUnitConformanceFinding {
  const candidate = captureRecord(value, FINDING_KEYS, invalidConformance);
  captureDenseArray(candidate.paragraphIds, invalidConformance);
  return Object.freeze({
    type: captureFindingType(candidate.type),
    severity: captureSeverity(candidate.severity),
    note: captureNote(candidate.note),
    paragraphIds: Object.freeze(
      candidate.paragraphIds.map(captureParagraphId),
    ),
  });
}

export function captureStoryUnitConformanceResult(
  value: unknown,
): StoryUnitConformanceResult {
  const candidate = captureRecord(value, RESULT_KEYS, invalidConformance);
  captureDenseArray(candidate.findings, invalidConformance);
  const status = captureConformanceStatus(candidate.status);
  const findings = Object.freeze(
    candidate.findings.map(captureStoryUnitConformanceFinding),
  );
  const hasError = findings.some(
    (finding) => finding.severity === STORY_UNIT_CONFORMANCE_SEVERITY.error,
  );
  if (
    (status === STORY_UNIT_CONFORMANCE_STATUS.pending && findings.length > 0) ||
    (status === STORY_UNIT_CONFORMANCE_STATUS.conforming && hasError) ||
    (status === STORY_UNIT_CONFORMANCE_STATUS.nonConforming && !hasError)
  ) {
    throw invalidConformance();
  }
  return Object.freeze({
    status,
    checkedNovelRevision: captureNovelRevision(candidate.checkedNovelRevision),
    findings,
  });
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

function captureDenseArray(
  value: unknown,
  invalid: () => NovelProtocolValidationError,
): asserts value is unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.keys(value).length !== value.length
  ) {
    throw invalid();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw invalid();
    }
  }
}

function captureConformanceStatus(value: unknown): StoryUnitConformanceStatus {
  if (!Object.values(STORY_UNIT_CONFORMANCE_STATUS).includes(
    value as StoryUnitConformanceStatus,
  )) {
    throw invalidConformance();
  }
  return value as StoryUnitConformanceStatus;
}

function captureFindingType(value: unknown): StoryUnitConformanceFindingType {
  if (!Object.values(STORY_UNIT_CONFORMANCE_FINDING_TYPE).includes(
    value as StoryUnitConformanceFindingType,
  )) {
    throw invalidConformance();
  }
  return value as StoryUnitConformanceFindingType;
}

function captureSeverity(value: unknown): StoryUnitConformanceSeverity {
  if (!Object.values(STORY_UNIT_CONFORMANCE_SEVERITY).includes(
    value as StoryUnitConformanceSeverity,
  )) {
    throw invalidConformance();
  }
  return value as StoryUnitConformanceSeverity;
}

function captureNote(value: unknown): string {
  if (typeof value !== "string" || value.length > 4_000) {
    throw invalidConformance();
  }
  return value;
}

function invalidConformance(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidStoryUnitConformance,
    "storyUnitConformance",
  );
}
