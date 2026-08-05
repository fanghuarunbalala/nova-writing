/**
 * Appends one JSONL record per provider request to a configured debug file.
 * The recorder never throws and never logs the configured path.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type {
  ProviderRequestDebugRecorder,
  ProviderRequestDebugSnapshot,
} from "../../../runtime/agent/pi/index.js";

export interface NodeProviderRequestDebugRecorderOptions {
  readonly path: string;
  readonly logger?: Logger;
}

export function createNodeProviderRequestDebugRecorder(
  options: NodeProviderRequestDebugRecorderOptions,
): ProviderRequestDebugRecorder {
  const logger = (options.logger ?? noopLogger).child({
    component: "node_provider_request_debug_recorder",
  });
  let directoryPrepared = false;
  return Object.freeze({
    async record(snapshot: ProviderRequestDebugSnapshot): Promise<void> {
      try {
        if (!directoryPrepared) {
          await mkdir(dirname(options.path), { recursive: true });
          directoryPrepared = true;
        }
        await appendFile(
          options.path,
          `${JSON.stringify(snapshot)}\n`,
          "utf8",
        );
      } catch {
        logger.debug("node_provider_request_debug.append_failed");
      }
    },
  });
}
