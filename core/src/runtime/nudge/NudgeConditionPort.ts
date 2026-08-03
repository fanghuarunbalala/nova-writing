/** Bounded async condition evaluation and resolution boundary for Nudges. */
import { noopLogger, type Logger } from "../../observability/index.js";
import type {
  NudgeConditionReference,
  PendingNudge,
} from "./NudgeProtocol.js";
import type {
  NudgeConditionResolutionRequest as StoreNudgeConditionResolutionRequest,
  PendingNudgeStore,
} from "./PendingNudgeStore.js";
import {
  NUDGE_CONDITION_FAILURE,
  NudgeConditionError,
} from "./NudgeConditionErrors.js";

export interface NudgeConditionEvaluationInput {
  readonly nudgeId: string;
  readonly targetRunId: string;
  readonly conditionRef: NudgeConditionReference;
  readonly evaluatedAt: string;
  readonly currentTurnNumber?: number;
  readonly signal: AbortSignal;
}

export interface NudgeConditionEvaluation {
  readonly matched: boolean;
}

export interface NudgeConditionEvaluator {
  evaluate(input: NudgeConditionEvaluationInput): Promise<NudgeConditionEvaluation>;
}

export interface NudgeConditionInput {
  readonly nudgeId: string;
  readonly targetRunId: string;
  readonly conditionRef: NudgeConditionReference;
  readonly evaluatedAt: string;
  readonly currentTurnNumber?: number;
  readonly signal?: AbortSignal;
}

export interface NudgeConditionResult {
  readonly status: "not_matched" | "resolved";
  readonly nudge?: PendingNudge;
}

export interface NudgeConditionPort {
  resolve(input: NudgeConditionInput): Promise<NudgeConditionResult>;
}

export interface NudgeConditionCoordinatorOptions {
  readonly store: PendingNudgeStore;
  readonly evaluator: NudgeConditionEvaluator;
  readonly timeoutMs: number;
  readonly logger?: Logger;
}

export class NudgeConditionCoordinator implements NudgeConditionPort {
  readonly #store: PendingNudgeStore;
  readonly #evaluator: NudgeConditionEvaluator;
  readonly #timeoutMs: number;
  readonly #logger: Logger;

  constructor(options: NudgeConditionCoordinatorOptions) {
    if (!options?.store || !options?.evaluator) {
      throw new TypeError("Nudge condition dependencies are invalid");
    }
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) {
      throw new TypeError("Nudge condition timeout is invalid");
    }
    this.#store = options.store;
    this.#evaluator = options.evaluator;
    this.#timeoutMs = options.timeoutMs;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "nudge_condition_coordinator",
    });
  }

  async resolve(input: NudgeConditionInput): Promise<NudgeConditionResult> {
    const captured = captureInput(input);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    if (captured.signal) {
      if (captured.signal.aborted) controller.abort();
      else captured.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    this.#logger.debug("runtime.nudge.condition_started", {
      nudgeId: captured.nudgeId,
      targetRunId: captured.targetRunId,
    });
    let evaluation: NudgeConditionEvaluation;
    try {
      evaluation = await Promise.race([
        this.#evaluator.evaluate({
          ...captured,
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new ConditionEvaluationTimeout()), this.#timeoutMs);
        }),
      ]);
      if (controller.signal.aborted) throw new ConditionEvaluationTimeout();
      if (!isEvaluation(evaluation)) throw new Error();
    } catch {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        throw new NudgeConditionError(
          NUDGE_CONDITION_FAILURE.evaluationTimeout,
          captured.nudgeId,
          captured.targetRunId,
        );
      }
      throw new NudgeConditionError(
        NUDGE_CONDITION_FAILURE.evaluationFailed,
        captured.nudgeId,
        captured.targetRunId,
      );
    }
    clearTimeout(timer);
    if (!evaluation.matched) {
      return Object.freeze({ status: "not_matched" });
    }
    let nudge: PendingNudge;
    try {
      const request: StoreNudgeConditionResolutionRequest = {
        nudgeId: captured.nudgeId,
        targetRunId: captured.targetRunId,
        conditionRef: captured.conditionRef,
        resolvedAt: captured.evaluatedAt,
      };
      nudge = await this.#store.resolveCondition(request);
    } catch {
      throw new NudgeConditionError(
        NUDGE_CONDITION_FAILURE.storeFailed,
        captured.nudgeId,
        captured.targetRunId,
      );
    }
    this.#logger.info("runtime.nudge.condition_resolved", {
      nudgeId: captured.nudgeId,
      targetRunId: captured.targetRunId,
    });
    return Object.freeze({ status: "resolved", nudge });
  }
}

class ConditionEvaluationTimeout extends Error {}

function captureInput(input: NudgeConditionInput): NudgeConditionInput {
  if (!isRecord(input) || !isReference(input.conditionRef)) {
    throw new NudgeConditionError(NUDGE_CONDITION_FAILURE.invalidRequest);
  }
  const nudgeId = captureNonBlank(input.nudgeId);
  const targetRunId = captureNonBlank(input.targetRunId);
  const evaluatedAt = captureTimestamp(input.evaluatedAt);
  const currentTurnNumber = input.currentTurnNumber;
  if (!nudgeId || !targetRunId || !evaluatedAt ||
      (currentTurnNumber !== undefined &&
        (!Number.isSafeInteger(currentTurnNumber) || currentTurnNumber < 1))) {
    throw new NudgeConditionError(
      NUDGE_CONDITION_FAILURE.invalidRequest,
      nudgeId,
      targetRunId,
    );
  }
  return Object.freeze({
    nudgeId,
    targetRunId,
    conditionRef: Object.freeze({
      id: input.conditionRef.id,
      version: input.conditionRef.version,
    }),
    evaluatedAt,
    ...(currentTurnNumber === undefined ? {} : { currentTurnNumber }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
}

function isEvaluation(value: unknown): value is NudgeConditionEvaluation {
  return isRecord(value) && typeof value.matched === "boolean" &&
    Object.keys(value).every((key) => key === "matched");
}

function isReference(value: unknown): value is NudgeConditionReference {
  return isRecord(value) &&
    captureNonBlank(value.id) !== undefined &&
    captureNonBlank(value.version) !== undefined &&
    Object.keys(value).every((key) => key === "id" || key === "version");
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function captureNonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function captureTimestamp(value: unknown): string | undefined {
  return typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
    ? value
    : undefined;
}
