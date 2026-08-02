/** Stable persistence RPC failures without Store, path, payload, or raw error details. */
import type { RuntimePersistenceRpcMethod } from "./RuntimePersistenceProtocol.js";

export type RuntimePersistenceProtocolFailure =
  | "method_not_allowed"
  | "invalid_request"
  | "invalid_response"
  | "identity_mismatch"
  | "sequence_mismatch";

export class RuntimePersistenceProtocolError extends TypeError {
  readonly code = "RUNTIME_PERSISTENCE_PROTOCOL_INVALID";

  constructor(
    readonly failure: RuntimePersistenceProtocolFailure,
    readonly method?: RuntimePersistenceRpcMethod,
  ) {
    super("Runtime persistence protocol value is invalid");
    this.name = "RuntimePersistenceProtocolError";
  }
}

export class RuntimePersistenceRequestError extends Error {
  readonly code = "RUNTIME_PERSISTENCE_REQUEST_FAILED";

  constructor(
    readonly operation: RuntimePersistenceRpcMethod,
    readonly failure:
      | "remote_failure"
      | "invalid_response"
      | "identity_mismatch"
      | "cancelled",
  ) {
    super("Runtime persistence request failed");
    this.name = "RuntimePersistenceRequestError";
  }
}
