import { describe, it, expect } from "vitest";
import { coreEnvironmentSection } from "../agent.js";
import {
  novelCommunicationSection,
  novelGlobalConstraintsSection,
  novelComposeGuideSection,
} from "../novel.js";
import type { DynamicPromptSectionInput } from "../../PromptSection.js";

describe("core.environment 动态段", () => {
  it("输入缺失或 workdir/platform 为空 → 整段省略（空串）", () => {
    expect(coreEnvironmentSection.renderDynamic({}, {} as never)).toBe("");
    expect(
      coreEnvironmentSection.renderDynamic(
        { environment: { workdir: "  ", platform: "Windows" } },
        {} as never,
      ),
    ).toBe("");
    expect(
      coreEnvironmentSection.renderDynamic(
        { environment: { workdir: "/ws", platform: "" } },
        {} as never,
      ),
    ).toBe("");
  });

  it("完整输入：日期/时区现场计算 + platform/workdir/model 行", () => {
    const input: DynamicPromptSectionInput = {
      environment: { workdir: "/ws", platform: "Windows", modelId: "gpt-5" },
    };
    const text = coreEnvironmentSection.renderDynamic(input, {} as never);
    expect(text).toContain("# 环境信息");
    expect(text).toContain("- 平台：Windows");
    expect(text).toContain("- 工作目录：/ws");
    expect(text).toContain("- 模型：gpt-5");
    // 当前日期行：格式 YYYY-MM-DD + 时区括号
    expect(text).toMatch(/- 当前日期：\d{4}-\d{2}-\d{2}（.+?）/);
  });

  it("modelId 缺失 → 模型行省略", () => {
    const text = coreEnvironmentSection.renderDynamic(
      { environment: { workdir: "/ws", platform: "Linux" } },
      {} as never,
    );
    expect(text).not.toContain("- 模型：");
    expect(text).toContain("- 工作目录：/ws");
  });
});

describe("novel.global_constraints 动态段", () => {
  it("常驻说明恒渲染 + 内容 <Novel-Constraints-Content> 包裹", () => {
    const text = novelGlobalConstraintsSection.renderDynamic(
      {
        novelGlobalConstraints: {
          fileName: "NOVEL.md",
          content: "# 世界观\n- 基调热血",
        },
      },
      {} as never,
    );
    expect(text).toContain("# 小说全局约束（NOVEL.md）");
    expect(text).toContain("每次 Provider Call 都会重新读取该文件");
    expect(text).toContain("<Novel-Constraints-Content>");
    expect(text).toContain("# 世界观");
    expect(text).toContain("</Novel-Constraints-Content>");
  });

  it("输入缺失/空内容 → 常驻说明仍渲染 + 空占位提示", () => {
    const absent = novelGlobalConstraintsSection.renderDynamic({}, {} as never);
    expect(absent).toContain("# 小说全局约束（NOVEL.md）");
    expect(absent).toContain("（当前无可用内容");
    const empty = novelGlobalConstraintsSection.renderDynamic(
      { novelGlobalConstraints: { fileName: "NOVEL.md", content: "  \n" } },
      {} as never,
    );
    expect(empty).toContain("（当前无可用内容");
  });
});

describe("novel.communication 静态段", () => {
  it("legacy 中文文案迁移完整（关键条目在）", () => {
    const text = novelCommunicationSection.render({} as never);
    expect(text).toContain("# 交流风格");
    expect(text).toContain("先简要说明你要做什么");
    expect(text).toContain("不要叙述内部机制");
    expect(text).toContain("简单回答用散文");
    expect(text).toContain("用一句话说明做了什么");
    expect(text).toContain("一条回复只问一个问题");
    expect(text).toContain("不使用 emoji");
    expect(text).toContain("不做负面假设");
    expect(text).toContain("不适用于正文输出本身");
  });
});

describe("novel.compose.guide 动态段（PRD compose-案例引导）", () => {
  it("快照输入：先查后写 + 仅参考不抄袭 + 派生索引（不渲染正文——正文走 msg 通道）", () => {
    const text = novelComposeGuideSection.renderDynamic(
      {
        composeGuide: {
          index: "- .novel/cases/大纲细化设计案例.md ｜ task=act-design ｜ 大纲-幕设计",
          casesDir: ".novel/cases",
        },
      },
      {} as never,
    );
    expect(text).toContain("# 任务案例引导");
    expect(text).toContain("**编写前先查案例**");
    expect(text).toContain("用 Read 通读");
    expect(text).toContain("`<novel-guide>` 消息注入");
    expect(text).toContain("**案例仅供参考**");
    expect(text).toContain("不抄袭");
    expect(text).toContain(".novel/cases/大纲细化设计案例.md");
    expect(text).not.toContain("<Novel-Constraints-Content>");
  });

  it("缺输入 → 标题 + 占位一行（不省略段，对齐 global_constraints 降级语义）", () => {
    const text = novelComposeGuideSection.renderDynamic({}, {} as never);
    expect(text).toContain("# 任务案例引导");
    expect(text).toContain("未就绪");
  });
});
