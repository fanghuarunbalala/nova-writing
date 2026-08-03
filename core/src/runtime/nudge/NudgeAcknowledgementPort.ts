/** Provider-neutral acknowledgement boundary for externally observed Runtime facts. */
import { noopLogger, type Logger } from "../../observability/index.js";
import type {
  NudgeAcknowledgementReference,
  PendingNudge,
} from "./NudgeProtocol.js";
import type {
  NudgeAcknowledgementRequest as StoreNudgeAcknowledgementRequest,
  PendingNudgeStore,
} from "./PendingNudgeStore.js";
import {
  NUDGE_ACKNOWLEDGEMENT_FAILURE,
  NudgeAcknowledgementError,
} from "./NudgeAcknowledgementErrors.js";

export const NUDGE_ACKNOWLEDGEMENT_SOURCE = {
  runtimeControl: "runtime_control",
  userInput: "user_input",
  approvalDecision: "approval_decision",
  toolResult: "tool_result",
  subagentTerminal: "subagent_terminal",
} as const;

export type NudgeAcknowledgementSource =
  (typeof NUDGE_ACKNOWLEDGEMENT_SOURCE)[keyof typeof NUDGE_ACKNOWLEDGEMENT_SOURCE];

export interface NudgeAcknowledgementInput {
  readonly nudgeId: string;
  readonly targetRunId: string;
  readonly acknowledgementRef: NudgeAcknowledgementReference;
  readonly source: NudgeAcknowledgementSource;
  readonly reasonId?: string;
  readonly acknowledgedAt: string;
}

export interface NudgeAcknowledgementResult {
  readonly nudge: PendingNudge;
  readonly source: NudgeAcknowledgementSource;
  readonly reasonId?: string;
}

export interface NudgeAcknowledgementPort {
  acknowledge(input: NudgeAcknowledgementInput): Promise<NudgeAcknowledgementResult>;
}

export interface NudgeAcknowledgementCoordinatorOptions {
  readonly store: PendingNudgeStore;
  readonly logger?: Logger;
}

export class NudgeAcknowledgementCoordinator implements NudgeAcknowledgementPort {
  readonly #store: PendingNudgeStore;
  readonly #logger: Logger;

  constructor(options: NudgeAcknowledgementCoordinatorOptions) {
    if (!options?.store) throw new TypeError("Nudge acknowledgement Store is invalid");
    this.#store = options.store;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "nudge_acknowledgement_coordinator",
    });
  }

  async acknowledge(input: NudgeAcknowledgementInput): Promise<NudgeAcknowledgementResult> {
    const captured = captureInput(input);
    this.#logger.debug("runtime.nudge.acknowledgement_started", {
      nudgeId: captured.nudgeId,
      targetRunId: captured.targetRunId,
      source: captured.source,
    });
    let nudge: PendingNudge;
    try {
      const request: StoreNudgeAcknowledgementRequest = {
        nudgeId: captured.nudgeId,
        targetRunId: captured.targetRunId,
        acknowledgementRef: captured.acknowledgementRef,
        acknowledgedAt: captured.acknowledgedAt,
      };
      nudge = await this.#store.acknowledge(request);
    } catch {
      throw new NudgeAcknowledgementError(
        NUDGE_ACKNOWLEDGEMENT_FAILURE.storeFailed,
        captured.nudgeId,
        captured.targetRunId,
      );
    }
    this.#logger.info("runtime.nudge.acknowledgement_completed", {
      nudgeId: captured.nudgeId,
      targetRunId: captured.targetRunId,
      source: captured.source,
    });
    return Object.freeze({
      nudge,
      source: captured.source,
      ...(captured.reasonId === undefined ? {} : { reasonId: captured.reasonId }),
    });
  }
}

function captureInput(value: NudgeAcknowledgementInput): NudgeAcknowledgementInput {
  if (!isRecord(value)) {
    throw new NudgeAcknowledgementError(NUDGE_ACKNOWLEDGEMENT_FAILURE.invalidRequest);
  }
  const nudgeId = captureNonBlank(value.nudgeId);
  const targetRunId = captureNonBlank(value.targetRunId);
  const source = value.source;
  const acknowledgedAt = captureTimestamp(value.acknowledgedAt);
  const reasonId = value.reasonId === undefined
    ? undefined
    : captureNonBlank(value.reasonId);
  if (!nudgeId || !targetRunId || !acknowledgedAt ||
      !Object.values(NUDGE_ACKNOWLEDGEMENT_SOURCE).includes(source) ||
      (value.reasonId !== undefined && !reasonId) ||
      !isReference(value.acknowledgementRef)) {
    if (!Object.values(NUDGE_ACKNOWLEDGEMENT_SOURCE).includes(source)) {
      throw new NudgeAcknowledgementError(
        NUDGE_ACKNOWLEDGEMENT_FAILURE.unsupportedSource,
        nudgeId,
        targetRunId,
      );
    }
    throw new NudgeAcknowledgementError(
      NUDGE_ACKNOWLEDGEMENT_FAILURE.invalidRequest,
      nudgeId,
      targetRunId,
    );
  }
  return Object.freeze({
    nudgeId,
    targetRunId,
    acknowledgementRef: Object.freeze({
      id: value.acknowledgementRef.id,
      version: value.acknowledgementRef.version,
    }),
    source,
    ...(reasonId === undefined ? {} : { reasonId }),
    acknowledgedAt,
  });
}

function isReference(value: unknown): value is NudgeAcknowledgementReference {
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
