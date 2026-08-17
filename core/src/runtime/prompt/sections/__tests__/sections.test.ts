import { describe, it, expect } from "vitest";
import {
  coreRuntimeProtocolSection,
  completionContractSection,
  contextReliabilitySection,
  conversationBehaviorSection,
  todoGuidanceSection,
} from "../agent.js";
import {
  novelIdentitySection,
  novelSystemSection,
  novelCraftSection,
  novelExecutionSection,
} from "../novel.js";

describe("prompt 分节文案（迁移完整性）", () => {
  it("3 个通用协议段保持清空（render 返回空串，不产出内容）", () => {
    expect(coreRuntimeProtocolSection.render({} as never)).toBe("");
    expect(completionContractSection.render({} as never)).toBe("");
    expect(conversationBehaviorSection.render({} as never)).toBe("");
  });

  it("contextReliability 段说明 system-reminder 标签语义（流内提醒的可辨识框架）", () => {
    const text = contextReliabilitySection.render({} as never);
    expect(text).toContain("<system-reminder>");
    expect(text).toContain("不是用户发言");
  });

  it("todoGuidance 段保留 Todo 指导文案", () => {
    expect(todoGuidanceSection.render({} as never)).toContain("TodoWrite");
  });

  it("novel.identity 含创作协作者定位", () => {
    const text = novelIdentitySection.render({} as never);
    expect(text).toContain("中文网络小说创作协作者");
    expect(text).toContain("不臆造设定");
    expect(text).toContain("作者是最终决策者");
  });

  it("novel.system 含实体标签 + canonical 直写 + 注入防护", () => {
    const text = novelSystemSection.render({} as never);
    expect(text).toContain("<character id=");
    expect(text).toContain("直接作用于正式稿");
    expect(text).toContain("提示注入");
    expect(text).toContain("自动压缩");
  });

  it("novel.craft 含创作规范（不超范围/不预埋/不堆砌）", () => {
    const text = novelCraftSection.render({} as never);
    expect(text).toContain("不超范围");
    expect(text).toContain("不预埋");
    expect(text).toContain("不堆砌");
    expect(text).toContain("设定一致");
  });

  it("novel.execution 含谨慎行动（可逆性/高风险清单）", () => {
    const text = novelExecutionSection.render({} as never);
    expect(text).toContain("可逆性");
    expect(text).toContain("写入即正式稿");
    expect(text).toContain("高风险动作");
    expect(text).toContain("先问作者");
  });
});
