import { describe, it, expect, vi, beforeEach } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicProvider } from "../adapters/AnthropicProvider.js";
import { ModelInfoRegistry } from "../model-info.js";
import type { ProviderCall, ProviderDelta } from "../types.js";

// mock SDK：保留真实导出（错误类等），仅替换 default 构造返回 mock client 的 messages.stream
const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  const mockConstructor = vi.fn().mockImplementation(
    class {
      messages = { stream: streamMock };
    },
  );
  // 继承真实 default 的静态成员（RateLimitError / APIConnectionError / LLMessage 等），供测试构造原生错误类
  Object.setPrototypeOf(mockConstructor, actual.default);
  return { ...actual, default: mockConstructor };
});

const config = { id: "default", type: "anthropic" as const, model: "claude-opus-5", timeoutMs: 60000 };

function makeCall(overrides: Partial<ProviderCall> = {}): ProviderCall {
  return {
    system: "你是小说创作助手",
    messages: [{ role: "user", content: "写一段开头" }],
    sampling: { model: "claude-opus-5", maxTokens: 1024 },
    ...overrides,
  };
}

/** 原生 LLMessage：thinking + text 两块，end_turn（结构对齐 SDK 类型） */
const textFinal: Anthropic.Message = {
  id: "msg_01abc",
  type: "message",
  role: "assistant",
  model: "claude-opus-5",
  content: [
    { type: "thinking", thinking: "思考中" },
    { type: "text", text: "你好，世界", citations: null },
  ],
  stop_reason: "end_turn",
  stop_sequence: null,
  stop_details: null,
  container: null,
  usage: { input_tokens: 10, output_tokens: 5 },
};

/** 原生 SSE 事件序列：一次完整流式响应（thinking 块 + text 块 + 结束） */
const streamEvents: unknown[] = [
  { type: "message_start", message: textFinal },
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "思考中" } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "text", text: "", citations: null } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "你好" } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "，世界" } },
  { type: "content_block_stop", index: 1 },
  {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null, stop_details: null, container: null },
    usage: { input_tokens: 10, output_tokens: 5 },
  },
  { type: "message_stop" },
];

/** 把假流挂到 mock：events 为原生事件序列，finalMessage 为原生 LLMessage */
function mockStream(events: unknown[], finalMessage: object): void {
  streamMock.mockReturnValue({
    [Symbol.asyncIterator]() {
      return events[Symbol.iterator]();
    },
    finalMessage: vi.fn().mockResolvedValue(finalMessage),
  });
}

/** 模拟上游请求失败：流式迭代时抛原始错误（贴近 SDK 请求失败的 MessageStream 行为） */
function mockStreamError(err: unknown): void {
  streamMock.mockReturnValue({
    [Symbol.asyncIterator]: async function* () {
      throw err;
    },
    finalMessage: vi.fn(),
  });
}

describe("AnthropicProvider", () => {
  beforeEach(() => {
    streamMock.mockReset();
  });

  it("onDelta 正常回调：reasoning-delta 与 text-delta 按序产出，结果累积正确", async () => {
    const provider = new AnthropicProvider(config);
    mockStream(streamEvents, textFinal);
    const deltas: ProviderDelta[] = [];
    const result = await provider.call(makeCall(), (d) => deltas.push(d));

    expect(deltas).toEqual([
      { type: "reasoning-delta", text: "思考中" },
      { type: "text-delta", text: "你好" },
      { type: "text-delta", text: "，世界" },
    ]);
    expect(result.finishReason).toBe("stop");
    expect(result.message).toEqual({ role: "assistant", content: "你好，世界" });
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it("tool_use → finishReason tool_call，toolCalls 参数为 JSON 字符串", async () => {
    const final: Anthropic.Message = {
      ...textFinal,
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "查一下", citations: null },
        { type: "tool_use", id: "toolu_01", name: "read_outline", input: { chapter: 3 }, caller: { type: "direct" } },
      ],
    };
    const provider = new AnthropicProvider(config);
    mockStream([], final);

    const result = await provider.call(makeCall());
    expect(result.finishReason).toBe("tool_call");
    expect(result.message.toolCalls).toEqual([
      { id: "toolu_01", name: "read_outline", args: '{"chapter":3}' },
    ]);
  });

  it("max_tokens → finishReason length", async () => {
    const provider = new AnthropicProvider(config);
    mockStream([], { ...textFinal, stop_reason: "max_tokens" });
    const result = await provider.call(makeCall());
    expect(result.finishReason).toBe("length");
  });

  it("refusal → 抛 ProviderError（走异常通道）", async () => {
    const provider = new AnthropicProvider(config);
    mockStream([], { ...textFinal, stop_reason: "refusal" });
    await expect(provider.call(makeCall())).rejects.toMatchObject({
      name: "ProviderUnknownError",
      retryable: false,
      provider: "anthropic",
    });
  });

  it("真实 RateLimitError(429) → ProviderError rate-limit，可重试", async () => {
    const provider = new AnthropicProvider(config);
    mockStreamError(
      new Anthropic.RateLimitError(429, { type: "rate_limit_error" }, "Rate limited", new Headers()),
    );
    await expect(provider.call(makeCall())).rejects.toMatchObject({
      name: "ProviderRateLimitedError",
      retryable: true,
      provider: "anthropic",
    });
  });

  it("真实 AuthenticationError(401) → auth-error，不可重试", async () => {
    const provider = new AnthropicProvider(config);
    mockStreamError(
      new Anthropic.AuthenticationError(401, { type: "authentication_error" }, "Invalid key", new Headers()),
    );
    await expect(provider.call(makeCall())).rejects.toMatchObject({
      name: "ProviderAuthError",
      retryable: false,
    });
  });

  it("真实 APIConnectionError → network-error，可重试", async () => {
    const provider = new AnthropicProvider(config);
    mockStreamError(new Anthropic.APIConnectionError({ message: "fetch failed" }));
    await expect(provider.call(makeCall())).rejects.toMatchObject({
      name: "ProviderNetworkError",
      retryable: true,
    });
  });

  it("signal 已 abort → ProviderError aborted，不可重试", async () => {
    const provider = new AnthropicProvider(config);
    const controller = new AbortController();
    controller.abort();
    await expect(provider.call(makeCall({ signal: controller.signal }))).rejects.toMatchObject({
      name: "ProviderAbortedError",
      retryable: false,
    });
  });

  it("消息转译：流内 system → user + system-reminder 包裹，静态 system 留在顶层", async () => {
    const provider = new AnthropicProvider(config);
    mockStream([], textFinal);
    await provider.call(
      makeCall({
        messages: [
          { role: "system", content: "提醒1" },
          { role: "user", content: "你好" },
        ],
      }),
    );
    const params = streamMock.mock.calls[0]?.[0] as { system?: unknown; messages?: unknown[] };
    expect(params.system).toBe("你是小说创作助手");
    expect(params.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "<system-reminder>\n提醒1\n</system-reminder>" }] },
      { role: "user", content: [{ type: "text", text: "你好" }] },
    ]);
  });

  it("thinking 档位经 ModelInfoRegistry 收敛（medium → 厂商支持的 high）", async () => {
    const registry = new ModelInfoRegistry();
    registry.register("claude-opus-5", {
      model: "claude-opus-5",
      supportsTemperature: false,
      thinkingMode: "adaptive-effort",
      effortLevels: ["low", "high", "max"],
    });
    const provider = new AnthropicProvider(config, registry);
    mockStream([], textFinal);

    await provider.call(makeCall({ sampling: { model: "claude-opus-5", maxTokens: 1024, thinking: "medium" } }));
    const params = streamMock.mock.calls[0]?.[0] as {
      thinking?: unknown;
      output_config?: { effort?: string };
    };
    expect(params.output_config).toEqual({ effort: "high" });
    expect(params.thinking).toEqual({ type: "adaptive", display: "summarized" });
  });
});
