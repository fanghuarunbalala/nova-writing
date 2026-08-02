/** Stable Tool failure model that never retains arguments or underlying errors. */
import type {
  ToolErrorCategory,
  ToolSideEffectStatus,
} from "./ToolExecutionContracts.js";

export interface ToolErrorIdentity {
  readonly conversationId?: string;
  readonly runId?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly toolVersion?: string;
}

export interface ToolErrorOptions extends ToolErrorIdentity {
  readonly code: string;
  readonly category: ToolErrorCategory;
  readonly retryable?: boolean;
  readonly sideEffectStatus?: ToolSideEffectStatus;
}

export class ToolError extends Error {
  override readonly name = "ToolError";
  readonly code: string;
  readonly category: ToolErrorCategory;
  readonly retryable: boolean;
  readonly sideEffectStatus: ToolSideEffectStatus;
  readonly conversationId?: string;
  readonly runId?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly toolVersion?: string;

  constructor(options: ToolErrorOptions) {
    super(`Tool execution failed (${options.category})`);
    this.code = options.code;
    this.category = options.category;
    this.retryable = options.retryable ?? false;
    this.sideEffectStatus = options.sideEffectStatus ?? "completed_unknown";
    this.conversationId = options.conversationId;
    this.runId = options.runId;
    this.toolCallId = options.toolCallId;
    this.toolName = options.toolName;
    this.toolVersion = options.toolVersion;
    Object.freeze(this);
  }
}
