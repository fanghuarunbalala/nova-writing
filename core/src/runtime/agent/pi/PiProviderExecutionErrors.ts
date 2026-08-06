/** Stable private Provider execution failures without raw Provider data. */
export const PI_PROVIDER_EXECUTION_FAILURE = {
  unsupportedApi: "unsupported_api",
  auth: "auth",
  rateLimit: "rate_limit",
  timeout: "timeout",
  network: "network",
  response: "response",
  cancellation: "cancellation",
} as const;

export type PiProviderExecutionFailure =
  (typeof PI_PROVIDER_EXECUTION_FAILURE)[keyof typeof PI_PROVIDER_EXECUTION_FAILURE];

export class PiProviderExecutionError extends Error {
  override readonly name = "PiProviderExecutionError";
  readonly code = "PI_PROVIDER_EXECUTION_FAILED" as const;

  constructor(readonly failure: PiProviderExecutionFailure) {
    super(`Pi Provider execution failed (${failure})`);
  }
}
