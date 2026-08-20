import { describe, it, expect } from "vitest";
import {
  novelStoryAppealSection,
  novelOutlineStandardSection,
  novelProseStandardSection,
  novelPublicationStandardSection,
} from "../novelStandards.js";
import type { DynamicPromptSectionInput } from "../../PromptSection.js";
import type { GuideCaseEntry } from "../../../agent/composeGuide/types.js";
import type { ReadonlyLoopContext } from "../../../loop/LoopContext.js";

const ctx = {} as ReadonlyLoopContext;

const entries: GuideCaseEntry[] = [
  { file: "世界观设计案例.md", path: ".novel/cases/世界观设计案例.md", taskType: "world-design", summary: "世界观", order: 26 },
  { file: "人物设计案例.md", path: ".novel/cases/人物设计案例.md", taskType: "character-design", summary: "人物", order: 20 },
  { file: "总纲设计案例.md", path: ".novel/cases/总纲设计案例.md", taskType: "outline-overview", summary: "总纲", order: 15 },
  { file: "大纲细化设计案例.md", path: ".novel/cases/大纲细化设计案例.md", taskType: "act-design", summary: "幕设计", order: 10 },
  { file: "大纲-场景设计案例.md", path: ".novel/cases/大纲-场景设计案例.md", taskType: "scene-design", summary: "场景", order: 12 },
  { file: "正文撰写案例.md", path: ".novel/cases/正文撰写案例.md", taskType: "prose-draft", summary: "正文", order: 30 },
  { file: "正文摘录-对话.md", path: ".novel/cases/正文摘录-对话.md", taskType: "prose-excerpt-dialogue", summary: "对话摘录", order: 31 },
];

const withCases: DynamicPromptSectionInput = {
  caseGuide: { entries, casesDir: ".novel/cases" },
};

describe("novel 质量规范段（规范层，main/compose 共享；v2.0 动态段 + 参考案例小节）", () => {
  it("novel.story_appeal：五正五反 + 硬门槛措辞", () => {
    const text = novelStoryAppealSection.renderDynamic(withCases, ctx);
    expect(text).toContain("# 吸引人的故事");
    expect(text).toContain("至少满足以下其中一项，否则视为不合格");
    expect(text).toContain("极致的情绪钩子");
    expect(text).toContain("精准的市场对标与微创新");
    expect(text).toContain("自嗨型文青病");
    expect(text).toContain("须向作者指出问题并给出重写方向");
  });

  it("novel.outline_standard：场景链定义 + 5 要素 + 串联规则 + 落地映射", () => {
    const text = novelOutlineStandardSection.renderDynamic(withCases, ctx);
    expect(text).toContain("# 大纲规范");
    expect(text).toContain("一条由场景串成的情绪链");
    expect(text).toContain("没有情绪标注的场景视为无效");
    expect(text).toContain("悬念牵引连接");
    expect(text).toContain("事件流水账");
    expect(text).toContain("## 落地到工具");
    expect(text).toContain("readerEmotion 即情绪标注");
    expect(text).toContain("不是大纲的组织单位");
    // 概念边界（序号体系口径）：对外不用 saga/arc/sequence/scene 内部词
    expect(text).toContain("一律用「全书 / 一、 / 1.1 / 1.1.1」编号＋标题指代单元");
    expect(text).toContain("不自评质量");
    expect(text).toContain("层级最多 4 层");
  });

  it("novel.prose_standard：定义 + 排版范式 + 好/坏判据（含去 AI 味条目）", () => {
    const text = novelProseStandardSection.renderDynamic(withCases, ctx);
    expect(text).toContain("# 正文规范");
    expect(text).toContain("情绪传递工程");
    expect(text).toContain("每句都有功能");
    expect(text).toContain("视角锁定");
    expect(text).toContain("对话像说明文");
    expect(text).toContain("钩子缺失");
    // 排版范式（v1.2.0 新增：网文范式硬规则）
    expect(text).toContain("## 排版范式（硬规则）");
    expect(text).toContain("对话用中文双引号");
    expect(text).toContain("每句一段");
    expect(text).toContain("必要才断句");
    expect(text).toContain("一句多段");
    expect(text).toContain("对话引号不规范");
    // 去 AI 味判据（v1.1.0 新增）
    expect(text).toContain("先呈现后解释");
    expect(text).toContain("节奏有呼吸");
    expect(text).toContain("心理真实");
    expect(text).toContain("物象具体");
    expect(text).toContain("AI 套话");
    expect(text).toContain("情绪先行标注");
    expect(text).toContain("书面化内心活动");
    expect(text).toContain("段落均质");
  });
});

describe("规范段尾「参考案例」小节（按 task_type 前缀过滤；v2.0）", () => {
  it("story_appeal ← world-/character-：设计类两案，不含大纲/正文系", () => {
    const text = novelStoryAppealSection.renderDynamic(withCases, ctx);
    expect(text).toContain("## 参考案例");
    expect(text).toContain(".novel/cases/世界观设计案例.md");
    expect(text).toContain(".novel/cases/人物设计案例.md");
    expect(text).toContain("不抄袭、不照搬原文");
    expect(text).not.toContain("总纲设计案例");
    expect(text).not.toContain("prose-draft");
  });

  it("outline_standard ← outline-/act-/scene-；prose_standard ← prose-（含摘录系）", () => {
    const outline = novelOutlineStandardSection.renderDynamic(withCases, ctx);
    expect(outline).toContain("task=outline-overview");
    expect(outline).toContain("task=act-design");
    expect(outline).toContain("task=scene-design");
    expect(outline).not.toContain("world-design");
    expect(outline).not.toContain("prose-");
    const prose = novelProseStandardSection.renderDynamic(withCases, ctx);
    expect(prose).toContain("task=prose-draft");
    expect(prose).toContain("task=prose-excerpt-dialogue");
    expect(prose).not.toContain("act-design");
  });

  it("publication_standard：暂无对应案例 → 无小节；正文恒渲染", () => {
    const text = novelPublicationStandardSection.renderDynamic(withCases, ctx);
    expect(text).toContain("# 章卷发布结构规范");
    expect(text).not.toContain("## 参考案例");
  });

  it("快照缺失 / 空库 → 仅省略小节，规范正文恒渲染（非整段占位）", () => {
    for (const section of [
      novelStoryAppealSection,
      novelOutlineStandardSection,
      novelProseStandardSection,
      novelPublicationStandardSection,
    ]) {
      const absent = section.renderDynamic({}, ctx);
      expect(absent.length).toBeGreaterThan(0);
      expect(absent).not.toContain("## 参考案例");
      const empty = section.renderDynamic(
        { caseGuide: { entries: [], casesDir: ".novel/cases" } },
        ctx,
      );
      expect(empty).not.toContain("## 参考案例");
    }
    expect(novelStoryAppealSection.renderDynamic({}, ctx)).toContain("# 吸引人的故事");
    expect(novelProseStandardSection.renderDynamic({}, ctx)).toContain("# 正文规范");
  });
});
