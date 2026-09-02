import type { ToolDef } from "./ToolDef.js";

/** 工具注册表：注册工具（整合定义：scheme + handler + prompt 细节），按 name 寻址 */
export interface ToolRegistry {
  /**
   * 注册工具（同 name 重复注册由实现抛 TOOL_DUPLICATE）
   * @param def 工具定义（scheme + handler + promptDetail）
   */
  register(def: ToolDef): void;
  /** 列出已注册工具定义 */
  list(): ToolDef[];
  /**
   * 按工具名查找（未注册返回 undefined）
   * @param name 工具名
   * @returns 工具定义（未注册 undefined）
   */
  get(name: string): ToolDef | undefined;
  /**
   * 按工具名查找（未注册抛 ToolError TOOL_NOT_AVAILABLE）
   * @param name 工具名
   * @returns 工具定义
   */
  require(name: string): ToolDef;
}
