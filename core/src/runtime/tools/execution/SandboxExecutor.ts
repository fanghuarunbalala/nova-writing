/** Execution Port separating Tool handlers from future process-isolated sandboxes. */
import type { Static, TSchema } from "typebox";
import type { JsonValue } from "../../../event/protocol/index.js";
import type { RegisteredTool } from "../../../tooling/protocol/RegisteredTool.js";
import type { ToolExecutionContext } from "../../../tooling/protocol/ToolExecutionContext.js";
import type { ToolProgressSink } from "../../../tooling/protocol/ToolProgress.js";
import type { ToolResult } from "../../../tooling/protocol/ToolResult.js";
import type { ToolExecutionPolicy } from "./ToolExecutionContracts.js";

export type SandboxIsolationCapability = "none" | "os_process";

export interface SandboxExecutorCapabilities {
  readonly executorId: string;
  readonly isolation: SandboxIsolationCapability;
}

export interface SandboxExecutionRequest<
  TParameters extends TSchema = TSchema,
  TDetails extends JsonValue = JsonValue,
> {
  readonly tool: RegisteredTool<TParameters, TDetails>;
  readonly context: ToolExecutionContext;
  readonly arguments: Static<TParameters>;
  readonly progress: ToolProgressSink;
  readonly policy: ToolExecutionPolicy;
}

export interface SandboxExecutor {
  readonly capabilities: SandboxExecutorCapabilities;

  execute(request: SandboxExecutionRequest): Promise<ToolResult>;
}

export class TrustedProcessSandboxExecutor implements SandboxExecutor {
  readonly capabilities: SandboxExecutorCapabilities = Object.freeze({
    executorId: "trusted_process",
    isolation: "none",
  });

  async execute(request: SandboxExecutionRequest): Promise<ToolResult> {
    if (request.policy.isolation !== "trusted_process") {
      throw new TypeError("Trusted-process executor cannot provide OS isolation");
    }
    return request.tool.handler.execute(
      request.context,
      request.arguments,
      request.progress,
    );
  }
}
