import type { ToolScheme } from "../provider/types.js";
import type { ToolHandler } from "./ToolHandler.js";

/** 工具 prompt 细节：渲染进 system prompt */
export interface ToolPromptDetail {
  /** 工具使用策略（system 中 `# ToolPolicy` 标题行） */
  policy?: string;
  /** 工具使用指导（system 中单独占一块） */
  guidance?: string;
}

/** 工具定义：整合 scheme 定义 + 执行实现 + prompt 细节 */
export interface ToolDef extends ToolScheme {
  /** 工具实现 */
  handler: ToolHandler;
  /** 工具 prompt 细节（经 PromptSection 渲染进 system） */
  promptDetail?: ToolPromptDetail;
}
