/** Host routing result that deliberately does not claim semantic completion. */
import type { JsonObject } from "../../protocol/JsonValue.js";
import { OutputPayload } from "../OutputPayload.js";

export const HOST_INPUT_HANDLER = {
  stop: "stop",
  reloadConfig: "reload_config",
} as const;

export type HostInputHandler =
  (typeof HOST_INPUT_HANDLER)[keyof typeof HOST_INPUT_HANDLER];

export const HOST_INPUT_ROUTING_OUTCOME = {
  runtimeNotified: "runtime_notified",
  noRuntime: "no_runtime",
  deferred: "deferred",
} as const;

export type HostInputRoutingOutcome =
  (typeof HOST_INPUT_ROUTING_OUTCOME)[keyof typeof HOST_INPUT_ROUTING_OUTCOME];

export interface HostInputRoutedPayloadOptions {
  handler: HostInputHandler;
  outcome: HostInputRoutingOutcome;
}

export class HostInputRoutedPayload extends OutputPayload {
  constructor(
    readonly handler: HostInputHandler,
    readonly outcome: HostInputRoutingOutcome,
  ) {
    super();
  }

  toObject(): JsonObject {
    return {
      handler: this.handler,
      outcome: this.outcome,
    };
  }
}
