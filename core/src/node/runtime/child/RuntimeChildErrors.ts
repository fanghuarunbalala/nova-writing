/** Stable Parent/Child endpoint failures without payload or Runtime diagnostics. */
import type { RuntimeIpcErrorCategory } from "../../../runtime/ipc/index.js";

export class ParentRuntimeChildHandshakeError extends Error {
  readonly code = "PARENT_RUNTIME_CHILD_HANDSHAKE_FAILED";

  constructor(readonly failure: "invalid_hello" | "unsupported_protocol") {
    super("Parent Runtime child handshake failed");
    this.name = "ParentRuntimeChildHandshakeError";
  }
}

export class ParentRuntimeChildEndpointError extends Error {
  readonly code = "PARENT_RUNTIME_CHILD_ENDPOINT_FAILED";

  constructor(
    readonly operation: "bootstrap" | "dispatch_input" | "shutdown",
    readonly failure: "request_failed" | "invalid_response" | "identity_mismatch",
  ) {
    super("Parent Runtime child endpoint failed");
    this.name = "ParentRuntimeChildEndpointError";
  }
}

export class RuntimeChildEntrypointError extends Error {
  readonly code = "RUNTIME_CHILD_ENTRYPOINT_FAILED";

  constructor(readonly failure: "invalid_welcome" | "rejected" | "connection_closed") {
    super("Runtime child entrypoint failed");
    this.name = "RuntimeChildEntrypointError";
  }
}

export class RuntimeChildRequestError extends Error {
  constructor(
    readonly code: string,
    readonly category: RuntimeIpcErrorCategory,
    readonly retryable: boolean,
  ) {
    super("Runtime child request failed");
    this.name = "RuntimeChildRequestError";
  }
}
