/** Defines provider-neutral startup recovery phases and aggregate summaries. */
import {
  captureNovelId,
  type NovelId,
} from "../identity/index.js";

export const NOVEL_RECOVERY_PHASE = {
  commit: "commit",
  rebase: "rebase",
  draft: "draft",
  projection: "projection",
  outbox: "outbox",
} as const;

export type NovelRecoveryPhase =
  (typeof NOVEL_RECOVERY_PHASE)[keyof typeof NOVEL_RECOVERY_PHASE];

export const NOVEL_RECOVERY_PHASE_ORDER: readonly NovelRecoveryPhase[] =
  Object.freeze([
    NOVEL_RECOVERY_PHASE.commit,
    NOVEL_RECOVERY_PHASE.rebase,
    NOVEL_RECOVERY_PHASE.draft,
    NOVEL_RECOVERY_PHASE.projection,
    NOVEL_RECOVERY_PHASE.outbox,
  ]);

export interface NovelRecoveryPhaseResult {
  readonly phase: NovelRecoveryPhase;
  readonly inspectedCount: number;
  readonly repairedCount: number;
  readonly removedCount: number;
  readonly retainedCount: number;
  readonly publishedCount: number;
}

export interface NovelRecoveryResult {
  readonly novelId: NovelId;
  readonly phases: readonly NovelRecoveryPhaseResult[];
  readonly inspectedCount: number;
  readonly repairedCount: number;
  readonly removedCount: number;
  readonly retainedCount: number;
  readonly publishedCount: number;
}

export function captureNovelRecoveryPhaseResult(
  value: NovelRecoveryPhaseResult,
): NovelRecoveryPhaseResult {
  if (!isRecoveryPhase(value.phase)) throw invalidRecoveryResult();
  return Object.freeze({
    phase: value.phase,
    inspectedCount: captureCount(value.inspectedCount),
    repairedCount: captureCount(value.repairedCount),
    removedCount: captureCount(value.removedCount),
    retainedCount: captureCount(value.retainedCount),
    publishedCount: captureCount(value.publishedCount),
  });
}

export function captureNovelRecoveryResult(
  value: NovelRecoveryResult,
): NovelRecoveryResult {
  const novelId = captureNovelId(value.novelId);
  if (!Array.isArray(value.phases)) throw invalidRecoveryResult();
  const phases = Object.freeze(
    value.phases.map((phase) => captureNovelRecoveryPhaseResult(phase)),
  );
  if (
    phases.length !== NOVEL_RECOVERY_PHASE_ORDER.length ||
    phases.some((phase, index) => phase.phase !== NOVEL_RECOVERY_PHASE_ORDER[index])
  ) {
    throw invalidRecoveryResult();
  }
  const result = Object.freeze({
    novelId,
    phases,
    inspectedCount: captureCount(value.inspectedCount),
    repairedCount: captureCount(value.repairedCount),
    removedCount: captureCount(value.removedCount),
    retainedCount: captureCount(value.retainedCount),
    publishedCount: captureCount(value.publishedCount),
  });
  if (
    result.inspectedCount !== sum(phases, "inspectedCount") ||
    result.repairedCount !== sum(phases, "repairedCount") ||
    result.removedCount !== sum(phases, "removedCount") ||
    result.retainedCount !== sum(phases, "retainedCount") ||
    result.publishedCount !== sum(phases, "publishedCount")
  ) {
    throw invalidRecoveryResult();
  }
  return result;
}

function isRecoveryPhase(value: unknown): value is NovelRecoveryPhase {
  return NOVEL_RECOVERY_PHASE_ORDER.includes(value as NovelRecoveryPhase);
}

function captureCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidRecoveryResult();
  }
  return value as number;
}

function sum(
  phases: readonly NovelRecoveryPhaseResult[],
  field: keyof Pick<
    NovelRecoveryPhaseResult,
    | "inspectedCount"
    | "repairedCount"
    | "removedCount"
    | "retainedCount"
    | "publishedCount"
  >,
): number {
  return phases.reduce((total, phase) => total + phase[field], 0);
}

function invalidRecoveryResult(): TypeError {
  return new TypeError("Novel recovery result is invalid");
}
