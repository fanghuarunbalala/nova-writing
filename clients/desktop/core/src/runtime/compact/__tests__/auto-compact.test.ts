import { describe, it, expect } from "vitest";
import {
  AutoCompactPolicy,
  parseNovelCall,
  estimateTokens,
  countRunChars,
} from "../definitions/auto-compact.js";
import { stripNudgeMessages } from "../definitions/auto-compact-t2.js";
import { ModelInfoRegistry } from "../../provider/model-info.js";
import type { LoopContext } from "../../loop/LoopContext.js";
import type { RunContext } from "../../loop/types.js";
import type { Provider } from "../../provider/Provider.js";
import type { ProviderCall } from "../../provider/types.js";

// ── 测试装置 ──

/** 窗口 10_000、T2 余量 500、maxOutput 2000 时的阈值线：t1=7000 t2=7500 t3=9000 */
const TEST_WINDOW = 10_000;

function makeRun(
  seq: number,
  messages: RunContext["messages"],
  signal?: { inputTokens: number; model?: string; maxOutputTokens?: number },
): RunContext {
  const arr = [...messages];
  return {
    seq,
    messages: arr,
    ts: "2026-08-16T00:00:00.000Z",
    appendRunMessages: (m) => {
      arr.push(...m);
    },
    ...(signal === undefined
      ? {}
      : {
          lastInputTokens: signal.inputTokens,
          model: signal.model ?? "test-model",
          maxOutputTokens: signal.maxOutputTokens ?? 2000,
        }),
  };
}

/** 信号挂在最后一个 run；signalChars 设为当前全部字符 → est = inputTokens（比例重估起点） */
function makeLoop(runs: RunContext[], signal?: { inputTokens: number; maxOutputTokens?: number }): LoopContext {
  const list = [...runs];
  if (signal !== undefined && list.length > 0) {
    const last = list[list.length - 1]!;
    last.lastInputTokens = signal.inputTokens;
    last.signalChars = countRunChars(list);
    last.model = "test-model";
    last.maxOutputTokens = signal.maxOutputTokens ?? 2000;
  }
  let seq = list.reduce((m, r) => Math.max(m, r.seq), 0);
  return {
    runs: list,
    allocateSeq: () => ++seq,
  } as unknown as LoopContext;
}

function makeProvider(summaryText: string, opts: { fail?: boolean } = {}) {
  const calls: ProviderCall[] = [];
  const provider: Provider = {
    call: async (call: ProviderCall) => {
      calls.push(call);
      if (opts.fail) throw new Error("provider down");
      return {
        finishReason: "stop",
        message: { role: "assistant", content: summaryText },
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
    getModelInfo: (model: string) => ({
      model,
      supportsTemperature: true,
      thinkingMode: "none" as const,
      contextWindowTokens: TEST_WINDOW,
    }),
  };
  return { provider, calls };
}

function makePolicy(provider: Provider, extra: Record<string, unknown> = {}) {
  return new AutoCompactPolicy(provider, {
    windowTokensOf: () => TEST_WINDOW,
    t2MarginTokens: 500,
    ...extra,
  });
}

// ── 纯函数 ──

describe("parseNovelCall", () => {
  it("read 带目标 id → read + entityIds", () => {
    const r = parseNovelCall("NovelCharacterRead", '{"characterId":"ch1"}');
    expect(r?.kind).toBe("read");
    expect([...r!.entityIds]).toEqual(["ch1"]);
  });

  it("通用工具名（NovelRead/Write/Edit）新旧并存识别", () => {
    const r = parseNovelCall("NovelRead", '{"kind":"character","characterId":"ch1"}');
    expect(r?.kind).toBe("read");
    expect([...r!.entityIds]).toEqual(["ch1"]);
    const list = parseNovelCall("NovelRead", '{"kind":"paragraph","storyUnitId":"su1"}');
    expect(list?.kind).toBe("read");
    expect([...list!.entityIds]).toEqual(["su1"]);
    const w = parseNovelCall("NovelWrite", '{"kind":"chapter","values":[{"id":"ch1","title":"t"}]}');
    expect(w?.kind).toBe("write");
    expect([...w!.entityIds]).toEqual(["ch1"]);
    const e = parseNovelCall("NovelEdit", '{"kind":"story_unit","values":[{"id":"su1","baseRevision":1,"value":{"title":"t"}}]}');
    expect(e?.kind).toBe("write");
    expect([...e!.entityIds]).toEqual(["su1"]);
  });

  it("read 省略 id（列表查询）→ 空 entityIds", () => {
    const r = parseNovelCall("NovelChapterRead", "{}");
    expect(r?.kind).toBe("read");
    expect(r?.entityIds.size).toBe(0);
  });

  it("write/edit/delete 提取 values[].id", () => {
    const w = parseNovelCall(
      "NovelCharacterWrite",
      '{"values":[{"id":"ch1","name":"主角"},{"id":"ch2","name":"配角"}]}',
    );
    expect(w?.kind).toBe("write");
    expect([...w!.entityIds]).toEqual(["ch1", "ch2"]);
    const d = parseNovelCall(
      "NovelDelete",
      '{"values":[{"kind":"character","id":"ch1","baseRevision":3}]}',
    );
    expect([...d!.entityIds]).toEqual(["ch1"]);
  });

  it("非 novel 工具 / 坏 JSON → undefined", () => {
    expect(parseNovelCall("ReadFile", '{"path":"a"}')).toBeUndefined();
    expect(parseNovelCall("NovelCharacterRead", "{oops")).toBeUndefined();
  });

  it("占位形态（T1 压缩产物）的顶层 ids 数组同样提取为 write 目标", () => {
    const r = parseNovelCall("NovelChapterEdit", '{"_compacted":"写入内容已入正式稿","ids":["chA","chB"]}');
    expect(r?.kind).toBe("write");
    expect([...r!.entityIds]).toEqual(["chA", "chB"]);
  });
});

describe("estimateTokens / countRunChars", () => {
  it("assistant toolCalls 参数计入字符", () => {
    const tokens = estimateTokens([
      { role: "user", content: "abcd" },
      { role: "assistant", content: "ef", toolCalls: [{ id: "t", name: "X", args: "1234" }] },
    ]);
    // 10 字符 / 2 = 5 token
    expect(tokens).toBe(5);
  });
});

describe("ModelInfoRegistry 上下文窗口启发式", () => {
  const reg = new ModelInfoRegistry();
  it("按名称前缀给默认窗口", () => {
    expect(reg.getModelInfo("claude-sonnet-5").contextWindowTokens).toBe(200_000);
    expect(reg.getModelInfo("deepseek-chat").contextWindowTokens).toBe(128_000);
    expect(reg.getModelInfo("gpt-5-mini").contextWindowTokens).toBe(400_000);
    expect(reg.getModelInfo("local-llama").contextWindowTokens).toBe(128_000);
  });
  it("register 覆盖窗口", () => {
    const reg2 = new ModelInfoRegistry();
    reg2.register("claude-sonnet-5", {
      model: "claude-sonnet-5",
      supportsTemperature: false,
      thinkingMode: "adaptive-effort",
      contextWindowTokens: 1_000_000,
    });
    expect(reg2.getModelInfo("claude-sonnet-5").contextWindowTokens).toBe(1_000_000);
  });
});

// ── 阈值判定 ──

describe("AutoCompactPolicy.shouldCompact", () => {
  it("低于 T1 不压缩", () => {
    const { provider } = makeProvider("s");
    const p = makePolicy(provider);
    const loop = makeLoop(
      [
        makeRun(1, [{ role: "user", content: "开篇意图" }]),
        makeRun(2, [{ role: "user", content: "问题" }, { role: "tool", content: "x".repeat(600), id: "t" }]),
        makeRun(3, [{ role: "user", content: "a" }]),
        makeRun(4, [{ role: "user", content: "b" }]),
        makeRun(5, [{ role: "user", content: "c" }]),
      ],
      { inputTokens: 6999 },
    );
    expect(p.shouldCompact(loop)).toBe(false);
  });

  it("超过 T1 且有可剪内容 → true", () => {
    const { provider } = makeProvider("s");
    const p = makePolicy(provider);
    const loop = makeLoop(
      [
        makeRun(1, [{ role: "user", content: "开篇意图" }]),
        makeRun(2, [{ role: "user", content: "问题" }, { role: "tool", content: "x".repeat(600), id: "t" }]),
        makeRun(3, [{ role: "user", content: "a" }]),
        makeRun(4, [{ role: "user", content: "b" }]),
        makeRun(5, [{ role: "user", content: "c" }]),
      ],
      { inputTokens: 7100 },
    );
    expect(p.shouldCompact(loop)).toBe(true);
  });

  it("超过 T1 但压缩区干净 → false", () => {
    const { provider } = makeProvider("s");
    const p = makePolicy(provider);
    const loop = makeLoop(
      [
        makeRun(1, [{ role: "user", content: "开篇意图" }]),
        makeRun(2, [{ role: "user", content: "短问题" }]),
        makeRun(3, [{ role: "user", content: "a" }]),
        makeRun(4, [{ role: "user", content: "b" }]),
        makeRun(5, [{ role: "user", content: "c" }]),
      ],
      { inputTokens: 7200 },
    );
    expect(p.shouldCompact(loop)).toBe(false);
  });

  it("无模型信号（未发过 provider call）→ false", () => {
    const { provider } = makeProvider("s");
    const p = makePolicy(provider);
    const loop = makeLoop(
      [
        makeRun(1, [{ role: "user", content: "开篇意图" }]),
        makeRun(2, [{ role: "user", content: "问题" }, { role: "tool", content: "x".repeat(600), id: "t" }]),
        makeRun(3, [{ role: "user", content: "a" }]),
        makeRun(4, [{ role: "user", content: "b" }]),
        makeRun(5, [{ role: "user", content: "c" }]),
      ],
    );
    expect(p.shouldCompact(loop)).toBe(false);
  });
});

// ── T1 结构化骨架化 ──

describe("AutoCompactPolicy T1 结构化", () => {
  function t1Scenario() {
    const runs = [
      // 首 run：超长内容也不动（作者意图保护区）
      makeRun(1, [{ role: "user", content: "开篇创作意图" + "设定".repeat(300) }]),
      // z1：novel 读（后被 z2 写覆盖 → 过期读占位）+ 通用工具超长结果
      makeRun(2, [
        { role: "user", content: "读一下主角档案" },
        {
          role: "assistant",
          content: "我来查",
          toolCalls: [
            { id: "r1", name: "NovelCharacterRead", args: '{"characterId":"ch1"}' },
            { id: "f1", name: "ReadFile", args: '{"path":"a.md"}' },
          ],
        },
        { role: "tool", content: "档".repeat(600), id: "r1" },
        { role: "tool", content: "文".repeat(600), id: "f1" },
      ]),
      // z2：两次写同实体（前一次被覆盖 → 参数占位；最后一次保留）+ 最后写但超长参数 → ids 占位
      makeRun(3, [
        { role: "user", content: "更新设定" },
        {
          role: "assistant",
          content: "执行写入",
          toolCalls: [
            {
              id: "w0",
              name: "NovelCharacterWrite",
              args: JSON.stringify({ values: [{ id: "ch1", name: "主角", summary: "长".repeat(300) }] }),
            },
            {
              id: "w1",
              name: "NovelCharacterEdit",
              args: '{"values":[{"id":"ch1","baseRevision":2,"value":{"summary":"新版"}}]}',
            },
            {
              id: "w2",
              name: "NovelLocationEdit",
              args: JSON.stringify({
                values: [{ id: "loc1", baseRevision: 1, value: { summary: "地".repeat(900) } }],
              }),
            },
            { id: "f2", name: "WriteFile", args: '{"path":"a.md","content":"' + "z".repeat(900) + '"}' },
          ],
        },
        { role: "tool", content: "ok", id: "w0" },
        { role: "tool", content: "ok", id: "w1" },
        { role: "tool", content: "ok", id: "w2" },
        { role: "tool", content: "ok", id: "f2" },
      ]),
      // z3：novel 正文块 + 超长评述
      makeRun(4, [
        { role: "user", content: "写第一章" },
        {
          role: "assistant",
          content:
            "好的，以下是第一章：\n```novel\n第一章 启程\n\n清晨的雾气弥漫在山谷。\n```\n另外补充一些说明：" +
            "评".repeat(1200),
        },
      ]),
      makeRun(5, [{ role: "user", content: "尾1" }]),
      makeRun(6, [{ role: "user", content: "尾2" }]),
      makeRun(7, [{ role: "user", content: "尾3" }]),
    ];
    return runs;
  }

  it("通用长度规则 + novel 域规则全部生效，保护区不动", async () => {
    const { provider } = makeProvider("s");
    const p = makePolicy(provider);
    const runs = t1Scenario();
    const loop = makeLoop(runs, { inputTokens: 7200 }); // ≥t1(7000) <t2(7500)：只走 T1
    const firstBefore = JSON.stringify(runs[0]!.messages);
    const tailBefore = JSON.stringify(runs.slice(4).flatMap((r) => r.messages));

    const changed = await p.compact(loop);
    expect(changed).toBe(true);

    const z1 = runs[1]!.messages;
    const z2 = runs[2]!.messages;
    const z3 = runs[3]!.messages;

    // 过期读（ch1 被 z2 的 w1 覆盖）→ 覆盖占位（z1[2] = r1 结果）
    expect(z1[2]!.content).toContain("工具结果已省略");
    expect(z1[2]!.content).toContain("已被后续写入覆盖");
    // 通用工具超长结果 → 长度占位（z1[3] = f1 结果）
    expect(z1[3]!.content).toContain("工具结果已省略");
    expect(z1[3]!.content).toContain("600 字");

    const w0 = (z2[1] as { toolCalls: { id: string; args: string }[] }).toolCalls.find((t) => t.id === "w0")!;
    const w1 = (z2[1] as { toolCalls: { id: string; args: string }[] }).toolCalls.find((t) => t.id === "w1")!;
    const w2 = (z2[1] as { toolCalls: { id: string; args: string }[] }).toolCalls.find((t) => t.id === "w2")!;
    const f2 = (z2[1] as { toolCalls: { id: string; args: string }[] }).toolCalls.find((t) => t.id === "f2")!;
    // w0（ch1 的早期写，被 w1 覆盖）→ 覆盖占位
    expect(w0.args).toContain("_compacted");
    expect(w0.args).toContain("已被后续写入覆盖");
    // w1（最后一次写，参数短）→ 原样保留
    expect(w1.args).not.toContain("_compacted");
    // w2（loc1 最后一次写但参数超长）→ ids 占位（正式稿为准）
    expect(w2.args).toContain("_compacted");
    expect(w2.args).toContain("loc1");
    // f2（非 novel 超长参数）→ 通用占位
    expect(f2.args).toContain("_compacted");

    // z3：正文块入档 + 长评述截断
    const z3Text = (z3[1] as { content: string }).content;
    expect(z3Text).toContain("[正文已入档：第一章 启程]");
    expect(z3Text).toContain("已省略");
    expect(z3Text.length).toBeLessThan(700);

    // 保护区不动
    expect(JSON.stringify(runs[0]!.messages)).toBe(firstBefore);
    expect(JSON.stringify(runs.slice(4).flatMap((r) => r.messages))).toBe(tailBefore);
    // user 消息不动
    expect((z1[0] as { content: string }).content).toBe("读一下主角档案");
  });

  it("幂等：再次压缩不产生新变化", async () => {
    const { provider } = makeProvider("s");
    const p = makePolicy(provider);
    const runs = t1Scenario();
    const loop = makeLoop(runs, { inputTokens: 7200 });
    await p.compact(loop);
    const snapshot = JSON.stringify(loop.runs.map((r) => r.messages));
    const changed2 = await p.compact(loop, { force: true });
    expect(JSON.stringify(loop.runs.map((r) => r.messages))).toBe(snapshot);
    expect(changed2).toBe(false);
  });

  it("保留尾区的后续写入同样使压缩区内的读过期（后写覆盖前读跨区生效）", async () => {
    const { provider } = makeProvider("s");
    const p = makePolicy(provider);
    const runs = [
      makeRun(1, [{ role: "user", content: "开篇意图" }]),
      makeRun(2, [
        { role: "user", content: "读一下主角" },
        {
          role: "assistant",
          content: "查询",
          toolCalls: [{ id: "r1", name: "NovelCharacterRead", args: '{"characterId":"ch9"}' }],
        },
        { role: "tool", content: "档".repeat(200), id: "r1" }, // 短结果：只有"被覆盖"规则才会占位
      ]),
      makeRun(3, [{ role: "user", content: "尾1" }]),
      makeRun(4, [{ role: "user", content: "尾2" }]),
      // 尾区（倒数第三）内的写：晚于压缩区的读 → 读过期
      makeRun(5, [
        { role: "user", content: "改一下" },
        {
          role: "assistant",
          content: "执行",
          toolCalls: [
            { id: "w9", name: "NovelCharacterEdit", args: '{"values":[{"id":"ch9","baseRevision":1,"value":{"summary":"新版"}}]}' },
          ],
        },
        { role: "tool", content: "ok", id: "w9" },
      ]),
    ];
    const loop = makeLoop(runs, { inputTokens: 7200 });
    expect(await p.compact(loop)).toBe(true);
    const z1 = runs[1]!.messages;
    expect(z1[2]!.content).toContain("已被后续写入覆盖");
  });

  it("批量写部分覆盖：写 A+B 后仅重写 A → 首次调用因 B 未覆盖而保留", async () => {
    const { provider } = makeProvider("s");
    const p = makePolicy(provider);
    const runs = [
      makeRun(1, [{ role: "user", content: "开篇意图" }]),
      makeRun(2, [
        { role: "user", content: "建档" },
        {
          role: "assistant",
          content: "批量写入",
          toolCalls: [
            {
              id: "b1",
              name: "NovelCharacterWrite",
              args: JSON.stringify({
                values: [
                  { id: "chA", name: "甲", summary: "长".repeat(500) },
                  { id: "chB", name: "乙", summary: "长".repeat(500) },
                ],
              }),
            },
          ],
        },
        { role: "tool", content: "ok", id: "b1" },
      ]),
      makeRun(3, [
        { role: "user", content: "只改甲" },
        {
          role: "assistant",
          content: "更新",
          toolCalls: [
            { id: "b2", name: "NovelCharacterEdit", args: '{"values":[{"id":"chA","baseRevision":1,"value":{"summary":"新版"}}]}' },
          ],
        },
        { role: "tool", content: "ok", id: "b2" },
      ]),
      makeRun(4, [{ role: "user", content: "尾1" }]),
      makeRun(5, [{ role: "user", content: "尾2" }]),
    ];
    const loop = makeLoop(runs, { inputTokens: 7200 });
    await p.compact(loop);
    const b1 = (runs[1]!.messages[1] as { toolCalls: { id: string; args: string }[] }).toolCalls.find((t) => t.id === "b1")!;
    const b2 = (runs[2]!.messages[1] as { toolCalls: { id: string; args: string }[] }).toolCalls.find((t) => t.id === "b2")!;
    // b1 是 chB 的最后一次写 → 保留记录，但超长参数占位（ids 携带 chA/chB）
    expect(b1.args).toContain("_compacted");
    expect(b1.args).toContain("chA");
    expect(b1.args).toContain("chB");
    // b2 参数短 → 原样
    expect(b2.args).not.toContain("_compacted");
  });

  it("占位 ids 跨轮次跟踪回归：被占位的最后写仍能覆盖更早的读（第二次压缩）", async () => {
    const { provider } = makeProvider("s");
    const p = makePolicy(provider);
    const mkRuns = () => [
      makeRun(1, [{ role: "user", content: "开篇意图" }]),
      makeRun(2, [
        { role: "user", content: "读" },
        {
          role: "assistant",
          content: "查询",
          toolCalls: [{ id: "r1", name: "NovelParagraphRead", args: '{"paragraphId":"pg1"}' }],
        },
        { role: "tool", content: "段落内容".repeat(100), id: "r1" },
      ]),
      makeRun(3, [
        { role: "user", content: "写" },
        {
          role: "assistant",
          content: "落笔",
          toolCalls: [
            {
              id: "w1",
              name: "NovelParagraphWrite",
              args: JSON.stringify({ values: [{ id: "pg1", storyUnitId: "u1", title: "段落", content: "文".repeat(900) }] }),
            },
          ],
        },
        { role: "tool", content: "ok", id: "w1" },
      ]),
      makeRun(4, [{ role: "user", content: "尾1" }]),
      makeRun(5, [{ role: "user", content: "尾2" }]),
      makeRun(6, [{ role: "user", content: "尾3" }]),
    ];
    const runs = mkRuns();
    const loop = makeLoop(runs, { inputTokens: 7200 });
    await p.compact(loop); // 第一轮：w1 参数占位（ids:["pg1"]）、r1 结果占位（已被覆盖）
    const w1 = (runs[2]!.messages[1] as { toolCalls: { id: string; args: string }[] }).toolCalls.find((t) => t.id === "w1")!;
    expect(w1.args).toContain('"ids":["pg1"]');
    expect(runs[1]!.messages[2]!.content).toContain("已被后续写入覆盖");
    // 第二轮（模拟恢复/后补场景）：在 w1 之前插入一个旧读——占位后的 w1（ids 形态）
    // 仍应作为 pg1 的最后写参与覆盖判定（读早于写 = 过期）
    loop.runs.splice(2, 0, makeRun(99, [
      { role: "user", content: "更早的一次读" },
      {
        role: "assistant",
        content: "再查",
        toolCalls: [{ id: "r2", name: "NovelParagraphRead", args: '{"paragraphId":"pg1"}' }],
      },
      { role: "tool", content: "段落内容".repeat(100), id: "r2" },
    ]));
    await p.compact(loop, { force: true });
    const r2Run = loop.runs.find((r) => r.seq === 99)!;
    expect((r2Run.messages[2] as { content: string }).content).toContain("已被后续写入覆盖");
    // 对照：写之后的新读（新鲜数据）不占位——插入到 w1 之后、且保持在压缩区内
    loop.runs.splice(4, 0, makeRun(100, [
      { role: "user", content: "写之后的新读" },
      {
        role: "assistant",
        content: "复查",
        toolCalls: [{ id: "r3", name: "NovelParagraphRead", args: '{"paragraphId":"pg1"}' }],
      },
      { role: "tool", content: "最新段落内容（短结果）", id: "r3" },
    ]));
    loop.runs.push(makeRun(101, [{ role: "user", content: "垫尾" }]));
    await p.compact(loop, { force: true });
    const r3Run = loop.runs.find((r) => r.seq === 100)!;
    expect((r3Run.messages[2] as { content: string }).content).not.toContain("已被后续写入覆盖");
    expect((r3Run.messages[2] as { content: string }).content).toBe("最新段落内容（短结果）"); // 原文保留
  });

  it("保护区刚性：最近 run 含超长内容也不动（执行中 run 恒不触碰）", async () => {
    const { provider } = makeProvider("s");
    const p = makePolicy(provider);
    const runs = [
      makeRun(1, [{ role: "user", content: "开篇意图" }]),
      makeRun(2, [{ role: "user", content: "压缩区超长工具结果" }, { role: "tool", content: "x".repeat(800), id: "t" }]),
      makeRun(3, [{ role: "user", content: "尾1" }]),
      makeRun(4, [{ role: "user", content: "尾2" }]),
      makeRun(5, [
        { role: "user", content: "当前 run 的问题" },
        {
          role: "assistant",
          content: "```novel\n未完正文\n```\n" + "长".repeat(2000),
          toolCalls: [{ id: "cur", name: "NovelChapterRead", args: '{"chapterId":"c1"}' }],
        },
        { role: "tool", content: "y".repeat(900), id: "cur" },
      ]),
    ];
    const loop = makeLoop(runs, { inputTokens: 7200 });
    const tailBefore = JSON.stringify(runs[4]!.messages);
    await p.compact(loop);
    expect(JSON.stringify(runs[4]!.messages)).toBe(tailBefore); // 当前 run 完整保留
    expect(runs[1]!.messages[1]!.content).toContain("工具结果已省略"); // 压缩区照常处理
  });
});

// ── T2 逐段摘要折叠 ──

describe("AutoCompactPolicy T2 摘要折叠", () => {
  function t2Runs() {
    // 长内容放 user 消息（T1 不裁 user），assistant 保持短——隔离 T2 行为
    return [
      makeRun(1, [{ role: "user", content: "开篇意图" }]),
      makeRun(2, [
        { role: "user", content: "问题一" + "一".repeat(2000) },
        { role: "assistant", content: "回答一" },
      ]),
      makeRun(3, [
        { role: "user", content: "问题二" + "二".repeat(2000) },
        { role: "assistant", content: "回答二" },
      ]),
      makeRun(4, [{ role: "user", content: "尾1" }]),
      makeRun(5, [{ role: "user", content: "尾2" }]),
      makeRun(6, [{ role: "user", content: "尾3" }]),
    ];
  }

  it("超 T2 线：压缩区整体折叠为一条摘要 run，摘要请求形状正确", async () => {
    const { provider, calls } = makeProvider("这是摘要正文");
    const p = makePolicy(provider);
    const runs = t2Runs();
    const loop = makeLoop(runs, { inputTokens: 8000 }); // ≥t2(7500)

    expect(await p.compact(loop)).toBe(true);
    // [首run][摘要run][尾3run] = 5
    expect(loop.runs).toHaveLength(5);
    const summary = loop.runs[1]!;
    const text = (summary.messages[0] as { content: string }).content;
    expect(text).toContain("<context-summary>");
    expect(text).toContain("这是摘要正文");
    expect(text).toContain("第 2–3 轮");
    expect((summary.messages[0] as { role: string }).role).toBe("user");
    // 摘要请求：无工具、关思考、扁平化段内消息
    expect(calls).toHaveLength(1);
    expect(calls[0]!.tools).toEqual([]);
    expect(calls[0]!.sampling.thinking).toBe("off");
    expect(calls[0]!.sampling.maxTokens).toBe(2048);
    expect(calls[0]!.messages.map((m) => (m as { content: string }).content)).toHaveLength(4);
    expect((calls[0]!.messages[0] as { content: string }).content.startsWith("问题一")).toBe(true);
    expect((calls[0]!.messages[3] as { content: string }).content.startsWith("回答二")).toBe(true);
    expect(calls[0]!.system).toContain("压缩器");
  });

  it("已摘要内容不再折叠（防失真）：仅折叠未摘要段", async () => {
    const { provider, calls } = makeProvider("新摘要");
    const p = makePolicy(provider);
    const runs = [
      makeRun(1, [{ role: "user", content: "开篇意图" }]),
      makeRun(2, [
        {
          role: "user",
          content: "<context-summary>\n旧摘要\n" + "旧".repeat(2000) + "\n</context-summary>",
        },
      ]),
      makeRun(3, [
        { role: "user", content: "新鲜问题" + "新".repeat(2000) },
        { role: "assistant", content: "新鲜回答" },
      ]),
      makeRun(4, [{ role: "user", content: "尾1" }]),
      makeRun(5, [{ role: "user", content: "尾2" }]),
      makeRun(6, [{ role: "user", content: "尾3" }]),
    ];
    const loop = makeLoop(runs, { inputTokens: 8000 });
    await p.compact(loop);
    // 只折叠了 run3；旧摘要 run2 原样保留
    const contents = loop.runs.map((r) => (r.messages[0] as { content: string }).content);
    expect(contents.some((c) => c.includes("旧摘要"))).toBe(true);
    expect(contents.some((c) => c.startsWith("新鲜问题"))).toBe(false);
    expect(calls[0]!.messages).toHaveLength(2);
  });

  it("超 T2 线且压缩区含大块冗余：T1 先骨架化，摘要请求收到的是骨架消息", async () => {
    const { provider, calls } = makeProvider("组合摘要");
    const p = makePolicy(provider);
    const runs = [
      makeRun(1, [{ role: "user", content: "开篇意图" }]),
      makeRun(2, [
        { role: "user", content: "问题" + "一".repeat(6500) },
        {
          role: "assistant",
          content: "查询",
          toolCalls: [{ id: "f1", name: "ReadFile", args: '{"path":"a.md"}' }],
        },
        { role: "tool", content: "文".repeat(900), id: "f1" },
      ]),
      makeRun(3, [{ role: "user", content: "问题二" }]),
      makeRun(4, [{ role: "user", content: "尾1" }]),
      makeRun(5, [{ role: "user", content: "尾2" }]),
      makeRun(6, [{ role: "user", content: "尾3" }]),
    ];
    const loop = makeLoop(runs, { inputTokens: 8800 });
    await p.compact(loop);
    expect(calls).toHaveLength(1);
    const folded = calls[0]!.messages.map((m) => (m as { content: string }).content);
    // 摘要请求中的工具结果已是占位（T1 先于 T2 生效），不含原文大块
    expect(folded.some((c) => c.includes("工具结果已省略"))).toBe(true);
    expect(folded.some((c) => c.includes("文文文"))).toBe(false);
    // 折叠后 runList：首 run + 摘要 + 尾 3
    expect(loop.runs).toHaveLength(5);
  });

  it("摘要失败 → 降级占位但折叠照常发生", async () => {
    const { provider } = makeProvider("不会到达", { fail: true });
    const p = makePolicy(provider);
    const loop = makeLoop(t2Runs(), { inputTokens: 8000 });
    expect(await p.compact(loop)).toBe(true);
    const text = (loop.runs[1]!.messages[0] as { content: string }).content;
    expect(text).toContain("<context-summary>");
    expect(text).toContain("摘要生成失败");
  });

  it("段预算：每次只折到预算即止（逐段）", async () => {
    const { provider, calls } = makeProvider("段摘要");
    const p = makePolicy(provider, { summarySegmentTokens: 100 }); // ~200 字符即满段
    const runs = [
      makeRun(1, [{ role: "user", content: "开篇意图" }]),
      makeRun(2, [{ role: "user", content: "一".repeat(1200) }]),
      makeRun(3, [{ role: "user", content: "二".repeat(1200) }]),
      makeRun(4, [{ role: "user", content: "尾1" }]),
      makeRun(5, [{ role: "user", content: "尾2" }]),
      makeRun(6, [{ role: "user", content: "尾3" }]),
    ];
    const loop = makeLoop(runs, { inputTokens: 8000 });
    await p.compact(loop);
    // 常规模式一次一段：只折了 run2，run3 保留
    expect(calls).toHaveLength(1);
    const contents = loop.runs.map((r) => (r.messages[0] as { content: string }).content);
    expect(contents.some((c) => c.startsWith("二"))).toBe(true);
  });

  it("force 模式（保险丝）：连续折叠多段直到低于 T2 线", async () => {
    const { provider, calls } = makeProvider("段摘要");
    const p = makePolicy(provider, { summarySegmentTokens: 100 });
    const runs = [
      makeRun(1, [{ role: "user", content: "首".repeat(8000) }]), // 首部占大头：折叠后 est 仍高
      makeRun(2, [{ role: "user", content: "一".repeat(1200) }]),
      makeRun(3, [{ role: "user", content: "二".repeat(1200) }]),
      makeRun(4, [{ role: "user", content: "三".repeat(1200) }]),
      makeRun(5, [{ role: "user", content: "尾1" }]),
      makeRun(6, [{ role: "user", content: "尾2" }]),
      makeRun(7, [{ role: "user", content: "尾3" }]),
    ];
    const loop = makeLoop(runs, { inputTokens: 9800 });
    await p.compact(loop, { force: true });
    // 三个段 run 全部折叠（est 比例下降但仍高于 t2 时继续）
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const folded = loop.runs.filter((r) =>
      r.messages.some((m) => m.content.includes("<context-summary>")),
    );
    expect(folded.length).toBe(calls.length);
    // 首 run 与尾 3 run 完好
    expect((loop.runs[0]!.messages[0] as { content: string }).content.startsWith("首")).toBe(true);
    expect(loop.runs.slice(-3).map((r) => r.seq)).toEqual([5, 6, 7]);
  });
});

// ── T3 硬丢弃 ──

describe("AutoCompactPolicy T3 硬丢弃", () => {
  it("危险线：从最老开始丢（含旧摘要 run），首 run 最后丢", async () => {
    const { provider } = makeProvider("s");
    const p = makePolicy(provider);
    const runs = [
      makeRun(1, [{ role: "user", content: "首".repeat(200) }]),
      makeRun(2, [{ role: "user", content: "<context-summary>\n旧摘要一" + "一".repeat(2000) + "\n</context-summary>" }]),
      makeRun(3, [{ role: "user", content: "<context-summary>\n旧摘要二" + "二".repeat(2000) + "\n</context-summary>" }]),
      makeRun(4, [{ role: "user", content: "尾1" }]),
      makeRun(5, [{ role: "user", content: "尾2" }]),
      makeRun(6, [{ role: "user", content: "尾3" }]),
    ];
    const loop = makeLoop(runs, { inputTokens: 9600 }); // ≥t3(9000)；zone 全摘要 → T2 无段可折
    expect(await p.compact(loop)).toBe(true);
    const seqs = loop.runs.map((r) => r.seq);
    // 最老的摘要 run2 被丢弃；首 run、run3、尾3 保留
    expect(seqs).toEqual([1, 3, 4, 5, 6]);
  });

  it("危险线连续丢弃：一次丢不够时逐 run 继续直到低于线", async () => {
    const { provider } = makeProvider("s");
    const p = makePolicy(provider);
    const runs = [
      makeRun(1, [{ role: "user", content: "首".repeat(1000) }]),
      makeRun(2, [{ role: "user", content: "<context-summary>\n摘要甲" + "甲".repeat(550) + "\n</context-summary>" }]),
      makeRun(3, [{ role: "user", content: "<context-summary>\n摘要乙" + "乙".repeat(3000) + "\n</context-summary>" }]),
      makeRun(4, [{ role: "user", content: "<context-summary>\n摘要丙" + "丙".repeat(3000) + "\n</context-summary>" }]),
      makeRun(5, [{ role: "user", content: "尾1" }]),
      makeRun(6, [{ role: "user", content: "尾2" }]),
      makeRun(7, [{ role: "user", content: "尾3" }]),
    ];
    const loop = makeLoop(runs, { inputTokens: 9800 }); // t3=9000
    expect(await p.compact(loop)).toBe(true);
    // 丢 run2（小）后 est 仍 ≥9000 → 继续丢 run3；低于线即停
    const seqs = loop.runs.map((r) => r.seq);
    expect(seqs).toEqual([1, 4, 5, 6, 7]);
  });
});

describe("stripNudgeMessages（T2 摘要输入过滤）", () => {
  it("带 nudge 标记的 system 被滤除；无标记 system 与其他角色保留", () => {
    const messages = [
      { role: "system", content: "【项目状态】…", nudge: "project_stage_sparse" },
      { role: "user", content: "你好" },
      { role: "system", content: "# 设计模式（Compose Mode）" },
      { role: "system", content: "工作流全文", nudge: "project_stage_full" },
      { role: "assistant", content: "ok" },
    ] as RunContext["messages"];
    const kept = stripNudgeMessages(messages);
    expect(kept.map((m) => m.content)).toEqual([
      "你好",
      "# 设计模式（Compose Mode）",
      "ok",
    ]);
  });
});
