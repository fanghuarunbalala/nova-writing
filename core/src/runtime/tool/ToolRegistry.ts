import type { ToolScheme } from "../provider/types.js";
import type { ToolHandler } from "./ToolHandler.js";

/** 工具注册表：注册工具（scheme 定义 + 实现） */
export interface ToolRegistry {
  /**
   * 注册工具
   * @param scheme 工具定义（scheme）
   * @param handler 工具实现
   */
  register(scheme: ToolScheme, handler: ToolHandler): void;
  /** 列出已注册工具定义 */
  list(): ToolScheme[];
}
