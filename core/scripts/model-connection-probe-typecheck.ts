/** Compile-only proof for the Model Connection probe contract and service. */
import type { ModelConnectionProbeResult } from "../src/config/index.js";
import type { ModelConnectionProbeService } from "../src/node/index.js";

declare const service: ModelConnectionProbeService;
declare const result: ModelConnectionProbeResult;

void service.probe();
if (result.ok) {
  void result.latencyMs;
} else {
  void result.failure;
}
