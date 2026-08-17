import { describe, it, expect } from "vitest";
import { createAskUserTool } from "../askUser.js";
import type { AskQuestionAnswer } from "../../../../conversation/contract/types/index.js";
import type { ToolCall } from "../../../provider/types.js";

function call(args: Record<string, unknown>): ToolCall {
  return { id: "c1", name: "AskUserQuestion", args: JSON.stringify(args) };
}

const QUESTIONS = [
  {
    question: "第二卷主线走哪个方向？",
    header: "主线走向",
    options: [
      { label: "外部压境（推荐）", description: "冲突外化" },
      { label: "内部瓦解", description: "权谋向" },
    ],
  },
  { question: "一句话说说你的创意？", header: "一句话创意", placeholder: "一句话：主角 + 冲突" },
];

describe("createAskUserTool", () => {
  it("经 ask 通道挂起并回填作者回答（选择 + 自填）", async () => {
    const seen: string[] = [];
    const tool = createAskUserTool(async (req) => {
      seen.push(req.requestId);
      expect(req.questions).toHaveLength(2);
      expect(req.questions[0].options).toHaveLength(2);
      expect(req.questions[1].options).toBeUndefined();
      expect(req.questions[1].placeholder).toBe("一句话：主角 + 冲突");
      return [
        { question: "第二卷主线走哪个方向？", selections: ["外部压境（推荐）"] },
        { question: "一句话说说你的创意？", selections: [], text: "末世邮差送最后一封信" },
      ];
    }, "conv-1");
    const out = await tool.handler.execute(call({ questions: QUESTIONS }));
    expect(seen[0]).toMatch(/^ask:conv-1:/);
    expect(out).toContain("作者已作答（2/2 问）");
    expect(out).toContain("「第二卷主线走哪个方向？」选择：外部压境（推荐）");
    expect(out).toContain("自填：末世邮差送最后一封信");
  });

  it("部分跳过：计数 + 跳过行", async () => {
    const tool = createAskUserTool(
      async () =>
        [
          { question: "第二卷主线走哪个方向？", selections: [], skipped: true },
          { question: "一句话说说你的创意？", selections: [], text: "就写末日废土" },
        ] satisfies AskQuestionAnswer[],
      "conv-1",
    );
    const out = await tool.handler.execute(call({ questions: QUESTIONS }));
    expect(out).toContain("1/2 问，1 问跳过");
    expect(out).toContain("跳过（作者授权自行决断）");
  });

  it("全跳过：回填自行决断指引", async () => {
    const tool = createAskUserTool(
      async () =>
        QUESTIONS.map((q) => ({ question: q.question, selections: [], skipped: true })) satisfies AskQuestionAnswer[],
      "conv-1",
    );
    const out = await tool.handler.execute(call({ questions: QUESTIONS }));
    expect(out).toContain("作者跳过了全部问题（共 2 问）");
    expect(out).toContain("不要重复追问");
  });

  it("ask 通道未装配：回「未送达」文本而非抛错", async () => {
    const tool = createAskUserTool(undefined, "conv-1");
    const out = await tool.handler.execute(call({ questions: QUESTIONS }));
    expect(out).toContain("提问未送达作者");
    expect(out).toContain("不要重试");
  });

  it("参数防御：questions 数量 / options 数量 / 缺字段 / options+placeholder 互斥拒绝", async () => {
    const tool = createAskUserTool(async () => [], "conv-1");
    await expect(tool.handler.execute(call({ questions: [] }))).rejects.toThrow(/1-4/);
    await expect(
      tool.handler.execute(call({ questions: [{ question: "q?", header: "h", options: [{ label: "a", description: "x" }] }] })),
    ).rejects.toThrow(/2-4/);
    await expect(tool.handler.execute(call({ questions: [{ header: "h" }] }))).rejects.toThrow(/question 或 header/);
    await expect(tool.handler.execute(call({}))).rejects.toThrow(/无效的 JSON 参数|questions/);
    // 开放填空题只有一个文本框：选择题带 placeholder 拒绝（2026-08-17 日志错乱形态回归）
    await expect(
      tool.handler.execute(
        call({
          questions: [
            {
              question: "q?",
              header: "h",
              options: [
                { label: "a", description: "x" },
                { label: "b", description: "y" },
              ],
              placeholder: "提示",
            },
          ],
        }),
      ),
    ).rejects.toThrow(/placeholder/);
  });

  it("schema：questions 1-4、options 给出则 2-4、开放题省略 options", () => {
    const tool = createAskUserTool(undefined, "conv-1");
    expect(tool.name).toBe("AskUserQuestion");
    expect(tool.promptDetail).toEqual({ policy: "", guidance: "" });
    const params = tool.parameters as {
      properties: { questions: { minItems: number; maxItems: number; items: { properties: Record<string, unknown> } } };
    };
    expect(params.properties.questions.minItems).toBe(1);
    expect(params.properties.questions.maxItems).toBe(4);
    expect(params.properties.questions.items.properties.options.minItems).toBe(2);
    expect(params.properties.questions.items.properties.options.maxItems).toBe(4);
    expect(tool.description).toContain("何时使用");
    expect(tool.description).toContain("（反例）");
  });
});
