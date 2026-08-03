/** Composes the five accepted Novel startup recovery phases behind one Node entry point. */
import {
  NOVEL_RECOVERY_PHASE,
  NovelCommitRecoveryStage,
  NovelDraftRecoveryStage,
  NovelOutboxRecoveryStage,
  NovelRecoveryCoordinator,
  captureNovelId,
  type NovelCommitRecoveryRunner,
  type NovelDraftRecoveryRunner,
  type NovelId,
  type NovelOutboxRecoveryRunner,
  type NovelRecoveryResult,
  type NovelRecoveryStage,
} from "../../../novel/index.js";
import type { Logger } from "../../../observability/index.js";

export interface NodeNovelRecoveryApplicationOptions {
  readonly novelId: NovelId;
  readonly commitRecovery: NovelCommitRecoveryRunner;
  readonly rebaseRecovery: NovelRecoveryStage;
  readonly draftRecovery: NovelDraftRecoveryRunner;
  readonly projectionRecovery: NovelRecoveryStage;
  readonly outboxRecovery: NovelOutboxRecoveryRunner;
  readonly logger?: Logger;
}

export interface NodeNovelRecoveryApplication {
  readonly novelId: NovelId;
  recover(): Promise<NovelRecoveryResult>;
}

export function createNodeNovelRecoveryApplication(
  options: NodeNovelRecoveryApplicationOptions,
): NodeNovelRecoveryApplication {
  const novelId = captureNovelId(options.novelId);
  assertPhase(options.rebaseRecovery, NOVEL_RECOVERY_PHASE.rebase);
  assertPhase(options.projectionRecovery, NOVEL_RECOVERY_PHASE.projection);
  const coordinator = new NovelRecoveryCoordinator({
    stages: [
      new NovelCommitRecoveryStage(options.commitRecovery),
      options.rebaseRecovery,
      new NovelDraftRecoveryStage(options.draftRecovery),
      options.projectionRecovery,
      new NovelOutboxRecoveryStage(options.outboxRecovery),
    ],
    logger: options.logger,
  });
  return Object.freeze({
    novelId,
    recover: () => coordinator.recover(novelId),
  });
}

function assertPhase(
  stage: NovelRecoveryStage,
  phase: NovelRecoveryStage["phase"],
): void {
  if (
    stage === null ||
    typeof stage !== "object" ||
    stage.phase !== phase ||
    typeof stage.recover !== "function"
  ) {
    throw new TypeError("Node Novel recovery stage is invalid");
  }
}
