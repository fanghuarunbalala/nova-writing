/**
 * MCP 工具包装：tools/list 条目 → ToolDef（provider 中立）。
 * 命名 mcp__<server>__<tool>（对齐 docs/reference/claude-code/tools/MCPTool.md）；
 * 非 trusted 服务器的工具默认 requireApproval（外部副作用不可知，PRD mcp-skills F4）。
 * content blocks 序列化：text 拼接、非文本块 JSON 化；isError 归一 ToolError 保留原文。
 */
import type { ToolDef } from "../tool/ToolDef.js";
import type { ToolCall } from "../provider/types.js";
import { ToolError } from "../tool/errors.js";

/** MCP 客户端最小调用面（解耦 SDK 泛型；SDK Client 满足） */
export interface McpToolCaller {
  callTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<{ content?: unknown[]; isError?: boolean }>;
}

/** 工具名总长上限（OpenAI function calling 约束） */
export const MCP_TOOL_NAME_MAX_LENGTH = 64;

/** 工具 description 截断上限 */
export const MCP_TOOL_DESCRIPTION_MAX_LENGTH = 1024;

/** FNV-1a 32bit hash（hex 6 位，截断后缀用） */
function fnv1aHex(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").slice(0, 6);
}

/** 段清洗：小写 + 非 [a-z0-9-] 折叠为单个连字符（空回退 fallback） */
export function sanitizeSegment(segment: string, fallback: string): string {
  const sanitized = segment
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitized.length > 0 ? sanitized : fallback;
}

/** 组装工具全名：超长截断 + hash 后缀（保唯一） */
export function buildMcpToolName(serverName: string, toolName: string): string {
  const full = `mcp__${sanitizeSegment(serverName, "server")}__${sanitizeSegment(toolName, "tool")}`;
  if (full.length <= MCP_TOOL_NAME_MAX_LENGTH) return full;
  const suffix = `_${fnv1aHex(full)}`;
  return full.slice(0, MCP_TOOL_NAME_MAX_LENGTH - suffix.length) + suffix;
}

/** content block 序列化：text 拼接、非文本块 JSON 化；空回退占位文本 */
export function serializeMcpContent(blocks: readonly unknown[] | undefined): string {
  if (blocks === undefined || blocks.length === 0) return "（MCP 工具未返回内容）";
  const parts: string[] = [];
  for (const block of blocks) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      parts.push((block as { text: string }).text);
    } else {
      parts.push(JSON.stringify(block));
    }
  }
  return parts.join("\n");
}

/** tools/list 条目（SDK Tool 子集） */
export interface McpToolDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
}

/**
 * 包装单个 MCP 工具为 ToolDef。
 * @param options 服务器标识 + 信任位 + 客户端（调用面）
 * @param tool tools/list 条目
 * @returns 工具定义
 */
export function wrapMcpTool(
  options: { serverName: string; trusted: boolean; caller: McpToolCaller },
  tool: McpToolDescriptor,
): ToolDef {
  const description = `[MCP:${options.serverName}] ${tool.description ?? tool.name}`;
  return {
    name: buildMcpToolName(options.serverName, tool.name),
    version: "1.0.0",
    description:
      description.length > MCP_TOOL_DESCRIPTION_MAX_LENGTH
        ? description.slice(0, MCP_TOOL_DESCRIPTION_MAX_LENGTH)
        : description,
    parameters:
      tool.inputSchema !== undefined &&
      typeof tool.inputSchema === "object" &&
      (tool.inputSchema as { type?: unknown }).type === "object"
        ? tool.inputSchema
        : { type: "object", properties: {} },
    // 外部副作用不可知：非 trusted 默认全量过审（gateBatch 按轮批量）
    ...(options.trusted ? {} : { requireApproval: true }),
    handler: {
      execute: async (call: ToolCall) => {
        let args: Record<string, unknown>;
        try {
          args = call.args.trim() === "" ? {} : (JSON.parse(call.args) as Record<string, unknown>);
        } catch {
          throw new ToolError(
            { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
            `无效的 MCP 工具参数: ${call.args}`,
          );
        }
        let result: { content?: unknown[]; isError?: boolean };
        try {
          result = await options.caller.callTool({ name: tool.name, arguments: args });
        } catch (err) {
          throw new ToolError(
            { code: "TOOL_HANDLER_FAILED", toolName: call.name, cause: err },
            `MCP 调用失败（${tool.name}）: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        const text = serializeMcpContent(result.content);
        if (result.isError === true) {
          throw new ToolError({ code: "TOOL_HANDLER_FAILED", toolName: call.name }, text);
        }
        return text;
      },
    },
  };
}
