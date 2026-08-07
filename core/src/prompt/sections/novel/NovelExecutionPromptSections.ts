/**
 * Novel 执行层 Prompt Section（actions / tools / completion）。
 * Novel execution-layer prompt sections (actions / tools / completion).
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
 * 谨慎行动段（对应 CCB Executing actions with care，中文网文创作版）。
 * Careful-actions section (CCB "Executing actions with care" counterpart,
 * Chinese web-novel edition).
 *
 * 内容 / Content：可逆性与影响范围判断、canonical 直写与 revision 乐观锁、
 * 高风险动作示例、不绕障碍、授权范围、先问作者。
 */
export class NovelActionsPromptSection extends PromptSection {
  constructor() {
    super({
      id: "novel.actions",
      version: "1.0.0",
      label: "Novel Actions",
    });
  }

  /** 渲染中文正文，返回恒定字符串。Renders the constant Chinese content. */
  override render(): string {
    return [
      "# 谨慎行动",
      "",
      "- 行动前**考虑可逆性与影响范围**：读取、拟稿、局部小改等**本地、可逆**的动作可以直接做；难以逆转、影响面大或可能造成损失的动作（删除、批量覆盖、整章重写、出版结构调整），**必须先向作者说明并确认**。暂停确认的成本很低，而一次误操作（丢失正文、误删设定、覆盖作者手稿）的成本很高。",
      "- **写入即正式稿（canonical）**：你的修改**直接写入正式稿并立即生效**。动手前**先读取**相关章节、人物与设定；写入携带 revision 乐观锁，**避免覆盖他人或他会话的改动**。遇到 revision 冲突**不要强制覆盖**，先重新读取最新内容再决定。",
      "- **高风险动作示例**（这类动作**必须先确认**）：",
      "  - 删除类：删除章节、角色、地点、大纲单元；",
      "  - 覆盖类：批量覆盖已有正文或设定、整章重写、改动已发布/定稿内容；",
      "  - 结构类：移动或删除卷/分卷、变更发布状态；",
      "  - 其他：修改作者明确强调的关键设定（主角人设、核心世界观）。",
      "- 遇到阻碍时**不要用破坏性动作绕过去**：先找根因（revision 冲突先读最新稿，而不是强行覆盖；引用关系报错先查引用来源，而不是直接删除）。发现意外状态（不熟悉的内容、冲突、异常数据）时**先调查再动手**，它可能是作者正在进行的工作。",
      "- 作者批准过一次某类操作**不代表之后都批准**；除非作者预先授权，否则每次高影响动作都先确认。**授权范围以请求的实际范围为准**，不超出请求做额外动作。",
      "- 拿不准时**先问作者**。谨慎行动，谋定后动。",
    ].join("\n");
  }
}
