/**
 * 内存工具注册表：按 name 键 Map（与 InMemoryRegistry 的 name@version 键职责分离——
 * dispatcher 按名寻址，version 只存于 ToolDef.version 元数据）。
 * 重复注册抛 TOOL_DUPLICATE；require 未知抛 TOOL_NOT_AVAILABLE；list() 名字典序。
 */
import type { ToolDef } from "./ToolDef.js";
import type { ToolRegistry } from "./ToolRegistry.js";
import { ToolError } from "./errors.js";

/** 内存工具注册表实现（name → ToolDef） */
export class InMemoryToolRegistry implements ToolRegistry {
  /** 已注册工具（name 键） */
  private readonly tools = new Map<string, ToolDef>();

  /**
   * 注册工具（同 name 重复注册抛 TOOL_DUPLICATE）
   * @param def 工具定义
   */
  register(def: ToolDef): void {
    if (this.tools.has(def.name)) {
      throw new ToolError(
        { code: "TOOL_DUPLICATE", toolName: def.name },
        `重复注册工具: ${def.name}`,
      );
    }
    this.tools.set(def.name, def);
  }

  /** 列出已注册工具定义（按名字典序） */
  list(): ToolDef[] {
    return [...this.tools.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  /**
   * 按工具名查找
   * @param name 工具名
   * @returns 工具定义（未注册 undefined）
   */
  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  /**
   * 按工具名查找（未注册抛 TOOL_NOT_AVAILABLE）
   * @param name 工具名
   * @returns 工具定义
   */
  require(name: string): ToolDef {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ToolError(
        { code: "TOOL_NOT_AVAILABLE", toolName: name },
        `未知工具: ${name}`,
      );
    }
    return tool;
  }
}
