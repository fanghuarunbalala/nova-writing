/**
 * 真实环境压缩测试：本地 SSE 服务器 + 真实 OpenAIProvider（openai SDK 完整网络栈）。
 * 不 mock 策略与适配器——T2 摘要请求经真实 SDK 发出、服务器按 OpenAI 流式协议回包，
 * 校验请求线格式（system/messages/采样参数）与摘要文本回填链路。
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { OpenAIProvider } from "../../provider/adapters/OpenAIProvider.js";
import { AutoCompactPolicy } from "../definitions/auto-compact.js";
import { AgentLoop } from "../../loop/AgentLoop.js";
import type { AgentCapability } from "../../agent/AgentCapability.js";
import type { ToolDispatcher } from "../../tool/ToolDispatcher.js";
import type { LoopEvent, LoopContextListener, RunContext } from "../../loop/types.js";
import type { LoopContext } from "../../loop/LoopContext.js";
import type { LLMessage, ProviderCall } from "../../provider/types.js";

/** 服务器捕获的一次请求（URL + 解析后的 JSON body） */
interface CapturedRequest {
  url: string;
  body: Record<string, unknown> & {
    messages?: { role: string; content: string | null }[];
  };
}

/** 单个 SSE 回包脚本：文本 + 可选用量（usage 挂在含 choice 的末 chunk 上） */
interface ScriptedResponse {
  text: string;
  inputTokens?: number;
}

/** OpenAI 流式 chunk（结构对齐 SDK 解析预期；usage 需伴随 choice 出现才会被适配器累计） */
function chunkJson(
  delta: Record<string, unknown>,
  finishReason: string | null,
  usage?: { prompt_tokens: number; completion_tokens: number },
): string {
  return JSON.stringify({
    id: "chatcmpl_test",
    object: "chat.completion.chunk",
    created: 0,
    model: "gpt-5",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  });
}

/** 文本拆两段 delta 模拟流式 + finish chunk（可带 usage） */
function sseLines(r: ScriptedResponse): string[] {
  const mid = Math.ceil(r.text.length / 2);
  const lines = [chunkJson({ role: "assistant", content: r.text.slice(0, mid) }, null)];
  if (r.text.length > mid) lines.push(chunkJson({ content: r.text.slice(mid) }, null));
  lines.push(chunkJson({}, "stop", { prompt_tokens: r.inputTokens ?? 100, completion_tokens: 5 }));
  return lines;
}

/** 本地 OpenAI 兼容 SSE 服务器：POST /v1/chat/completions 按队列回包并捕获请求体 */
function startSseServer() {
  const requests: CapturedRequest[] = [];
  const queue: ScriptedResponse[] = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      requests.push({
        url: req.url ?? "",
        body: raw.length > 0 ? (JSON.parse(raw) as CapturedRequest["body"]) : {},
      });
      const scripted = queue.shift() ?? { text: "ok" };
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const line of sseLines(scripted)) res.write(`data: ${line}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  return {
    requests,
    push: (r: ScriptedResponse) => queue.push(r),
    server,
  };
}

describe("AutoCompactPolicy × 真实 OpenAIProvider（本地 SSE 服务器）", () => {
  let srv: ReturnType<typeof startSseServer>;
  let provider: OpenAIProvider;

  beforeAll(async () => {
    srv = startSseServer();
    await new Promise<void>((resolve) => srv.server.listen(0, "127.0.0.1", resolve));
    const port = (srv.server.address() as AddressInfo).port;
    provider = new OpenAIProvider({
      id: "test",
      type: "openai",
      apiKey: "test-key",
      baseUrl: `http://127.0.0.1:${port}/v1`,
      timeoutMs: 10_000,
    });
  });

  afterAll(async () => {
    srv.server.closeAllConnections?.();
    await new Promise<void>((resolve) => srv.server.close(() => resolve()));
  });

  function makeRuns(): RunContext[] {
    const mk = (seq: number, messages: LLMessage[]): RunContext => {
      const arr = [...messages];
      return {
        seq,
        messages: arr,
        ts: "2026-08-16T00:00:00.000Z",
        appendRunMessages: (m) => {
          arr.push(...m);
        },
      };
    };
    return [
      mk(1, [{ role: "user", content: "开篇意图" }]),
      mk(2, [
        { role: "user", content: "第二轮：" + "主角林晚在雨夜的城市里追踪线索。".repeat(90) }, // ≥1000 字符（过最小折叠段）
        { role: "assistant", content: "收到" },
      ]),
      mk(3, [{ role: "user", content: "问题三" }]),
      mk(4, [{ role: "user", content: "尾1" }]),
      mk(5, [{ role: "user", content: "尾2" }]),
      mk(6, [{ role: "user", content: "尾3" }]),
    ];
  }

  it("T2 摘要经真实 SDK 网络栈发出：线格式正确、流式摘要文本回填摘要 run", async () => {
    srv.push({ text: "（摘要）前两轮确立了主角林晚与雨夜城市的基调，并埋下信物伏笔。", inputTokens: 1200 });
    const policy = new AutoCompactPolicy(provider, {
      windowTokensOf: () => 10_000,
      t2MarginTokens: 500,
    });
    const runs = makeRuns();
    // 信号：est = 8000 ≥ t2(7500)（window 10000 / maxOutput 2000 / 余量 500）
    const last = runs[runs.length - 1]!;
    last.lastInputTokens = 8000;
    last.signalChars = runs.reduce((acc, r) => acc + r.messages.reduce((a, m) => a + m.content.length, 0), 0);
    last.model = "gpt-5";
    last.maxOutputTokens = 2000;
    let seq = 6;
    const loop = {
      runs,
      allocateSeq: () => ++seq,
    } as unknown as LoopContext;

    const changed = await policy.compact(loop);
    expect(changed).toBe(true);

    // 服务器恰好收到一次请求（摘要调用）
    expect(srv.requests).toHaveLength(1);
    const body = srv.requests[0]!.body;
    expect(srv.requests[0]!.url).toBe("/v1/chat/completions");
    expect(body.stream).toBe(true);
    expect(body.model).toBe("gpt-5");
    expect(body.max_completion_tokens).toBe(2048);
    expect(body.reasoning_effort).toBe("none"); // thinking off
    expect(body.tools).toBeUndefined();
    // system 经适配器并入首条 system 消息（OpenAI 线格式）；折叠段消息原样上线
    // （压缩区 = run2 + run3，均未达段预算 → 一起折叠）
    expect(body.messages).toHaveLength(4);
    expect(body.messages![0]!.role).toBe("system");
    expect(body.messages![0]!.content).toContain("压缩器");
    expect(body.messages![1]!.content).toContain("主角林晚在雨夜的城市里追踪线索");
    expect(body.messages![3]!.content).toContain("问题三");

    // 摘要 run：真实流式回包文本拼接回填
    const summary = runs[1]!;
    expect(runs).toHaveLength(5);
    expect((summary.messages[0] as { role: string; content: string }).role).toBe("user");
    const text = (summary.messages[0] as { content: string }).content;
    expect(text).toContain("<context-summary>");
    expect(text).toContain("第 2–3 轮");
    expect(text).toContain("主角林晚与雨夜城市的基调");
    expect(text).toContain("</context-summary>");
  });

  it("全链路（AgentLoop × 真实 provider × 策略）：第五轮触发折叠，主调用携带摘要上线", async () => {
    // 五轮主调用 + 一次摘要调用的回包脚本（按请求顺序消费）
    srv.push({ text: "好的，主角定为林晚。", inputTokens: 6000 }); // run1
    srv.push({ text: "收到。", inputTokens: 6500 }); // run2
    srv.push({ text: "继续。", inputTokens: 7200 }); // run3
    srv.push({ text: "明白。", inputTokens: 8000 }); // run4（信号过 T2 线）
    srv.push({ text: "（摘要）讨论了主角设定与雨夜基调，信物伏笔待回收。", inputTokens: 900 }); // run5 组装期摘要
    srv.push({ text: "第五章完成。", inputTokens: 6000 }); // run5 主调用

    const policy = new AutoCompactPolicy(provider, {
      windowTokensOf: () => 10_000,
      t2MarginTokens: 500,
    });
    const capability: AgentCapability = {
      systemSections: [
        { kind: "static", id: "base.one", version: "1.0.0", label: "Base", render: () => "你是小说创作助手" },
      ],
      toolDefs: [],
      compactPolicies: [policy],
      nudgePolicies: [],
    };
    const dispatcher: ToolDispatcher = {
      dispatch: async (_ctx, call) => `result:${call.name}`,
      resolve: () => undefined,
    };
    // journal 模拟：onCompacted → writeRuns（快照重写）
    const journalSnapshots: number[] = [];
    const journalListener: LoopContextListener = {
      onCompacted: (runs) => journalSnapshots.push(runs.length),
    };
    const loop = new AgentLoop({
      workspace: "/ws",
      provider,
      agentCapability: capability,
      toolDispatcher: dispatcher,
      listeners: [journalListener],
    });
    const events: LoopEvent[] = [];
    loop.onOutputEvent((e) => events.push(e));

    const longTurn =
      "第二轮讨论：" + "林晚在雨夜的城市里追踪信物线索，与旧友重逢。".repeat(60); // ≥1000 字符（过最小折叠段）
    const sampling = { model: "gpt-5", maxTokens: 2000 }; // t2 = 10000−2000−500 = 7500
    await loop.run("第一轮：确立主角", { sampling });
    await loop.run(longTurn, { sampling });
    await loop.run("第三轮：推进情节", { sampling });
    await loop.run("第四轮：埋伏笔", { sampling });
    const result = await loop.run("第五轮：收束", { sampling });
    expect(result.final.content).toBe("第五章完成。");

    // 请求总数：4 轮主调用（run5 前各一）+ run5 组装期摘要 + run5 主调用 = 6
    const start = srv.requests.length - 6;
    const bodies = srv.requests.slice(start).map((r) => r.body);
    expect(bodies).toHaveLength(6);

    // 第 5 个请求 = 摘要（首条 system 消息为压缩器 prompt，其后为被折叠段）
    expect(bodies[4]!.messages).toHaveLength(3); // system + run2 两条
    expect(bodies[4]!.messages![0]!.role).toBe("system");
    expect(bodies[4]!.messages![0]!.content).toContain("压缩器");
    expect(bodies[4]!.messages![1]!.content).toContain("林晚在雨夜的城市里追踪信物线索");

    // 第 6 个请求（run5 主调用）：携带摘要标记、不再含被折叠的原文长文
    const mainMessages = bodies[5]!.messages!;
    const joined = mainMessages.map((m) => m.content ?? "").join("\n");
    expect(joined).toContain("<context-summary>");
    expect(joined).toContain("信物伏笔待回收");
    expect(joined).not.toContain("林晚在雨夜的城市里追踪信物线索，与旧友重逢。"); // 原文已折叠
    // 首轮意图与近三轮原文仍在
    expect(joined).toContain("第一轮：确立主角");
    expect(joined).toContain("第四轮：埋伏笔");
    expect(joined).toContain("第五轮：收束");

    // compacted 边界事件恰好一次；journal writeRuns 被触发（快照 5 个 run）
    const compacted = events.filter((e) => e.type === "compacted");
    expect(compacted).toHaveLength(1);
    expect((compacted[0] as { persist?: boolean }).persist).toBe(true);
    expect(journalSnapshots).toEqual([5]);

    // 压缩后的 runList：[首run][摘要(seq6)][r3][r4][r5]
    const seqs = (loop as unknown as { context: { runs: { seq: number }[] } }).context.runs.map((r) => r.seq);
    expect(seqs).toEqual([1, 6, 3, 4, 5]);
  }, 30_000);
});
