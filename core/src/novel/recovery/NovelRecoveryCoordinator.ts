/** Runs restart recovery once in the accepted dependency-safe phase order. */
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  captureNovelId,
  type NovelId,
} from "../identity/index.js";
import {
  NOVEL_RECOVERY_PHASE_ORDER,
  captureNovelRecoveryPhaseResult,
  captureNovelRecoveryResult,
  type NovelRecoveryPhase,
  type NovelRecoveryPhaseResult,
  type NovelRecoveryResult,
} from "./NovelRecovery.js";

export interface NovelRecoveryStage {
  readonly phase: NovelRecoveryPhase;
  recover(novelId: NovelId): Promise<NovelRecoveryPhaseResult>;
}

export interface NovelRecoveryCoordinatorOptions {
  readonly stages: readonly NovelRecoveryStage[];
  readonly logger?: Logger;
}

export class NovelRecoveryCoordinator {
  private readonly stages: ReadonlyMap<NovelRecoveryPhase, NovelRecoveryStage>;
  private readonly logger: Logger;
  private recovery?: Promise<NovelRecoveryResult>;
  private recoveryNovelId?: NovelId;

  constructor(options: NovelRecoveryCoordinatorOptions) {
    this.stages = captureStages(options.stages);
    this.logger = (options.logger ?? noopLogger).child({
      component: "novel_recovery_coordinator",
    });
  }

  recover(novelIdInput: NovelId): Promise<NovelRecoveryResult> {
    const novelId = captureNovelId(novelIdInput);
    if (this.recovery !== undefined) {
      if (this.recoveryNovelId !== novelId) {
        return Promise.reject(new TypeError("Novel recovery is already active"));
      }
      return this.recovery;
    }
    this.recoveryNovelId = novelId;
    this.recovery = this.recoverOnce(novelId).finally(() => {
      this.recovery = undefined;
      this.recoveryNovelId = undefined;
    });
    return this.recovery;
  }

  private async recoverOnce(novelId: NovelId): Promise<NovelRecoveryResult> {
    this.logger.info("novel_recovery.started", { novelId });
    const phases: NovelRecoveryPhaseResult[] = [];
    for (const phase of NOVEL_RECOVERY_PHASE_ORDER) {
      this.logger.debug("novel_recovery.phase_started", { novelId, phase });
      try {
        const result = captureNovelRecoveryPhaseResult(
          await this.stages.get(phase)!.recover(novelId),
        );
        if (result.phase !== phase) throw new TypeError("Novel recovery phase mismatch");
        phases.push(result);
        this.logger.debug("novel_recovery.phase_completed", {
          novelId,
          phase,
          inspectedCount: result.inspectedCount,
          repairedCount: result.repairedCount,
          removedCount: result.removedCount,
          retainedCount: result.retainedCount,
          publishedCount: result.publishedCount,
        });
      } catch {
        this.logger.error("novel_recovery.phase_failed", { novelId, phase });
        throw new NovelRecoveryPhaseError(phase);
      }
    }
    const result = captureNovelRecoveryResult({
      novelId,
      phases,
      inspectedCount: sum(phases, "inspectedCount"),
      repairedCount: sum(phases, "repairedCount"),
      removedCount: sum(phases, "removedCount"),
      retainedCount: sum(phases, "retainedCount"),
      publishedCount: sum(phases, "publishedCount"),
    });
    this.logger.info("novel_recovery.completed", {
      novelId,
      inspectedCount: result.inspectedCount,
      repairedCount: result.repairedCount,
      removedCount: result.removedCount,
      retainedCount: result.retainedCount,
      publishedCount: result.publishedCount,
    });
    return result;
  }
}

export class NovelRecoveryPhaseError extends Error {
  readonly phase: NovelRecoveryPhase;

  constructor(phase: NovelRecoveryPhase) {
    super("Novel recovery phase failed");
    this.name = "NovelRecoveryPhaseError";
    this.phase = phase;
  }
}

function captureStages(
  stages: readonly NovelRecoveryStage[],
): ReadonlyMap<NovelRecoveryPhase, NovelRecoveryStage> {
  if (!Array.isArray(stages)) throw invalidStages();
  const captured = new Map<NovelRecoveryPhase, NovelRecoveryStage>();
  for (const stage of stages) {
    if (
      stage === null ||
      typeof stage !== "object" ||
      !NOVEL_RECOVERY_PHASE_ORDER.includes(stage.phase) ||
      typeof stage.recover !== "function" ||
      captured.has(stage.phase)
    ) {
      throw invalidStages();
    }
    captured.set(stage.phase, stage);
  }
  if (
    captured.size !== NOVEL_RECOVERY_PHASE_ORDER.length ||
    NOVEL_RECOVERY_PHASE_ORDER.some((phase) => !captured.has(phase))
  ) {
    throw invalidStages();
  }
  return captured;
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

function invalidStages(): TypeError {
  return new TypeError("Novel recovery stages are invalid");
}
