import { describe, it, expect } from "vitest";
import { coreEnvironmentSection } from "../agent.js";
import { novelCommunicationSection, novelGlobalConstraintsSection } from "../novel.js";
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

describe("novel.global_constraints 动态段（两层，PRD memory-两层记忆 M1）", () => {
  it("两层注入：全局在前项目在后 + 优先级标注 + 分层标签包裹", () => {
    const text = novelGlobalConstraintsSection.renderDynamic(
      {
        novelGlobalConstraints: {
          global: "# 跨书\n- 不要 BE",
          project: "# 本书\n- 基调热血",
        },
      },
      {} as never,
    );
    expect(text).toContain("# 小说全局约束（分层 NOVEL.md）");
    expect(text).toContain("项目层优先于全局层");
    expect(text).toContain("<Novel-Constraints-Global>");
    expect(text).toContain("不要 BE");
    expect(text).toContain("<Novel-Constraints-Project>");
    expect(text).toContain("基调热血");
    // 拼接顺序：全局层在项目层之前
    expect(text.indexOf("不要 BE")).toBeLessThan(text.indexOf("基调热血"));
    // 修改治理提示（强制审批）
    expect(text).toContain("必须经作者审批");
  });

  it("单层缺失只注另一层；输入缺失/两层全空 → 占位提示", () => {
    const projectOnly = novelGlobalConstraintsSection.renderDynamic(
      { novelGlobalConstraints: { project: "# 本书\n- 基调热血" } },
      {} as never,
    );
    expect(projectOnly).toContain("基调热血");
    expect(projectOnly).not.toContain("Novel-Constraints-Global");
    const absent = novelGlobalConstraintsSection.renderDynamic({}, {} as never);
    expect(absent).toContain("当前两层均无可用内容");
    const empty = novelGlobalConstraintsSection.renderDynamic(
      { novelGlobalConstraints: { global: "  \n", project: " " } },
      {} as never,
    );
    expect(empty).toContain("当前两层均无可用内容");
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
