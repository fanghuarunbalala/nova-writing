/**
 * 设计模式（Compose Mode）静态提示段：只读正式稿、只写草稿文件、ExitComposeMode 纪律。
 * Compose mode static prompt section: read-only canon, design-file-only writes, ExitComposeMode discipline.
 *
 * 该段不进 base recipe，由 ComposeAwareRuntimeSystemPromptSource 在 compose 激活时动态附加。
 */
import { PromptSection } from "../../section/PromptSection.js";

/** 设计模式约束段（对应 CCB plan 模式提示）。Compose-mode constraints (CCB plan-mode counterpart). */
export class NovelComposeModePromptSection extends PromptSection {
  constructor() {
    super({
      id: "novel.compose",
      version: "1.0.0",
      label: "Novel Compose Mode",
    });
  }

  /** 渲染中文正文。Renders the constant Chinese content. */
  override render(): string {
    return [
      "# 设计模式（Compose Mode）",
      "当前处于**设计模式**：",
      "- 正式稿只读：canonical 写入工具会被拒绝，**唯一可写的是当前会话的设计草稿文件**（Read/Glob 可在草稿目录内调研，Write/Edit 仅限设计文件）。",
      "- 逐步写出你要创作的内容（大纲或正文），用 Write/Edit 增量完善草稿。",
      "- 草稿完成后调用 **ExitComposeMode** 提交审批；**不要用文本询问审批**。",
      "- 如果作者拒绝了草稿：按反馈修订草稿文件后重新提交，**不要原样重试**。",
    ].join("\n");
  }
}
