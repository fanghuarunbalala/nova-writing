/** Stable Node Configuration failures without paths, payloads, or raw causes. */

export const NODE_CONFIGURATION_STORE_FAILURE = Object.freeze({
  readFailed: "read_failed",
  invalidDocument: "invalid_document",
  writeFailed: "write_failed",
  revisionConflict: "revision_conflict",
  lockTimeout: "lock_timeout",
  workspaceMissing: "workspace_missing",
} as const);

export type NodeConfigurationStoreFailure =
  (typeof NODE_CONFIGURATION_STORE_FAILURE)[keyof typeof NODE_CONFIGURATION_STORE_FAILURE];

export class NodeConfigurationStoreError extends Error {
  readonly failure: NodeConfigurationStoreFailure;
  readonly retryable: boolean;

  constructor(failure: NodeConfigurationStoreFailure, retryable = false) {
    super(`Node Configuration Store failed: ${failure}`);
    this.name = "NodeConfigurationStoreError";
    this.failure = failure;
    this.retryable = retryable;
  }
}
