/** Safe result contract for real Model Connection probes. */
import {
  EFFECTIVE_MODEL_EXECUTION_FAILURE,
  type EffectiveModelExecutionFailure,
} from "./EffectiveModelExecutionResolver.js";

export const MODEL_CONNECTION_PROBE_SCHEMA_VERSION = 1 as const;

export const MODEL_CONNECTION_PROVIDER_FAILURES = Object.freeze([
  "auth",
  "rate_limit",
  "timeout",
  "network",
  "response",
  "cancellation",
  "unsupported_api",
] as const);

export type ModelConnectionProviderFailure =
  (typeof MODEL_CONNECTION_PROVIDER_FAILURES)[number];

export type ModelConnectionProbeFailure =
  | EffectiveModelExecutionFailure
  | ModelConnectionProviderFailure;

export type ModelConnectionProbeResult =
  | { readonly ok: true; readonly latencyMs: number }
  | { readonly ok: false; readonly failure: ModelConnectionProbeFailure };

export function isModelConnectionProbeFailure(
  value: unknown,
): value is ModelConnectionProbeFailure {
  if (typeof value !== "string") return false;
  const resolutionFailures = Object.values(
    EFFECTIVE_MODEL_EXECUTION_FAILURE,
  ) as readonly string[];
  return (
    resolutionFailures.includes(value) ||
    (MODEL_CONNECTION_PROVIDER_FAILURES as readonly string[]).includes(value)
  );
}
