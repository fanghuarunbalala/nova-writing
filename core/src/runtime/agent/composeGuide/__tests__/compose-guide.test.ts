import { describe, it, expect } from "vitest";
import { LlmIntentClassifier } from "../LlmIntentClassifier.js";
import { selectGuideCases } from "../selectGuideCases.js";
import { wrapNovelGuideMessage } from "../novelGuideMessage.js";
import type { Provider } from "../../../provider/Provider.js";
import type { GuideCaseEntry } from "../types.js";

const entries: GuideCaseEntry[] = [
  {
    file: "outline-refine.md",
    path: ".novel/cases/outline-refine.md",
    taskType: "outline-refine",
    summary: "大纲细化",
    order: 10,
  },
  {
    file: "opening-design.md",
    path: ".novel/cases/opening-design.md",
    taskType: "opening-design",
    situation: "opening",
    summary: "开头设计",
    order: 20,
  },
  {
    file: "prose-draft.md",
    path: ".novel/cases/prose-draft.md",
    taskType: "prose-draft",
    summary: "正文撰写",
    order: 30,
  },
];

const sampling = { model: "fast-model", maxTokens: 256, thinking: "off" as const };

function scriptedProvider(reply: string | Error): { provider: Provider; state: { calls: number } } {
  const state = { calls: 0 };
  const provider: Provider = {
    call: async () => {
      state.calls += 1;
      if (reply instanceof Error) throw reply;
      return { finishReason: "stop", message: { role: "assistant", content: reply } };
    },
  };
  return { provider, state };
}

describe("LlmIntentClassifier（弃权语义）", () => {
  it("JSON 命中 → 标签；单次调用", async () => {
    const { provider, state } = scriptedProvider('{"task_type":"prose-draft"}');
    const tags = await new LlmIntentClassifier({ provider, sampling }).classify("撰写正文", entries);
    expect(tags).toMatchObject({ taskType: "prose-draft" });
    expect(tags?.characterType).toBeUndefined();
    expect(state.calls).toBe(1);
  });

  it("代码围栏包裹的 JSON → 剥离解析", async () => {
    const { provider } = scriptedProvider('```json\n{"task_type":"outline-refine"}\n```');
    const tags = await new LlmIntentClassifier({ provider, sampling }).classify("细化大纲", entries);
    expect(tags).toMatchObject({ taskType: "outline-refine" });
  });

  it("unknown / 枚举外 task_type / 垃圾文本 → undefined（弃权不猜）", async () => {
    for (const reply of ['{"task_type":"unknown"}', '{"task_type":"nope"}', "我觉得是正文任务吧"]) {
      const { provider } = scriptedProvider(reply);
      expect(await new LlmIntentClassifier({ provider, sampling }).classify("x", entries)).toBeUndefined();
    }
  });

  it("可选维度枚举校验：枚举内保留、越界/unknown 丢弃", async () => {
    const { provider } = scriptedProvider(
      '{"task_type":"opening-design","situation":"opening","character_type":"不存在的类型"}',
    );
    const tags = await new LlmIntentClassifier({ provider, sampling }).classify("设计开篇", entries);
    expect(tags).toMatchObject({ taskType: "opening-design", situation: "opening" });
    expect(tags?.characterType).toBeUndefined();
  });

  it("provider 抛错（超时/网络）→ undefined（无重试）", async () => {
    const { provider, state } = scriptedProvider(new Error("timeout"));
    expect(await new LlmIntentClassifier({ provider, sampling }).classify("x", entries)).toBeUndefined();
    expect(state.calls).toBe(1);
  });

  it("空案例库 → 直接 undefined（不发起调用）", async () => {
    const { provider, state } = scriptedProvider('{"task_type":"prose-draft"}');
    expect(await new LlmIntentClassifier({ provider, sampling }).classify("x", [])).toBeUndefined();
    expect(state.calls).toBe(0);
  });
});

describe("selectGuideCases（纯函数）", () => {
  it("tags 缺省（弃权）→ 空数组", () => {
    expect(selectGuideCases(entries, undefined)).toEqual([]);
  });

  it("task_type 不中 → 空数组（降级路径）", () => {
    expect(selectGuideCases(entries, { taskType: "nope" })).toEqual([]);
  });

  it("task_type 精确匹配", () => {
    expect(selectGuideCases(entries, { taskType: "prose-draft" }).map((e) => e.file)).toEqual([
      "prose-draft.md",
    ]);
  });

  it("可选维度有输出才细筛且仅在非空时生效（空则退化任务级）", () => {
    // situation=opening 命中 opening-design
    expect(
      selectGuideCases(entries, { taskType: "opening-design", situation: "opening" }).map((e) => e.file),
    ).toEqual(["opening-design.md"]);
    // situation=climax 无匹配 → 退化任务级（不筛空）
    expect(
      selectGuideCases(entries, { taskType: "opening-design", situation: "climax" }).map((e) => e.file),
    ).toEqual(["opening-design.md"]);
  });

  it("命中超 2 份取前 2（entries 序）", () => {
    const many: GuideCaseEntry[] = [1, 2, 3].map((i) => ({
      file: `c${i}.md`,
      path: `.novel/cases/c${i}.md`,
      taskType: "prose-draft",
      summary: `案例${i}`,
    }));
    expect(selectGuideCases(many, { taskType: "prose-draft" }).map((e) => e.file)).toEqual([
      "c1.md",
      "c2.md",
    ]);
  });
});

describe("wrapNovelGuideMessage", () => {
  it("空选中 → undefined（不注入）", () => {
    expect(wrapNovelGuideMessage([])).toBeUndefined();
  });

  it("选中条目 → <novel-guide> 包裹 system 消息（每份标题 + 路径 + 全文）", () => {
    const message = wrapNovelGuideMessage([
      { entry: entries[0], content: "# 案例正文A" },
      { entry: entries[1], content: "# 案例正文B" },
    ]);
    expect(message).toBeDefined();
    expect(message?.role).toBe("system");
    expect(message?.content.startsWith("<novel-guide>")).toBe(true);
    expect(message?.content.endsWith("</novel-guide>")).toBe(true);
    expect(message?.content).toContain("起草前必须对照");
    expect(message?.content).toContain("## 大纲细化");
    expect(message?.content).toContain("路径：.novel/cases/outline-refine.md");
    expect(message?.content).toContain("# 案例正文A");
    expect(message?.content).toContain("---"); // 多份分隔
  });

  it("summary 空时回退文件名作标题", () => {
    const message = wrapNovelGuideMessage([
      {
        entry: { file: "x.md", path: ".novel/cases/x.md", taskType: "t", summary: "" },
        content: "正文",
      },
    ]);
    expect(message?.content).toContain("## x.md");
  });
});
