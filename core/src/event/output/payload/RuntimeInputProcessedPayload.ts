/** Terminal semantic outcome for one durable InputEvent inside a Runtime. */
import type { JsonObject } from "../../protocol/JsonValue.js";
import {
  isExecutionCancellationReason,
  type ExecutionCancellationReason,
} from "../../../runtime/execution/ExecutionCancellationReason.js";
import { OutputPayload } from "../OutputPayload.js";

export const RUNTIME_INPUT_PROCESSING_OUTCOME = {
  consumed: "consumed",
  cancelledBeforeRun: "cancelled_before_run",
  failed: "failed",
} as const;

export type RuntimeInputProcessingOutcome =
  (typeof RUNTIME_INPUT_PROCESSING_OUTCOME)[keyof typeof RUNTIME_INPUT_PROCESSING_OUTCOME];

export const RUNTIME_INPUT_PROCESSING_FAILURE_CODE = {
  unsupportedInput: "unsupported_input",
  invalidRuntimeState: "invalid_runtime_state",
  processingFailed: "processing_failed",
} as const;

export type RuntimeInputProcessingFailureCode =
  (typeof RUNTIME_INPUT_PROCESSING_FAILURE_CODE)[keyof typeof RUNTIME_INPUT_PROCESSING_FAILURE_CODE];

export type RuntimeInputProcessedPayloadOptions =
  | {
      outcome: "consumed";
    }
  | {
      outcome: "cancelled_before_run";
      cancellationReason: ExecutionCancellationReason;
    }
  | {
      outcome: "failed";
      failureCode: RuntimeInputProcessingFailureCode;
    };

export class RuntimeInputProcessedPayload extends OutputPayload {
  readonly outcome: RuntimeInputProcessingOutcome;
  readonly cancellationReason?: ExecutionCancellationReason;
  readonly failureCode?: RuntimeInputProcessingFailureCode;

  constructor(options: RuntimeInputProcessedPayloadOptions) {
    super();
    this.outcome = options.outcome;

    if (options.outcome === RUNTIME_INPUT_PROCESSING_OUTCOME.cancelledBeforeRun) {
      if (!isExecutionCancellationReason(options.cancellationReason)) {
        throw new TypeError("Cancelled Input requires a registered cancellation reason");
      }
      if ("failureCode" in options && options.failureCode !== undefined) {
        throw new TypeError("Cancelled Input must not contain a failure code");
      }
      this.cancellationReason = options.cancellationReason;
      return;
    }

    if (options.outcome === RUNTIME_INPUT_PROCESSING_OUTCOME.failed) {
      if (!isRuntimeInputProcessingFailureCode(options.failureCode)) {
        throw new TypeError("Failed Input requires a registered failure code");
      }
      if ("cancellationReason" in options && options.cancellationReason !== undefined) {
        throw new TypeError("Failed Input must not contain a cancellation reason");
      }
      this.failureCode = options.failureCode;
      return;
    }

    if (options.outcome !== RUNTIME_INPUT_PROCESSING_OUTCOME.consumed) {
      throw new TypeError("Runtime Input processing outcome must be registered");
    }
    if (
      ("cancellationReason" in options && options.cancellationReason !== undefined) ||
      ("failureCode" in options && options.failureCode !== undefined)
    ) {
      throw new TypeError("Consumed Input must not contain cancellation or failure details");
    }
  }

  toObject(): JsonObject {
    return {
      outcome: this.outcome,
      ...(this.cancellationReason !== undefined
        ? { cancellationReason: this.cancellationReason }
        : {}),
      ...(this.failureCode !== undefined ? { failureCode: this.failureCode } : {}),
    };
  }
}

export function isRuntimeInputProcessingFailureCode(
  value: unknown,
): value is RuntimeInputProcessingFailureCode {
  return (
    typeof value === "string" &&
    Object.values(RUNTIME_INPUT_PROCESSING_FAILURE_CODE).includes(
      value as RuntimeInputProcessingFailureCode,
    )
  );
}
