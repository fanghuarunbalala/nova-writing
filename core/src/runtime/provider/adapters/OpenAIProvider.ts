import OpenAI from "openai";
import type {
  ProviderCall,
  ProviderResult,
  ProviderDelta,
  LLMessage,
  ToolScheme,
} from "../types.js";
import { BaseProvider } from "../BaseProvider.js";
import type { ThinkingParam } from "../model-info.js";
import { wrapSystemReminder } from "../systemReminder.js";

/** 流式累积状态（createStream 迭代填充，buildResult 读取；实例串行使用约定） */
interface Accumulator {
  /** 文本内容累积 */
  content: string;
  /** 工具调用累积（key: tool_call index，流式参数按 index 拼接） */
  toolCalls: Map<number, { id?: string; name: string; args: string }>;
  /** 结束原因（最后一个 chunk 携带） */
  finishReason?: string;
  /** token 用量（最后一个 chunk 携带） */
  usage?: { input_tokens: number; output_tokens: number };
}

/** OpenAI 适配器实现（基于 openai SDK，兼容 deepseek 等 OpenAI 兼容端点） */
export class OpenAIProvider extends BaseProvider {
  /** 子类标识名（错误来源标注） */
  protected override get providerName(): string {
    return "openai";
  }

  /** 最近一次请求的流式累积状态 */
  private acc?: Accumulator;

  /**
   * 上游请求流：组装 openai SDK 请求，迭代流式 chunk 并累积，供 buildResult 读取
   * @param call 单次请求参数
   * @returns openai 原始 chunk 迭代
   */
  protected override async *createStream(call: ProviderCall): AsyncIterable<unknown> {
    this.acc = { content: "", toolCalls: new Map() };
    const client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl,
    });
    const options: { signal?: AbortSignal; timeout?: number; maxRetries?: number } = {
      signal: call.signal,
    };
    if (this.config.timeoutMs !== undefined) {
      options.timeout = this.config.timeoutMs; // 仅显式配置时传（openai SDK 要求正整数）
    }
    if (this.config.maxRetries !== undefined && Number.isInteger(this.config.maxRetries) && this.config.maxRetries >= 0) {
      options.maxRetries = this.config.maxRetries;
    }
    const stream = await client.chat.completions.create(this.buildRequest(call), options);
    for await (const chunk of stream) {
      this.accumulate(chunk);
      yield chunk;
    }
  }

  /**
   * 原始 chunk → 中立 delta
   * @param chunk openai 流式 chunk
   * @returns 文本/推理增量；无增量返回 null
   */
  protected override normalizeDelta(chunk: unknown): ProviderDelta | null {
    if (typeof chunk !== "object" || chunk === null) return null;
    const choice = (chunk as { choices?: Array<{ delta?: unknown }> }).choices?.[0];
    const delta = choice?.delta as
      | { content?: string | null; reasoning_content?: string | null }
      | undefined;
    if (!delta) return null;
    // reasoning_content 为推理模型/厂商扩展字段（o1、deepseek 等），非标准 delta 字段
    if (delta.reasoning_content) {
      return { type: "reasoning-delta", text: delta.reasoning_content };
    }
    if (delta.content) {
      return { type: "text-delta", text: delta.content };
    }
    return null;
  }

  /**
   * 构建最终结果
   * @param _call 单次请求参数（累积状态已由 createStream 填充）
   * @returns 归一化后的 ProviderResult
   */
  protected override buildResult(_call: ProviderCall): ProviderResult {
    const acc = this.acc;
    if (!acc) {
      throw new Error("OpenAIProvider: 缺少累积状态（createStream 未完成）");
    }
    const toolCalls = [...acc.toolCalls.values()]
      .filter((tc) => tc.id)
      .map((tc) => ({ id: tc.id as string, name: tc.name, args: tc.args }));
    return {
      finishReason: toFinishReason(acc.finishReason),
      message: {
        role: "assistant",
        content: acc.content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      usage: acc.usage
        ? { inputTokens: acc.usage.input_tokens, outputTokens: acc.usage.output_tokens }
        : undefined,
    };
  }

  /**
   * 累积 chunk（工具调用参数按 index 拼接）
   * @param chunk openai 流式 chunk
   */
  private accumulate(chunk: unknown): void {
    const acc = this.acc;
    if (!acc) return;
    const c = chunk as {
      choices?: Array<{
        delta?: {
          content?: string | null;
          tool_calls?: Array<{
            index: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        finish_reason?: string | null;
      }>;
      usage?: { prompt_tokens: number; completion_tokens: number } | null;
    };
    const choice = c.choices?.[0];
    if (!choice) return;
    if (choice.delta?.content) acc.content += choice.delta.content;
    for (const tc of choice.delta?.tool_calls ?? []) {
      const existing = acc.toolCalls.get(tc.index) ?? { id: undefined, name: "", args: "" };
      if (tc.id) existing.id = tc.id;
      if (tc.function?.name) existing.name += tc.function.name;
      if (tc.function?.arguments) existing.args += tc.function.arguments;
      acc.toolCalls.set(tc.index, existing);
    }
    if (choice.finish_reason) acc.finishReason = choice.finish_reason;
    if (c.usage) {
      acc.usage = {
        input_tokens: c.usage.prompt_tokens,
        output_tokens: c.usage.completion_tokens,
      };
    }
  }

  /**
   * 组装 openai SDK 请求参数（中立 → SDK 转译）
   * @param call 单次请求参数
   * @returns SDK 流式请求参数
   */
  private buildRequest(call: ProviderCall): OpenAI.ChatCompletionCreateParamsStreaming {
    const sampling = this.buildSamplingParams(call.sampling);
    const request: OpenAI.ChatCompletionCreateParamsStreaming = {
      model: sampling.model,
      messages: this.toOpenAIMessages(call),
      stream: true,
    };
    if (sampling.maxTokens !== undefined) {
      request.max_completion_tokens = sampling.maxTokens;
    }
    if (sampling.temperature !== undefined) {
      request.temperature = sampling.temperature;
    }
    if (call.tools && call.tools.length > 0) {
      request.tools = call.tools.map((tool) => this.toOpenAITool(tool));
    }
    if (sampling.thinking) {
      this.applyThinking(request, sampling.thinking);
    }
    return request;
  }

  /**
   * 中立消息 → openai 消息（system 提示词并入 system 消息，tool 结果带 tool_call_id）
   * @param call 单次请求参数
   * @returns openai 消息序列
   */
  private toOpenAIMessages(call: ProviderCall): OpenAI.ChatCompletionMessageParam[] {
    const result: OpenAI.ChatCompletionMessageParam[] = [];
    if (call.system) {
      result.push({ role: "system", content: call.system });
    }
    for (const m of call.messages) {
      if (m.role === "system") {
        // 流内 system 提醒：user 角色 + 标签包裹（不继承 system 权威；见 systemReminder.ts）
        result.push({ role: "user", content: wrapSystemReminder(m.content) });
      } else if (m.role === "user") {
        result.push({ role: "user", content: m.content });
      } else if (m.role === "assistant") {
        const assistant: OpenAI.ChatCompletionAssistantMessageParam = {
          role: "assistant",
          content: m.content || null,
        };
        if (m.toolCalls && m.toolCalls.length > 0) {
          assistant.tool_calls = m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.args },
          }));
        }
        result.push(assistant);
      } else if (m.role === "tool") {
        result.push({ role: "tool", tool_call_id: m.id, content: m.content });
      }
    }
    return result;
  }

  /**
   * 中立工具 schema → openai function tool
   * @param scheme 中立工具 schema
   * @returns openai 工具定义
   */
  private toOpenAITool(scheme: ToolScheme): OpenAI.ChatCompletionTool {
    return {
      type: "function",
      function: {
        name: scheme.name,
        description: scheme.description,
        parameters: (scheme.parameters ?? { type: "object" }) as Record<string, unknown>,
      },
    };
  }

  /**
   * ThinkingParam → openai reasoning 参数（reasoning-effort 模式）
   * @param request SDK 请求参数（原地修改）
   * @param thinking 厂商 thinking 参数
   */
  private applyThinking(request: OpenAI.ChatCompletionCreateParamsStreaming, thinking: ThinkingParam): void {
    switch (thinking.type) {
      case "reasoning":
        request.reasoning_effort = thinking.effort;
        break;
      case "disabled":
        request.reasoning_effort = "none";
        break;
      case "adaptive":
      case "enabled":
        // openai 无 adaptive / budget_tokens 形态，忽略（claude 模型不会走到这里）
        break;
    }
  }
}

/** openai finish_reason → 中立 finishReason（tool_calls→tool_call、length→length，其余归 stop） */
function toFinishReason(finishReason: string | undefined): ProviderResult["finishReason"] {
  switch (finishReason) {
    case "tool_calls":
      return "tool_call";
    case "length":
      return "length";
    default:
      return "stop";
  }
}
