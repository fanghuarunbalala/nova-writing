/**
 * 统一工具调度实现：registry.require(call.name) → handler.execute(call)。
 * 错误归一：ToolError 原样透传（保留 code），其他异常 wrap 为 TOOL_HANDLER_FAILED
 * （cause 保留、message 含原错误文本，供 loop 回填模型自纠）。
 * 无 TOOL_VERSION_MISMATCH：新线 ToolCall 无 version、模型不传（偏离文档化，见 architecture.md）。
 */
import type { ToolRegistry } from "./ToolRegistry.js";
import type { ToolDispatcher } from "./ToolDispatcher.js";
import { ToolError } from "./errors.js";

/**
 * 创建统一工具调度器（写入 tool name 自动映射到 ToolDef）
 * @param registry 工具注册表（按 name 寻址）
 * @returns ToolDispatcher（require → execute → 错误归一）
 */
export function createToolDispatcher(registry: ToolRegistry): ToolDispatcher {
  return {
    resolve: (name) => registry.get(name),
    dispatch: async (_ctx, call) => {
      const tool = registry.require(call.name);
      try {
        return await tool.handler.execute(call);
      } catch (err) {
        if (err instanceof ToolError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        throw new ToolError(
          { code: "TOOL_HANDLER_FAILED", toolName: call.name, toolCallId: call.id, cause: err },
          `工具执行失败: ${message}`,
        );
      }
    },
  };
}
