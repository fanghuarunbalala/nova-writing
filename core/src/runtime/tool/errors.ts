/**
 * 工具层统一错误模型：注册 / 策略校验 / 参数解析 / 分发执行失败全部归一为 ToolError，
 * 业务（loop 回填、dispatcher 归一）只按 code 分支。风格对齐 rpc/RPCError。
 */

/** 工具错误码 */
export type ToolErrorCode =
  | "TOOL_NOT_AVAILABLE" // 未知工具（注册表无此 name）
  | "TOOL_DUPLICATE" // 重复注册（注册表已有同 name 工具）
  | "TOOL_POLICY_INVALID" // 工具策略名单含未注册工具（allow/deny 校验失败）
  | "TOOL_ARGUMENTS_INVALID" // 工具参数 JSON 非法
  | "TOOL_HANDLER_FAILED"; // handler 抛错归一（dispatcher 包装非 ToolError 异常）

/** ToolError 构造选项 */
export interface ToolErrorOptions {
  /** 错误码 */
  code: ToolErrorCode;
  /** 关联工具名（诊断 + 策略校验用） */
  toolName?: string;
  /** 关联工具调用 id（诊断用） */
  toolCallId?: string;
  /** 原始错误（override Error.cause） */
  cause?: unknown;
}

/** 工具层统一错误 */
export class ToolError extends Error {
  /** 错误码 */
  readonly code: ToolErrorCode;
  /** 关联工具名 */
  readonly toolName?: string;
  /** 关联工具调用 id */
  readonly toolCallId?: string;
  /** 原始错误（override Error.cause；loop 回填模型自纠依赖 message，cause 仅诊断） */
  override readonly cause?: unknown;

  /**
   * @param opts 错误选项
   * @param message 错误消息（回填模型的可见文本，应保留可自纠信息）
   */
  constructor(opts: ToolErrorOptions, message?: string) {
    super(message ?? `tool.${opts.code}`);
    this.name = "ToolError";
    this.code = opts.code;
    this.toolName = opts.toolName;
    this.toolCallId = opts.toolCallId;
    this.cause = opts.cause;
  }
}
