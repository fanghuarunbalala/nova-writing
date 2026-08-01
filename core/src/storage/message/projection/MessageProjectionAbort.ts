import { MessageProjectionMaintenanceAbortedError } from "./MessageProjectionMaintenanceErrors.js";

export function throwIfMessageProjectionAborted(
  conversationId: string,
  signal?: AbortSignal,
): void {
  if (signal?.aborted !== true) return;
  throw new MessageProjectionMaintenanceAbortedError(conversationId, {
    cause: signal.reason,
  });
}
