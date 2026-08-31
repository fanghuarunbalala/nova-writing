import type { ToolScheme, ToolCall } from "../provider/types.js";
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
  /**
   * 审批前预检（PRD novel-tools-legacy-对齐 §4-5）：只读校验目标存在性 /
   * baseRevision 乐观锁 / id 占用，失败抛 ToolError——该调用以错误文本收口，
   * 不进审批批、不执行（避免用户批准注定失败的批次）。AgentLoop 在提交审批前调用。
   */
  precheck?: (call: ToolCall) => Promise<void>;
  /** 工具 prompt 细节（经 PromptSection 渲染进 system） */
  promptDetail?: ToolPromptDetail;
  /** 执行前需用户审批（AgentLoop 经 requestApproval 通道征询；未装配通道时按拒绝处理） */
  requireApproval?: boolean;
  /**
   * 按调用判定审批（PRD memory-两层记忆 M1）：requireApproval=false 但本次调用
   * 命中高价值目标（如 Write/Edit 指向 NOVEL.md）时仍强制征询。gateBatch 以
   * requireApproval===true || requiresApprovalFor?.(call)===true 归入审批批。
   * Judge-per-call approval: tools that default to approval-free can still
   * force an approval prompt for specific targets (e.g. Write/Edit touching
   * NOVEL.md). Must be pure/sync (args JSON parse failures fall back to false).
   */
  requiresApprovalFor?: (call: ToolCall) => boolean;
  /**
   * 投影预览定制（tool-recorded 事件的 title/summary 来源）。
   * 只影响投影流、不影响 journal 完整数据与重建；必须纯函数（同输入同输出，
   * replay 确定性前提），未声明走 defaultToolPreview 回退。见 PRD `output-投影层` §4.3。
   */
  preview?: ToolPreviewFn;
}
