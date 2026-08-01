/** Stable cancellation causes shared by Run, Turn, Input, Tool, and child lifecycles. */
export const EXECUTION_CANCELLATION_REASON = {
  stop: "stop",
  interrupt: "interrupt",
  parentStop: "parent_stop",
  runtimeShutdown: "runtime_shutdown",
  runtimeReplaced: "runtime_replaced",
} as const;

export type ExecutionCancellationReason =
  (typeof EXECUTION_CANCELLATION_REASON)[keyof typeof EXECUTION_CANCELLATION_REASON];

export function isExecutionCancellationReason(
  value: unknown,
): value is ExecutionCancellationReason {
  return (
    typeof value === "string" &&
    Object.values(EXECUTION_CANCELLATION_REASON).includes(value as ExecutionCancellationReason)
  );
}
