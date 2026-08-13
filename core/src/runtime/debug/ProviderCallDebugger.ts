import type { ProviderCall } from "../provider/types.js";

/**
 * ProviderCall 调试器接口：记录每次 provider 请求。
 * 具体实现负责落盘（jsonl）与相邻差异（html diff）展示；AgentLoop 在每次 provider.call 前调用 record。
 */
export interface ProviderCallDebugger {
  /**
   * 记录一次 provider 调用
   * @param call 本次 provider 请求
   */
  record(call: ProviderCall): void;
}
