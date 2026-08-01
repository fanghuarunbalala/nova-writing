/** Stable Runtime Input Pump errors without handler messages, stacks, or causes. */
import type { RuntimeInputPumpState } from "./RuntimeInputPump.js";

export const RUNTIME_INPUT_PUMP_OPERATION = {
  start: "start",
  wake: "wake",
} as const;

export type RuntimeInputPumpOperation =
  (typeof RUNTIME_INPUT_PUMP_OPERATION)[keyof typeof RUNTIME_INPUT_PUMP_OPERATION];

export class RuntimeInputPumpStateError extends Error {
  readonly code = "RUNTIME_INPUT_PUMP_STATE_INVALID";

  constructor(
    public readonly conversationId: string,
    public readonly operation: RuntimeInputPumpOperation,
    public readonly state: RuntimeInputPumpState,
  ) {
    super(`Runtime Input Pump cannot ${operation} while ${state}`);
    this.name = "RuntimeInputPumpStateError";
  }
}

export class RuntimeInputPumpFailureError extends Error {
  override readonly name = "RuntimeInputPumpFailureError";
  readonly code = "RUNTIME_INPUT_PUMP_FAILED" as const;

  constructor(
    public readonly conversationId: string,
    public readonly scope: "control" | "turn" | "scheduler",
  ) {
    super("Runtime Input Pump failed");
  }
}
