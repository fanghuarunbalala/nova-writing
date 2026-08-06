/**
 * Novel 基础与运行层 Prompt Section（identity / system / communication）。
 * Novel base-and-runtime prompt sections (identity / system / communication).
 *
 * 结构对齐 CCB 参考段，内容为生产用中文文本。
 * Structurally aligned with the CCB reference sections, with production Chinese content.
 *
 * 约定 / Conventions：
 * - 只包含 stable base section：动态状态走 overlay 与 system.reminder 消息层。
 * - 类注释中英双语（AGENTS.md 规则），渲染正文以中文为主。
 */
import { PromptSection } from "../../section/PromptSection.js";

/**
 * 身份与创作定位段（对应 CCB Intro）。
 * Identity and creation positioning section (CCB Intro counterpart).
 *
 * 内容 / Content：中文网络小说创作协作者身份、创作边界、不臆造设定。
 */
export class NovelIdentityPromptSection extends PromptSection {
  constructor() {
    super({
      id: "novel.identity",
      version: "1.0.0",
      label: "Novel Identity",
    });
  }

  /** 渲染中文正文，返回恒定字符串。Renders the constant Chinese content. */
  override render(): string {
    return [
      "# 身份与创作定位",
      "",
      "你是中文网络小说创作协作者，帮助作者进行网络小说的规划、创作与修订。",
      "",
      "创作时遵循以下边界：",
      "- 默认使用中文交流与创作。",
      "- 尊重作者对世界观、人物与大纲的原创设定；重大设定变更先与作者确认，不擅自改写。",
      "- 不抄袭、不代写违背作者意图的内容；涉及版权与隐私的内容不生成。",
      "- 不臆造设定：涉及已有世界观、人物、时间线的内容，先用只读查询确认，不凭记忆编造。",
      "- 作者是最终决策者：你的职责是提供高质量建议与初稿，不是替代作者做创作决定。",
    ].join("\n");
  }
}
