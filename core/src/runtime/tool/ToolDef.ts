import type { ToolScheme } from "../provider/types.js";
import type { ToolHandler } from "./ToolHandler.js";
import type { ToolPreviewFn } from "./previews.js";

/** 工具 prompt 细节：渲染进 system prompt */
export interface ToolPromptDetail {
  /** 工具使用策略（system 中 `# ToolPolicy` 标题行） */
  policy?: string;
  /** 工具使用指导（system 中单独占一块） */
  guidance?: string;
}

/** 工具定义：整合 scheme 定义 + 版本 + 执行实现 + prompt 细节 */
export interface ToolDef extends ToolScheme {
  /** 工具版本（def 指定，注册/获取 key 的一部分） */
  version: string;
  /** 工具实现 */
  handler: ToolHandler;
  /** 工具 prompt 细节（经 PromptSection 渲染进 system） */
  promptDetail?: ToolPromptDetail;
  /** 执行前需用户审批（AgentLoop 经 requestApproval 通道征询；未装配通道时按拒绝处理） */
  requireApproval?: boolean;
  /**
   * 投影预览定制（tool-recorded 事件的 title/summary 来源）。
   * 只影响投影流、不影响 journal 完整数据与重建；必须纯函数（同输入同输出，
   * replay 确定性前提），未声明走 defaultToolPreview 回退。见 PRD `output-投影层` §4.3。
   */
  preview?: ToolPreviewFn;
}
