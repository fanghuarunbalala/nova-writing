import { describe, it, expect } from "vitest";
import {
  novelStoryAppealSection,
  novelOutlineStandardSection,
  novelProseStandardSection,
} from "../novelStandards.js";
import type { ReadonlyLoopContext } from "../../../loop/LoopContext.js";

const ctx = {} as ReadonlyLoopContext;

describe("novel 质量规范段（规范层，main/compose 共享）", () => {
  it("novel.story_appeal：五正五反 + 硬门槛措辞", () => {
    const text = novelStoryAppealSection.render(ctx);
    expect(text).toContain("# 吸引人的故事");
    expect(text).toContain("至少满足以下其中一项，否则视为不合格");
    expect(text).toContain("极致的情绪钩子");
    expect(text).toContain("精准的市场对标与微创新");
    expect(text).toContain("自嗨型文青病");
    expect(text).toContain("须向作者指出问题并给出重写方向");
  });

  it("novel.outline_standard：场景链定义 + 5 要素 + 串联规则 + 落地映射", () => {
    const text = novelOutlineStandardSection.render(ctx);
    expect(text).toContain("# 大纲规范");
    expect(text).toContain("一条由场景串成的情绪链");
    expect(text).toContain("没有情绪标注的 Scene 视为无效");
    expect(text).toContain("悬念牵引连接");
    expect(text).toContain("事件流水账");
    expect(text).toContain("## 落地到工具");
    expect(text).toContain("readerEmotion 即情绪标注");
    expect(text).toContain("不是大纲的组织单位");
  });

  it("novel.prose_standard：定义 + 好/坏判据（含去 AI 味条目）", () => {
    const text = novelProseStandardSection.render(ctx);
    expect(text).toContain("# 正文规范");
    expect(text).toContain("情绪传递工程");
    expect(text).toContain("每段都有功能");
    expect(text).toContain("视角锁定");
    expect(text).toContain("对话像说明文");
    expect(text).toContain("钩子缺失");
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
