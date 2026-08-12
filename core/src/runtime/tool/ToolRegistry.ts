import type { ToolDef } from "./ToolDef.js";

/** 工具注册表：注册工具（整合定义：scheme + handler + prompt 细节） */
export interface ToolRegistry {
  /**
   * 注册工具
   * @param def 工具定义（scheme + handler + promptDetail）
   */
  register(def: ToolDef): void;
  /** 列出已注册工具定义 */
  list(): ToolDef[];
}
