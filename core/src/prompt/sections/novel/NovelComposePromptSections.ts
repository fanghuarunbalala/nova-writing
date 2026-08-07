/**
 * 设计模式（Compose Mode）动态提示段：compose 激活时渲染约束，其余状态返回空串。
 * Compose mode dynamic prompt section: renders constraints while compose is
 * active and returns an empty string otherwise.
 *
 * 对齐 core.environment：动态段编译期不产生内容，运行时按输入渲染；空串由
 * RuntimeSystemPromptBuilder 自动跳过。
 */
import {
  DynamicPromptSection,
  type DynamicPromptSectionInput,
} from "../../section/DynamicPromptSection.js";

/** 设计模式约束段（对应 CCB plan 模式提示）。Compose-mode constraints (CCB plan-mode counterpart). */
export class NovelComposeModePromptSection extends DynamicPromptSection {
  constructor() {
    super({
      id: "novel.compose",
      version: "1.0.0",
      label: "Novel Compose Mode",
    });
  }

  /** 编译期不产生内容（动态段不进 base）。No content at compile time. */
  override render(): string {
    return "";
  }

  /** 每调用按 compose 状态渲染；非活动/已结束返回空串。 */
  /** Renders per call by compose state; empty when inactive or settled. */
  override renderDynamic(input: DynamicPromptSectionInput): string {
    const compose = input.compose;
    if (compose === undefined || !compose.active) return "";
    if (compose.phase === "designing") {
      return [
        "# 设计模式（Compose Mode）",
        "当前处于**设计模式**：",
        "- 正式稿只读：canonical 写入工具会被拒绝，**唯一可写的是当前会话的设计草稿文件**（Read/Glob 可在草稿目录内调研，Write/Edit 仅限设计文件）。",
        "- 逐步写出你要创作的内容（大纲或正文），用 Write/Edit 增量完善草稿。",
        "- 草稿完成后调用 **ExitComposeMode** 提交审批；**不要用文本询问审批**。",
        "- 如果作者拒绝了草稿：按反馈修订草稿文件后重新提交，**不要原样重试**。",
      ].join("\n");
    }
    if (compose.phase === "pending") {
      return "设计草稿已提交，等待作者审批。";
    }
    return "";
  }
}
