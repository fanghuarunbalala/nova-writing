import type {
  ProviderConfig,
  ProviderCall,
  ProviderResult,
  ProviderDelta,
  ProviderOnDelta,
} from "./types.js";
import type { Provider } from "./Provider.js";
import { ProviderError, toProviderError } from "./errors.js";

/** 抽象基类：模板方法，默认实现 call 骨架 */
export abstract class BaseProvider implements Provider {
  /** Provider 实例配置 */
  protected readonly config: ProviderConfig;

  /**
   * 构造 BaseProvider
   * @param config Provider 实例配置
   */
  constructor(config: ProviderConfig) {
    this.config = config;
  }

  /**
   * 模板方法：一次请求的完整骨架，子类不重写
   * @param call 单次请求参数
   * @param onDelta 可选：流式中间增量回调
   * @returns 最终完整结果 ProviderResult
   * @throws ProviderError 标准化异常
   */
  async call(call: ProviderCall, onDelta?: ProviderOnDelta): Promise<ProviderResult> {
    try {
      // ① 取消检查
      this.assertNotAborted(call.signal);
      // ② 发起上游流（子类钩子）
      for await (const chunk of this.createStream(call)) {
        this.assertNotAborted(call.signal);
        // ③ chunk → 中立 delta（子类钩子），回调
        const delta = this.normalizeDelta(chunk);
        if (delta && onDelta) onDelta(delta);
      }
      // ④ 构建最终结果（子类钩子）
      return this.buildResult(call);
    } catch (raw) {
      // ⑤ 边界统一封装（私有默认）
      throw this.wrapError(raw);
    }
  }

  /** 上游请求流（子类实现：接 SDK，返回原始 chunk 迭代） */
  protected abstract createStream(call: ProviderCall): AsyncIterable<unknown>;
  /** 原始 chunk → 中立 delta（子类实现；无增量可返回 null） */
  protected abstract normalizeDelta(chunk: unknown): ProviderDelta | null;
  /** 累积状态 → 最终 ProviderResult（子类实现） */
  protected abstract buildResult(call: ProviderCall): ProviderResult;

  /** 取消检查（私有默认） */
  private assertNotAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new ProviderError("aborted", "请求已被取消");
    }
  }
  /** 错误封装（私有默认） */
  private wrapError(raw: unknown): ProviderError {
    return toProviderError(raw, this.providerName);
  }
  /** 子类标识名（错误来源标注，子类覆盖） */
  protected get providerName(): string {
    return "unknown";
  }
}
