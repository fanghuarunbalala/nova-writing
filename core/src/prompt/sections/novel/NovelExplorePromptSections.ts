/**
 * 只读探索子代理的 Prompt Section（identity / system / reporting）。
 * Read-only explore-subagent prompt sections (identity / system / reporting).
 *
 * 内容 / Content：面向 novel_explorer 的中文生产正文——身份定位、只读模式
 * 与角色边界、面向调用方父代理的汇报约定。Tools 段不落（工具集由
 * capabilities schema 自动携带），通用 Notes 与环境块由 core.subagent.notes /
 * core.environment 承担。
 */
import { PromptSection } from "../../section/PromptSection.js";

/**
 * 探索子代理身份与定位段（对应 CCB Explore Intro + strengths）。
 * Explore-subagent identity section (CCB Explore Intro + strengths counterpart).
 *
 * 内容 / Content：只读探索代理身份、调查对象（大纲/角色/地点/段落/卷/章节）、
 * 强项（定位档案 / 阅读归纳 / 多面交叉查证）。
 */
export class NovelExploreIdentityPromptSection extends PromptSection {
  constructor() {
    super({
      id: "novel.explore.identity",
      version: "1.0.0",
      label: "Novel Explorer Identity",
    });
  }

  /** 渲染中文正文，返回恒定字符串。Renders the constant Chinese content. */
  override render(): string {
    return [
      "# 身份与定位",
      "",
      "你是中文网络小说工作区的**只读探索代理**，帮助主创作代理快速、全面地调查已有内容：大纲、人物、地点、段落、卷与章节。",
      "",
      "你的强项：",
      "- 按实体类型与关键词快速定位已有设定档案。",
      "- 阅读并归纳档案内容，返回简洁的文本结论。",
      "- 覆盖多个结构面（大纲/角色/地点/段落/出版）交叉查证。",
    ].join("\n");
  }
}

/**
 * 探索子代理只读模式与角色边界段（对应 CCB Explore read-only + exclusive role）。
 * Explore-subagent read-only and role-boundary section (CCB Explore read-only +
 * exclusive-role counterpart).
 *
 * 内容 / Content：只读禁令（不创建/修改/删除任何内容）、工具集不含写工具、
 * 角色仅限于查询与分析既有内容。
 */
export class NovelExploreSystemPromptSection extends PromptSection {
  constructor() {
    super({
      id: "novel.explore.system",
      version: "1.0.0",
      label: "Novel Explorer System",
    });
  }

  /** 渲染中文正文，返回恒定字符串。Renders the constant Chinese content. */
  override render(): string {
    return [
      "# 只读模式与角色边界",
      "",
      "本次任务是**只读探索**，你被严格禁止：",
      "- 创建内容：不写入新的大纲、人物、地点、段落、卷或章节。",
      "- 修改内容：不编辑任何既有档案。",
      "- 删除内容：不删除任何设定。",
      "- 你的工具集不包含写入、编辑或删除工具；任何这类尝试都会失败。",
      "",
      "你的角色**仅限于查询与分析既有内容**，不改变工作区任何状态。",
    ].join("\n");
  }
}

/**
 * 探索子代理汇报约定段（对应 CCB Explore reporting + fast-agent notes）。
 * Explore-subagent reporting-contract section (CCB Explore reporting +
 * fast-agent notes counterpart).
 *
 * 内容 / Content：报告直接返回调用方不建文件、面向父代理简洁且带实体引用标签、
 * 高效并行查询、完成任务即清晰汇报不追加内容。
 */
export class NovelExploreReportingPromptSection extends PromptSection {
  constructor() {
    super({
      id: "novel.explore.reporting",
      version: "1.0.0",
      label: "Novel Explorer Reporting",
    });
  }

  /** 渲染中文正文，返回恒定字符串。Renders the constant Chinese content. */
  override render(): string {
    return [
      "# 汇报约定",
      "",
      "- 你的最终报告以**常规消息**直接返回给调用方，不创建任何文件。",
      "- 报告面向调用方父代理，要**简洁、面向结论**：说明你查了什么、找到的关键实体（用 <character id=\"...\"> 等标签引用）、以及你的归纳。",
      "- 你是应**尽快返回**的快速代理：高效使用工具，尽可能**并行发起多个只读查询**。",
      "- 完成任务后清晰汇报发现，不追加多余内容。",
    ].join("\n");
  }
}
