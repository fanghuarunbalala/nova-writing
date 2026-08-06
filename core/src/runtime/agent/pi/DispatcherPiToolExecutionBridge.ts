/** Package-private Pi Tool bridge that routes every call through Core dispatch. */
import type { ToolDispatcher } from "../../tools/execution/ToolDispatcher.js";
import type {
  PiToolExecutionBridge,
  PiToolExecutionRequest,
} from "./PiToolAdapter.js";

export interface DispatcherPiToolExecutionBridgeOptions {
  readonly dispatcher: ToolDispatcher;
  readonly conversationId: string;
  readonly runId?: string | (() => string | undefined);
  readonly turnId?: string | (() => string | undefined);
}

export class DispatcherPiToolExecutionBridge implements PiToolExecutionBridge {
  readonly #dispatcher: ToolDispatcher;
  readonly #conversationId: string;
  readonly #runId?: string | (() => string | undefined);
  readonly #turnId?: string | (() => string | undefined);

  constructor(options: DispatcherPiToolExecutionBridgeOptions) {
    this.#dispatcher = options.dispatcher;
    this.#conversationId = options.conversationId;
    this.#runId = options.runId;
    this.#turnId = options.turnId;
  }

  execute(request: PiToolExecutionRequest) {
    return this.#dispatcher.execute(
      {
        conversationId: this.#conversationId,
        runId: resolveToolIdentity(this.#runId),
        toolCallId: request.toolCallId,
        ...(this.#turnId === undefined
          ? {}
          : { turnId: resolveToolIdentity(this.#turnId) }),
        toolName: request.tool.descriptor.name,
        toolVersion: request.tool.descriptor.version,
        arguments: request.arguments,
      },
      {
        signal: request.signal,
        progress: request.progress,
      },
    );
  }
}

function resolveToolIdentity(
  value: string | (() => string | undefined) | undefined,
): string {
  const resolved = typeof value === "function" ? value() : value;
  if (resolved === undefined || resolved.length === 0) {
    return "run-unavailable";
  }
  return resolved;
}
