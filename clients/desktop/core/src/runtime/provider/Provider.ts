import type {
  ProviderConfig,
  ProviderCall,
  ProviderResult,
  ProviderOnDelta,
} from "./types.js";
import type { ModelInfo } from "./model-info.js";
import { ModelInfoRegistry } from "./model-info.js";
import { AnthropicProvider } from "./adapters/AnthropicProvider.js";
import { OpenAIProvider } from "./adapters/OpenAIProvider.js";

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

  /**
   * 查询模型能力信息（含上下文窗口 token 数；压缩策略阈值基准）
   * @param model 模型名
   * @returns 模型能力信息（注册覆盖优先，缺省按名启发式推断）
   */
  getModelInfo(model: string): ModelInfo;
}

/**
 * 依据 ProviderConfig 创建对应类型的 Provider 适配器实例
 * @param config Provider 实例配置
 * @param modelInfo 可选：模型信息注册表（多 provider 实例共享能力覆盖时传入同一实例；缺省各自新建）
 * @returns Provider 适配器
 */
export function createProvider(config: ProviderConfig, modelInfo?: ModelInfoRegistry): Provider {
  switch (config.type) {
    case "anthropic":
      return new AnthropicProvider(config, modelInfo);
    case "openai":
      return new OpenAIProvider(config, modelInfo);
  }
}
