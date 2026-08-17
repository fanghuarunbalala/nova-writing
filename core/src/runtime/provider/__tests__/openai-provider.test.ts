import { describe, it, expect, vi, beforeEach } from "vitest";
import OpenAI from "openai";
import { OpenAIProvider } from "../adapters/OpenAIProvider.js";
import { ModelInfoRegistry } from "../model-info.js";
import type { ProviderCall, ProviderDelta } from "../types.js";

// mock SDK：保留真实导出（错误类等），仅替换 default 构造返回 mock client 的 create
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openai")>();
  const mockConstructor = vi.fn().mockImplementation(
    class {
      chat = { completions: { create: createMock } };
    },
  );
  // 继承真实 default 的静态成员（RateLimitError / APIConnectionError 等），供测试构造原生错误类
  Object.setPrototypeOf(mockConstructor, actual.default);
  return { ...actual, default: mockConstructor };
});

const config = { id: "default", type: "openai" as const, model: "gpt-5", timeoutMs: 60000 };

function makeCall(overrides: Partial<ProviderCall> = {}): ProviderCall {
  return {
    system: "你是小说创作助手",
    messages: [{ role: "user", content: "写一段开头" }],
    sampling: { model: "gpt-5", maxTokens: 1024 },
    ...overrides,
  };
}

/** 原生 ChatCompletionChunk（结构对齐 openai SDK 类型） */
function chunk(
  choice: { delta?: Record<string, unknown>; finish_reason?: string | null },
  usage?: { prompt_tokens: number; completion_tokens: number },
): unknown {
  return {
    id: "chatcmpl_01",
    object: "chat.completion.chunk",
    created: 0,
    model: "gpt-5",
    choices: [{ index: 0, delta: {}, finish_reason: null, ...choice }],
    ...(usage ? { usage } : {}),
  };
}

/** 把假流挂到 mock：chunks 为原生 chunk 序列（create 返回可 await 的 async iterable） */
function mockStream(chunks: unknown[]): void {
  createMock.mockReturnValue({
    [Symbol.asyncIterator]() {
      return chunks[Symbol.iterator]();
    },
  });
}

/** 模拟上游请求失败：迭代时抛原始错误 */
function mockStreamError(err: unknown): void {
  createMock.mockReturnValue({
    [Symbol.asyncIterator]: async function* () {
      throw err;
    },
  });
}

describe("OpenAIProvider", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("onDelta 正常回调：text-delta 按序产出，结果累积正确", async () => {
    const provider = new OpenAIProvider(config);
    mockStream([
      chunk({ delta: { role: "assistant", content: "你好" } }),
      chunk({ delta: { content: "，世界" } }),
      chunk({ delta: {}, finish_reason: "stop" }, { prompt_tokens: 10, completion_tokens: 5 }),
    ]);
    const deltas: ProviderDelta[] = [];
    const result = await provider.call(makeCall(), (d) => deltas.push(d));

    expect(deltas).toEqual([
      { type: "text-delta", text: "你好" },
      { type: "text-delta", text: "，世界" },
    ]);
    expect(result.finishReason).toBe("stop");
    expect(result.message).toEqual({ role: "assistant", content: "你好，世界" });
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it("reasoning_content（厂商扩展字段）→ reasoning-delta", async () => {
    const provider = new OpenAIProvider(config);
    mockStream([
      chunk({ delta: { reasoning_content: "思考中" } }),
      chunk({ delta: { content: "答案" } }),
      chunk({ delta: {}, finish_reason: "stop" }),
    ]);
    const deltas: ProviderDelta[] = [];
    await provider.call(makeCall(), (d) => deltas.push(d));
    expect(deltas).toEqual([
      { type: "reasoning-delta", text: "思考中" },
      { type: "text-delta", text: "答案" },
    ]);
  });

  it("tool_calls 流式累积 → finishReason tool_call + toolCalls（参数拼接）", async () => {
    const provider = new OpenAIProvider(config);
    mockStream([
      chunk({
        delta: {
          tool_calls: [
            { index: 0, id: "call_01", type: "function", function: { name: "read_outline", arguments: "" } },
          ],
        },
      }),
      chunk({ delta: { tool_calls: [{ index: 0, function: { arguments: '{"chapter"' } }] } }),
      chunk({ delta: { tool_calls: [{ index: 0, function: { arguments: ":3}" } }] } }),
      chunk({ delta: {}, finish_reason: "tool_calls" }),
    ]);
    const result = await provider.call(makeCall());
    expect(result.finishReason).toBe("tool_call");
    expect(result.message.toolCalls).toEqual([
      { id: "call_01", name: "read_outline", args: '{"chapter":3}' },
    ]);
  });

  it("finish_reason length → finishReason length", async () => {
    const provider = new OpenAIProvider(config);
    mockStream([chunk({ delta: { content: "被截断" } }), chunk({ delta: {}, finish_reason: "length" })]);
    const result = await provider.call(makeCall());
    expect(result.finishReason).toBe("length");
  });

  it("真实 RateLimitError(429) → ProviderRateLimitedError，可重试", async () => {
    const provider = new OpenAIProvider(config);
    mockStreamError(
      new OpenAI.RateLimitError(429, { type: "rate_limit_error" }, "Rate limited", new Headers()),
    );
    await expect(provider.call(makeCall())).rejects.toMatchObject({
      name: "ProviderRateLimitedError",
      retryable: true,
      provider: "openai",
    });
  });

  it("真实 AuthenticationError(401) → ProviderAuthError，不可重试", async () => {
    const provider = new OpenAIProvider(config);
    mockStreamError(
      new OpenAI.AuthenticationError(401, { type: "authentication_error" }, "Invalid key", new Headers()),
    );
    await expect(provider.call(makeCall())).rejects.toMatchObject({
      name: "ProviderAuthError",
      retryable: false,
    });
  });

  it("真实 APIConnectionError → ProviderNetworkError，可重试", async () => {
    const provider = new OpenAIProvider(config);
    mockStreamError(new OpenAI.APIConnectionError({ message: "fetch failed" }));
    await expect(provider.call(makeCall())).rejects.toMatchObject({
      name: "ProviderNetworkError",
      retryable: true,
    });
  });

  it("signal 已 abort → ProviderAbortedError，不可重试", async () => {
    const provider = new OpenAIProvider(config);
    const controller = new AbortController();
    controller.abort();
    await expect(provider.call(makeCall({ signal: controller.signal }))).rejects.toMatchObject({
      name: "ProviderAbortedError",
      retryable: false,
    });
  });

  it("thinking 档位收敛（deepseek medium → reasoning_effort high）", async () => {
    const provider = new OpenAIProvider(config);
    mockStream([chunk({ delta: { content: "ok" } }), chunk({ delta: {}, finish_reason: "stop" })]);
    await provider.call(
      makeCall({ sampling: { model: "deepseek-v4-flash", maxTokens: 1024, thinking: "medium" } }),
    );
    const params = createMock.mock.calls[0]?.[0] as { reasoning_effort?: string };
    expect(params.reasoning_effort).toBe("high"); // medium 收敛到 deepseek 支持的档位
  });

  it("消息转译：system 提示词并入 system 消息，流内 SystemMessage 转 user + system-reminder 包裹，tool 结果带 tool_call_id", async () => {
    const provider = new OpenAIProvider(config);
    mockStream([chunk({ delta: { content: "ok" } }), chunk({ delta: {}, finish_reason: "stop" })]);
    await provider.call({
      system: "全局提示",
      messages: [
        { role: "system", content: "提醒1" },
        { role: "user", content: "你好" },
        {
          role: "assistant",
          content: "查一下",
          toolCalls: [{ id: "call_x", name: "read_outline", args: '{"chapter":3}' }],
        },
        { role: "tool", content: "结果", id: "call_x" },
      ],
      sampling: { model: "gpt-5" },
    });
    const params = createMock.mock.calls[0]?.[0] as { messages: unknown[] };
    expect(params.messages).toEqual([
      { role: "system", content: "全局提示" },
      { role: "user", content: "<system-reminder>\n提醒1\n</system-reminder>" },
      { role: "user", content: "你好" },
      {
        role: "assistant",
        content: "查一下",
        tool_calls: [
          { id: "call_x", type: "function", function: { name: "read_outline", arguments: '{"chapter":3}' } },
        ],
      },
      { role: "tool", tool_call_id: "call_x", content: "结果" },
    ]);
  });

  it("工具转译：ToolScheme → function tool", async () => {
    const provider = new OpenAIProvider(config);
    mockStream([chunk({ delta: { content: "ok" } }), chunk({ delta: {}, finish_reason: "stop" })]);
    await provider.call(
      makeCall({
        tools: [
          {
            name: "read_outline",
            description: "读大纲",
            parameters: { type: "object", properties: { chapter: { type: "number" } } },
          },
        ],
      }),
    );
    const params = createMock.mock.calls[0]?.[0] as { tools: unknown[] };
    expect(params.tools).toEqual([
      {
        type: "function",
        function: {
          name: "read_outline",
          description: "读大纲",
          parameters: { type: "object", properties: { chapter: { type: "number" } } },
        },
      },
    ]);
  });

  it("采样参数：maxTokens 与 temperature 透传", async () => {
    const provider = new OpenAIProvider(config);
    mockStream([chunk({ delta: { content: "ok" } }), chunk({ delta: {}, finish_reason: "stop" })]);
    await provider.call(makeCall({ sampling: { model: "gpt-5", maxTokens: 2048, temperature: 0.7 } }));
    const params = createMock.mock.calls[0]?.[0] as {
      max_completion_tokens?: number;
      temperature?: number;
    };
    expect(params.max_completion_tokens).toBe(2048);
    expect(params.temperature).toBe(0.7);
  });

  it("thinking reasoning 档位透传（gpt-5 支持五档）", async () => {
    const provider = new OpenAIProvider(config);
    mockStream([chunk({ delta: { content: "ok" } }), chunk({ delta: {}, finish_reason: "stop" })]);
    await provider.call(makeCall({ sampling: { model: "gpt-5", thinking: "high" } }));
    const params = createMock.mock.calls[0]?.[0] as { reasoning_effort?: string };
    expect(params.reasoning_effort).toBe("high");
  });

  it("thinking off → reasoning_effort none", async () => {
    const provider = new OpenAIProvider(config);
    mockStream([chunk({ delta: { content: "ok" } }), chunk({ delta: {}, finish_reason: "stop" })]);
    await provider.call(makeCall({ sampling: { model: "gpt-5", thinking: "off" } }));
    const params = createMock.mock.calls[0]?.[0] as { reasoning_effort?: string };
    expect(params.reasoning_effort).toBe("none");
  });
});
