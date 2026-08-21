/**
 * 外部工具两步模式（docs/PRD/external-tools-接入.md）：
 * SearchExtraTools（发现：select:/discover:/关键词，只读免审）→
 * ExecuteExtraTool（执行：tool_name + params；受信目标免审直执行，
 * 非受信目标 handler 内嵌审批——审批框显示真实工具名与参数）。
 * createDeferredRejectionStub：直接调用延迟工具的拦截 stub
 * （注册进 dispatcher 但不进 toolSchemes，抛错引导两步流程）。
 */
import type { ToolDef } from "../ToolDef.js";
import type { ToolCall } from "../../provider/types.js";
import type { DeferredToolRegistry } from "../deferred/DeferredToolRegistry.js";
import { ToolError } from "../errors.js";
import type {
  ConversationApprovalDecision,
  ConversationApprovalRequest,
} from "../../../conversation/contract/types/index.js";

/** 审批征询通道（与 AgentLoop.gateBatch 同一闭包：bypass 短路/超时/决议包装复用） */
export type ExecuteExtraToolApprovalChannel = (
  req: ConversationApprovalRequest,
) => Promise<ConversationApprovalDecision>;

/** createExecuteExtraTool 构造选项 */
export interface ExecuteExtraToolOptions {
  /** 会话 id（内嵌审批 requestId 归组用；缺省 "conv"） */
  readonly conversationId?: string;
  /** 审批征询通道（缺省 = 非受信目标一律「审批通道未装配」拒绝） */
  readonly requestApproval?: ExecuteExtraToolApprovalChannel;
}

const SEARCH_DESCRIPTION =
  "按名称或关键词搜索延迟工具（当前为 MCP 服务器工具）。低优先级——仅当核心工具无法完成任务时使用；核心工具（Read/Write/Edit/Glob/skill 等）始终可用，应直接调用。延迟工具不能直接调用，必须先经本工具发现、再经 ExecuteExtraTool 执行（两步流程）。";

const EXECUTE_DESCRIPTION =
  "按名称与参数执行延迟工具（当前为 MCP 服务器工具）。须先用 SearchExtraTools 发现目标工具后再调用（可用 discover: 查询获取其参数 schema）。受信服务器工具直接执行；非受信服务器工具执行前会征询用户审批（审批框显示真实工具名与参数）。";

/** 两步流程指导（两工具 guidance 共用，随各自工具面输出） */
const TWO_STEP_GUIDANCE = [
  "## 延迟工具两步流程（SearchExtraTools → ExecuteExtraTool）",
  "延迟工具（如 MCP 工具）不在工具列表中，不能直接调用。必须：",
  "1. SearchExtraTools 发现：{\"query\": \"select:工具名\"}（按名，最快）；不确定名称用关键词搜索，或 \"discover:关键词\" 查看完整描述与参数 schema；",
  "2. ExecuteExtraTool 执行：{\"tool_name\": \"工具名\", \"params\": {...}}（参数按其 schema）。",
  "若 ExecuteExtraTool 执行失败，不要反复搜索重试——停下并告诉用户失败原因。",
].join("\n");

/** 解析 SearchExtraTools 参数（query 必填 string；max_results 可选 number 默认 5） */
function parseSearchArgs(call: ToolCall): { query: string; max_results: number } {
  let args: unknown;
  try {
    args = JSON.parse(call.args);
  } catch {
    throw new ToolError(
      { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
      `无效的 JSON 参数: ${call.args}`,
    );
  }
  const obj = args as { query?: unknown; max_results?: unknown };
  if (typeof obj.query !== "string" || obj.query.trim().length === 0) {
    throw new ToolError(
      { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
      "缺少必填参数 query（搜索查询）。",
    );
  }
  if (obj.max_results !== undefined && (typeof obj.max_results !== "number" || !Number.isFinite(obj.max_results))) {
    throw new ToolError(
      { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
      "max_results 必须是数字。",
    );
  }
  return { query: obj.query, max_results: obj.max_results === undefined ? 5 : obj.max_results };
}

/** 解析 ExecuteExtraTool 参数（tool_name 必填 string；params 必填 object） */
function parseExecuteArgs(call: ToolCall): { tool_name: string; params: Record<string, unknown> } {
  let args: unknown;
  try {
    args = JSON.parse(call.args);
  } catch {
    throw new ToolError(
      { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
      `无效的 JSON 参数: ${call.args}`,
    );
  }
  const obj = args as { tool_name?: unknown; params?: unknown };
  if (typeof obj.tool_name !== "string" || obj.tool_name.trim().length === 0) {
    throw new ToolError(
      { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
      "缺少必填参数 tool_name（目标延迟工具名）。",
    );
  }
  if (typeof obj.params !== "object" || obj.params === null || Array.isArray(obj.params)) {
    throw new ToolError(
      { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
      "params 必须是对象（目标工具参数）。",
    );
  }
  return { tool_name: obj.tool_name.trim(), params: obj.params as Record<string, unknown> };
}

/**
 * 创建 SearchExtraTools 工具（发现延迟工具；只读、免审批、并发安全）
 * @param registry 延迟工具注册表
 * @returns 工具定义
 */
export function createSearchExtraToolsTool(registry: DeferredToolRegistry): ToolDef {
  return {
    name: "SearchExtraTools",
    version: "1.0.0",
    description: SEARCH_DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "搜索查询。select:工具名 —— 按名精确选择（逗号分隔多选，最快）；discover:关键词 —— 返回工具名+描述+参数 schema（仅查看不执行）；其余为关键词搜索（最多 max_results 条）。",
        },
        max_results: { type: "number", description: "最大返回条数（默认 5）。" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "SearchExtraTools 低优先级：核心工具能完成的任务直接做，不要搜索；只有核心工具无法完成（如 MCP 能力）时才使用。",
      guidance: TWO_STEP_GUIDANCE,
    },
    handler: {
      execute: async (call) => {
        const { query, max_results } = parseSearchArgs(call);
        return registry.search(query, max_results).text;
      },
    },
  };
}

/**
 * 创建 ExecuteExtraTool 工具（执行延迟工具；受信免审直执行，非受信内嵌审批）
 * @param registry 延迟工具注册表
 * @param options 会话 id + 审批征询通道（缺省：非受信目标按「通道未装配」拒绝）
 * @returns 工具定义
 */
export function createExecuteExtraTool(
  registry: DeferredToolRegistry,
  options: ExecuteExtraToolOptions = {},
): ToolDef {
  return {
    name: "ExecuteExtraTool",
    version: "1.0.0",
    // 审批内嵌（非受信目标走 requestApproval 通道），避免 gateBatch 二次弹窗
    requireApproval: false,
    description: EXECUTE_DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        tool_name: {
          type: "string",
          description: "目标工具完整名称（如 mcp__server__tool）。",
        },
        params: { type: "object", description: "传给目标工具的参数对象（按其 schema）。" },
      },
      required: ["tool_name", "params"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "ExecuteExtraTool 只执行 SearchExtraTools 发现的延迟工具；核心工具永远直接调用，不要包一层 ExecuteExtraTool。",
      guidance: TWO_STEP_GUIDANCE,
    },
    handler: {
      execute: async (call) => {
        const { tool_name, params } = parseExecuteArgs(call);
        const target = registry.get(tool_name);
        if (target === undefined) {
          throw new ToolError(
            { code: "TOOL_NOT_AVAILABLE", toolName: tool_name },
            `未找到延迟工具: ${tool_name}。请先用 SearchExtraTools 搜索确认名称（select:${tool_name} 或关键词）。`,
          );
        }
        // 以真实工具名为 name 构造调用（错误归一/journal 归属真实工具）；
        // id 沿用 ExecuteExtraTool 调用 id（tool 结果回填配对不变）
        const innerCall: ToolCall = {
          id: call.id,
          name: target.name,
          args: JSON.stringify(params),
        };
        if (target.requireApproval === true) {
          const decision = await requestApprovalForTarget(innerCall, options);
          if (decision === undefined) {
            return "已拒绝（审批通道未装配）";
          }
          if (decision.kind !== "approve") {
            return decision.kind === "reject" ? "已拒绝" : `已拒绝（用户意见：${decision.text}）`;
          }
        }
        return await target.handler.execute(innerCall);
      },
    },
  };
}

/**
 * 创建延迟工具直接调用拦截 stub（注册进 dispatcher 但不进 toolSchemes）：
 * 模型未经 SearchExtraTools 直接调用延迟工具时抛错引导两步流程。
 * 无 requireApproval（不触发审批弹窗，对齐 cc 客户端拒绝行为）。
 * @param def 目标延迟工具定义（stub 只取 name）
 * @returns 拦截 stub 定义
 */
export function createDeferredRejectionStub(def: ToolDef): ToolDef {
  return {
    name: def.name,
    version: "1.0.0",
    handler: {
      execute: async (call) => {
        throw new ToolError(
          { code: "TOOL_NOT_AVAILABLE", toolName: call.name, toolCallId: call.id },
          `该工具（${call.name}）为延迟工具，未向模型暴露参数 schema。请先调用 SearchExtraTools 发现（select:${call.name} 或 discover:${call.name} 查看 schema），再经 ExecuteExtraTool 执行。不要直接调用。`,
        );
      },
    },
  };
}

/**
 * 非受信目标的审批征询：走与 gateBatch 同一 requestApproval 通道
 * （bypass 短路/超时/决议包装由 Conversation.sendApprovalRequest 复用）。
 * requestId 以 toolCallId 归组，不与 gateBatch 的 b{n} 序列撞车。
 * 通道未装配返回 undefined（调用方以「已拒绝（审批通道未装配）」文本收口，
 * 对齐 gateBatch 未装配行为，不抛错）。
 */
async function requestApprovalForTarget(
  call: ToolCall,
  options: ExecuteExtraToolOptions,
): Promise<ConversationApprovalDecision | undefined> {
  if (options.requestApproval === undefined) {
    return undefined;
  }
  return options.requestApproval({
    requestId: `approval:${options.conversationId ?? "conv"}:deferred:${call.id}`,
    toolCalls: [{ toolCallId: call.id, toolName: call.name, args: call.args }],
  });
}
