import Anthropic from "@anthropic-ai/sdk";
import type {
  ProviderCall,
  ProviderResult,
  ProviderDelta,
  LLMessage,
  AssistantMessage,
  ToolScheme,
} from "../types.js";
import { BaseProvider } from "../BaseProvider.js";
import { ProviderUnknownError } from "../errors.js";
import type { ThinkingParam } from "../model-info.js";
import { wrapSystemReminder } from "../systemReminder.js";

/** Anthropic 适配器实现（基于 @anthropic-ai/sdk，模板三钩子落地） */
export class AnthropicProvider extends BaseProvider {
  /** 子类标识名（错误来源标注） */
  protected override get providerName(): string {
    return "anthropic";
  }

  /** 最近一次请求的最终消息（createStream 迭代完填充，buildResult 读取；实例串行使用约定） */
  private finalMessage?: Anthropic.Message;

  /**
   * 上游请求流：组装 Anthropic SDK 请求，迭代上游事件，结束取最终消息
   * @param call 单次请求参数
   * @returns Anthropic 原始事件迭代
   */
  protected override async *createStream(call: ProviderCall): AsyncIterable<unknown> {
    const client = new Anthropic({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl,
    });
    const stream = client.messages.stream(this.buildRequest(call), {
      signal: call.signal,
      timeout: this.config.timeoutMs,
    });
    for await (const event of stream) {
      yield event;
    }
    // 流式结束，取完整消息供 buildResult 使用
    this.finalMessage = await stream.finalMessage();
  }

  /**
   * 原始事件 → 中立 delta
   * @param chunk Anthropic 原始事件
   * @returns 文本/推理增量；无增量返回 null
   */
  protected override normalizeDelta(chunk: unknown): ProviderDelta | null {
    if (typeof chunk !== "object" || chunk === null) return null;
    const event = chunk as {
      type?: string;
      delta?: { type?: string; text?: string; thinking?: string };
    };
    if (event.type !== "content_block_delta" || !event.delta) return null;
    if (event.delta.type === "text_delta" && typeof event.delta.text === "string") {
      return { type: "text-delta", text: event.delta.text };
    }
    if (event.delta.type === "thinking_delta" && typeof event.delta.thinking === "string") {
      return { type: "reasoning-delta", text: event.delta.thinking };
    }
    return null;
  }

  /**
   * 构建最终结果
   * @param call 单次请求参数
   * @returns 归一化后的 ProviderResult
   * @throws ProviderError 模型拒绝（refusal）时抛出，走异常通道
   */
  protected override buildResult(_call: ProviderCall): ProviderResult {
    void _call;
    const message = this.finalMessage;
    if (!message) {
      throw new Error("AnthropicProvider: 缺少最终消息（createStream 未完成）");
    }
    if (message.stop_reason === "refusal") {
      throw new ProviderUnknownError("模型拒绝请求（refusal）", { provider: "anthropic" });
    }
    return {
      finishReason: toFinishReason(message.stop_reason),
      message: toAssistantMessage(message),
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
    };
  }

  /**
   * 组装 Anthropic SDK 请求参数（中立 → SDK 转译）
   * @param call 单次请求参数
   * @returns SDK 流式请求参数
   */
  private buildRequest(call: ProviderCall): Anthropic.MessageCreateParamsStreaming {
    const sampling = this.buildSamplingParams(call.sampling);
    const request: Anthropic.MessageCreateParamsStreaming = {
      model: sampling.model,
      max_tokens: sampling.maxTokens ?? 4096,
      system: call.system,
      messages: this.toAnthropicMessages(call.messages),
      stream: true,
    };
    if (call.tools && call.tools.length > 0) {
      request.tools = call.tools.map((tool) => this.toAnthropicTool(tool));
    }
    if (sampling.thinking) {
      this.applyThinking(request, sampling.thinking);
    }
    // temperature：新模型已移除（ModelInfo.supportsTemperature=false 时 buildSamplingParams 已滤掉），不传
    return request;
  }


  /**
   * 中立消息 → Anthropic 消息（system 抽离到顶层，tool_result 并入 user 消息）
   * @param messages 中立消息序列
   * @returns Anthropic 消息序列
   */
  private toAnthropicMessages(messages: LLMessage[]): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];
    for (const m of messages) {
      if (m.role === "user" || m.role === "system") {
        // 流内 system 提醒与其他适配器一致：user 角色 + 标签包裹（见 systemReminder.ts）
        const text = m.role === "system" ? wrapSystemReminder(m.content) : m.content;
        result.push({ role: "user", content: [{ type: "text", text }] });
      } else if (m.role === "assistant") {
        const blocks: Anthropic.ContentBlockParam[] = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const tc of m.toolCalls ?? []) {
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: JSON.parse(tc.args) as Record<string, unknown>,
          });
        }
        result.push({ role: "assistant", content: blocks });
      } else if (m.role === "tool") {
        result.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: m.id, content: m.content }],
        });
      }
    }
    return result;
  }

  /**
   * 中立工具 schema → Anthropic Tool
   * @param scheme 中立工具 schema
   * @returns Anthropic 工具定义
   */
  private toAnthropicTool(scheme: ToolScheme): Anthropic.Tool {
    return {
      name: scheme.name,
      description: scheme.description,
      input_schema: (scheme.parameters ?? { type: "object" }) as unknown as Anthropic.Tool.InputSchema,
    };
  }

  /**
   * ThinkingParam → Anthropic thinking + output_config 配合形态
   * @param request SDK 请求参数（原地修改）
   * @param thinking 厂商 thinking 参数
   */
  private applyThinking(request: Anthropic.MessageCreateParamsStreaming, thinking: ThinkingParam): void {
    switch (thinking.type) {
      case "adaptive":
        request.thinking = { type: "adaptive", display: "summarized" };
        request.output_config = { effort: thinking.effort };
        break;
      case "disabled":
        request.thinking = { type: "disabled" };
        break;
      case "enabled":
        request.thinking = { type: "enabled", budget_tokens: thinking.budgetTokens };
        break;
      case "reasoning":
        // Anthropic 无 reasoning 形态，忽略（理论不会到达）
        break;
    }
  }
}

/** Anthropic stop_reason → 中立 finishReason（refusal 已在 buildResult 处理） */
function toFinishReason(stopReason: string | null): ProviderResult["finishReason"] {
  switch (stopReason) {
    case "tool_use":
      return "tool_call";
    case "max_tokens":
      return "length";
    case "end_turn":
      return "stop";
    default:
      // stop_sequence / pause_turn 等暂归 stop
      return "stop";
  }
}

/** Anthropic LLMessage → 中立 AssistantMessage（text 块拼接 + tool_use 转 ToolCall） */
function toAssistantMessage(message: Anthropic.Message): AssistantMessage {
  const textParts: string[] = [];
  const toolCalls: AssistantMessage["toolCalls"] = [];
  for (const block of message.content) {
    if (block.type === "text") {
      textParts.push(block.text);
    } else if (block.type === "tool_use") {
      toolCalls.push({ id: block.id, name: block.name, args: JSON.stringify(block.input) });
    }
  }
  return {
    role: "assistant",
    content: textParts.join(""),
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}
