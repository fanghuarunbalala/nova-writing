/** Stable redacted failure data; raw Error values never cross Runtime IPC. */
export const RUNTIME_IPC_ERROR_CATEGORY = {
  validation: "validation",
  protocol: "protocol",
  conflict: "conflict",
  cancelled: "cancelled",
  unavailable: "unavailable",
  internal: "internal",
} as const;

export type RuntimeIpcErrorCategory =
  (typeof RUNTIME_IPC_ERROR_CATEGORY)[keyof typeof RUNTIME_IPC_ERROR_CATEGORY];

export interface RuntimeIpcErrorSnapshot {
  readonly code: string;
  readonly category: RuntimeIpcErrorCategory;
  readonly retryable: boolean;
}
