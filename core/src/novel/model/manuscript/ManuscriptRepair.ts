/** Immutable Tombstone and Anchor Redirect records for Manuscript structural repair. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureManuscriptBlockId,
  captureManuscriptId,
  capturePublicationChapterId,
  type ManuscriptBlockId,
  type ManuscriptId,
  type PublicationChapterId,
} from "../../identity/index.js";
import { captureOrderKey, type OrderKey } from "../outline/OrderKey.js";
import {
  captureManuscriptAnchor,
  type ManuscriptAnchor,
} from "./ManuscriptAnchor.js";

export const MANUSCRIPT_TOMBSTONE_REASON = {
  deleted: "deleted",
  merged: "merged",
} as const;

export type ManuscriptTombstoneReason =
  (typeof MANUSCRIPT_TOMBSTONE_REASON)[keyof typeof MANUSCRIPT_TOMBSTONE_REASON];

export const MANUSCRIPT_REDIRECT_REASON = {
  split: "split",
  merge: "merge",
  manualRepair: "manual-repair",
} as const;

export type ManuscriptRedirectReason =
  (typeof MANUSCRIPT_REDIRECT_REASON)[keyof typeof MANUSCRIPT_REDIRECT_REASON];

export const MANUSCRIPT_REPAIR_REVIEW = {
  automatic: "automatic",
  required: "review-required",
} as const;

export type ManuscriptRepairReview =
  (typeof MANUSCRIPT_REPAIR_REVIEW)[keyof typeof MANUSCRIPT_REPAIR_REVIEW];

export interface ManuscriptBlockTombstone {
  readonly blockId: ManuscriptBlockId;
  readonly manuscriptId: ManuscriptId;
  readonly formerChapterId: PublicationChapterId;
  readonly formerOrderKey: OrderKey;
  readonly reason: ManuscriptTombstoneReason;
  readonly replacementBlockId?: ManuscriptBlockId;
}

export interface ManuscriptAnchorRedirect {
  readonly source: ManuscriptAnchor;
  readonly target: ManuscriptAnchor;
  readonly reason: ManuscriptRedirectReason;
  readonly review: ManuscriptRepairReview;
}

const TOMBSTONE_KEYS = new Set([
  "blockId",
  "manuscriptId",
  "formerChapterId",
  "formerOrderKey",
  "reason",
  "replacementBlockId",
]);
const REDIRECT_KEYS = new Set(["source", "target", "reason", "review"]);

export function captureManuscriptBlockTombstone(
  value: unknown,
): ManuscriptBlockTombstone {
  const candidate = captureRecord(value, TOMBSTONE_KEYS);
  const reason = captureTombstoneReason(candidate.reason);
  const replacementBlockId = candidate.replacementBlockId === undefined
    ? undefined
    : captureManuscriptBlockId(candidate.replacementBlockId);
  const blockId = captureManuscriptBlockId(candidate.blockId);
  if (
    (reason === MANUSCRIPT_TOMBSTONE_REASON.deleted &&
      replacementBlockId !== undefined) ||
    (reason === MANUSCRIPT_TOMBSTONE_REASON.merged &&
      (replacementBlockId === undefined || replacementBlockId === blockId))
  ) {
    throw invalidRepair();
  }
  return Object.freeze({
    blockId,
    manuscriptId: captureManuscriptId(candidate.manuscriptId),
    formerChapterId: capturePublicationChapterId(candidate.formerChapterId),
    formerOrderKey: captureOrderKey(candidate.formerOrderKey),
    reason,
    ...(replacementBlockId === undefined ? {} : { replacementBlockId }),
  });
}

export function captureManuscriptAnchorRedirect(
  value: unknown,
): ManuscriptAnchorRedirect {
  const candidate = captureRecord(value, REDIRECT_KEYS);
  const source = captureManuscriptAnchor(candidate.source);
  const target = captureManuscriptAnchor(candidate.target);
  const reason = captureRedirectReason(candidate.reason);
  const review = captureReview(candidate.review);
  if (
    (source.blockId === target.blockId && source.boundary === target.boundary) ||
    (reason === MANUSCRIPT_REDIRECT_REASON.split &&
      review !== MANUSCRIPT_REPAIR_REVIEW.automatic) ||
    (reason !== MANUSCRIPT_REDIRECT_REASON.split &&
      review !== MANUSCRIPT_REPAIR_REVIEW.required)
  ) {
    throw invalidRepair();
  }
  return Object.freeze({ source, target, reason, review });
}

export function manuscriptAnchorKey(anchor: ManuscriptAnchor): string {
  const captured = captureManuscriptAnchor(anchor);
  return `${captured.blockId}:${captured.boundary}`;
}

function captureRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
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
    throw invalidRepair();
  }
  return value as Record<string, unknown>;
}

function captureTombstoneReason(value: unknown): ManuscriptTombstoneReason {
  if (
    value !== MANUSCRIPT_TOMBSTONE_REASON.deleted &&
    value !== MANUSCRIPT_TOMBSTONE_REASON.merged
  ) {
    throw invalidRepair();
  }
  return value;
}

function captureRedirectReason(value: unknown): ManuscriptRedirectReason {
  if (
    value !== MANUSCRIPT_REDIRECT_REASON.split &&
    value !== MANUSCRIPT_REDIRECT_REASON.merge &&
    value !== MANUSCRIPT_REDIRECT_REASON.manualRepair
  ) {
    throw invalidRepair();
  }
  return value;
}

function captureReview(value: unknown): ManuscriptRepairReview {
  if (
    value !== MANUSCRIPT_REPAIR_REVIEW.automatic &&
    value !== MANUSCRIPT_REPAIR_REVIEW.required
  ) {
    throw invalidRepair();
  }
  return value;
}

function invalidRepair(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidManuscriptRepair,
    "manuscriptRepair",
  );
}
