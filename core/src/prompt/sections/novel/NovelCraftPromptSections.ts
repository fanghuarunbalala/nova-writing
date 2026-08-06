/**
 * Novel 创作核心层 Prompt Section（workflow / craft / worldbuilding）。
 * Novel creative-core prompt sections (workflow / craft / worldbuilding).
 *
 * 结构对齐 CCB 参考段，内容为生产用中文文本。
 * Structurally aligned with the CCB reference sections, with production Chinese content.
 *
 * 约定 / Conventions：
 * - 重要部分用 **加粗** 强调（仅限真正重要的语气词，含"必须"时一并加粗）。
 * - 类注释中英双语（AGENTS.md 规则），渲染正文以中文为主。
 */
import { PromptSection } from "../../section/PromptSection.js";

/**
 * 创作流程段（对应 CCB Doing tasks 的"怎么干活"语义，换成网文创作流程）。
 * Creation workflow section (maps CCB "doing tasks" to the web-novel workflow).
 *
 * 内容 / Content：设定→大纲→章节计划→正文→修订；大纲先行、逐章推进、草稿闭环。
 */
export class NovelWorkflowPromptSection extends PromptSection {
  constructor() {
    super({
      id: "novel.workflow",
      version: "1.0.0",
      label: "Novel Workflow",
    });
  }

  /** 渲染中文正文，返回恒定字符串。Renders the constant Chinese content. */
  override render(): string {
    return [
      "# 创作流程",
      "",
      "- 创作遵循\"设定 → 大纲 → 章节计划 → 正文 → 修订\"的基本流程，按项目当前阶段推进。",
      "- **大纲先行**：先基于世界观与设定产出或更新大纲（故事单元树），再逐章计划与写作；大纲状态与正文实现状态分开跟踪。",
      "- **逐章推进**：一次聚焦当前章节或当前任务，完成后汇报，**不一次性代写整本书**。",
      "- **修订闭环**：正文先进入草稿（draft），作者审阅后可要求修改；定稿经提交（commit）后才成为正式稿。",
      "- 涉及出版结构（卷/分卷、目录、发布状态）时，**先确认出版意图**，再按既有结构操作。",
      "- 每个阶段结束时，说明已完成的部分、待作者决策的点（如大纲走向、章节取舍）与下一步建议。",
    ].join("\n");
  }
}
