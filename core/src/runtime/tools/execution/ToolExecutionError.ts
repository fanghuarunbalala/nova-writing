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
    validateOptions(options);
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

function validateOptions(options: ToolErrorOptions): void {
  if (
    !options ||
    typeof options !== "object" ||
    typeof options.code !== "string" ||
    !/^[A-Z][A-Z0-9_]{0,127}$/.test(options.code) ||
    ![
      "validation", "permission", "approval_rejected", "sandbox",
      "timeout", "cancelled", "execution", "internal",
    ].includes(options.category) ||
    (options.retryable !== undefined && typeof options.retryable !== "boolean") ||
    (options.sideEffectStatus !== undefined && ![
      "none", "possible", "partial", "completed_unknown",
    ].includes(options.sideEffectStatus))
  ) {
    throw new TypeError("Tool error options are invalid");
  }
  for (const identity of [
    options.conversationId,
    options.runId,
    options.toolCallId,
    options.toolName,
    options.toolVersion,
  ]) {
    if (
      identity !== undefined &&
      (typeof identity !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(identity))
    ) {
      throw new TypeError("Tool error options are invalid");
    }
  }
}
