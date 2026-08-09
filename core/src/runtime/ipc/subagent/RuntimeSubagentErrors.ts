/**
 * 稳定的子代理 RPC 失败码：不含 Store、路径、载荷或原始错误细节。
 * Stable subagent RPC failures without Store, path, payload, or raw error details.
 */
import type { RuntimeSubagentRpcMethod } from "./RuntimeSubagentProtocol.js";

export type RuntimeSubagentProtocolFailure =
  | "method_not_allowed"
  | "invalid_request"
  | "invalid_response"
  | "identity_mismatch";

export class RuntimeSubagentProtocolError extends TypeError {
  readonly code = "RUNTIME_SUBAGENT_PROTOCOL_INVALID";

  constructor(
    readonly failure: RuntimeSubagentProtocolFailure,
    readonly method?: RuntimeSubagentRpcMethod,
  ) {
    super("Runtime subagent protocol value is invalid");
    this.name = "RuntimeSubagentProtocolError";
  }
}

export class RuntimeSubagentRequestError extends Error {
  readonly code = "RUNTIME_SUBAGENT_REQUEST_FAILED";

  constructor(
    readonly operation: RuntimeSubagentRpcMethod,
    readonly failure:
      | "remote_failure"
      | "invalid_response"
      | "identity_mismatch"
      | "cancelled",
  ) {
    super("Runtime subagent request failed");
    this.name = "RuntimeSubagentRequestError";
  }
}
