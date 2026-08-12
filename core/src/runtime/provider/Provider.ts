import type {
  ProviderConfig,
  ProviderCall,
  ProviderResult,
  ProviderOnDelta,
} from "./types.js";
import { AnthropicProvider } from "./adapters/AnthropicProvider.js";
import { OpenAIProvider } from "./adapters/OpenAIProvider.js";
import { OllamaProvider } from "./adapters/OllamaProvider.js";

/** Provider 适配器实例 */
export interface Provider {
  /**
   * 发起一次请求，返回最终完整结果；中间增量经 onDelta 回调产出
   * @param call 单次请求参数
   * @param onDelta 可选：流式中间增量回调（文本增量 / 工具调用 / 用量）
   * @returns 最终完整结果 ProviderResult
   * @throws ProviderError 标准化异常（请求错误 / 认证 / 费用不足 / 限流 / 超时 / 网络 / 服务端 / 取消）
   */
  call(call: ProviderCall, onDelta?: ProviderOnDelta): Promise<ProviderResult>;
}

/**
 * 依据 ProviderConfig 创建对应类型的 Provider 适配器实例
 * @param config Provider 实例配置
 * @returns Provider 适配器实例
 */
export function createProvider(config: ProviderConfig): Provider {
  switch (config.type) {
    case "anthropic":
      return new AnthropicProvider(config);
    case "openai":
      return new OpenAIProvider(config);
    case "ollama":
      return new OllamaProvider(config);
  }
}
