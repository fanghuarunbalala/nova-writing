import type { ProviderCall, ProviderDelta, ProviderResult } from "../types.js";
import { BaseProvider } from "../BaseProvider.js";

/** Ollama 适配器实现 */
export class OllamaProvider extends BaseProvider {
  /** 子类标识名（错误来源标注） */
  protected override get providerName(): string {
    return "ollama";
  }

  /**
   * 上游请求流（待接入 Ollama API 后实现：转译中立请求 → Ollama 格式，迭代上游流）
   * @param call 单次请求参数
   * @returns 原始 chunk 迭代
   */
  protected override async *createStream(call: ProviderCall): AsyncIterable<unknown> {
    void call;
    throw new Error("OllamaProvider.createStream 尚未实现");
  }

  /**
   * 原始 chunk → 中立 delta
   * @param chunk 上游原始 chunk
   * @returns 文本/推理增量；无增量返回 null
   */
  protected override normalizeDelta(chunk: unknown): ProviderDelta | null {
    void chunk;
    throw new Error("OllamaProvider.normalizeDelta 尚未实现");
  }

  /**
   * 构建最终结果
   * @param call 单次请求参数
   * @returns 归一化后的 ProviderResult
   */
  protected override buildResult(call: ProviderCall): ProviderResult {
    void call;
    throw new Error("OllamaProvider.buildResult 尚未实现");
  }
}
