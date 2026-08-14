/**
 * Map 查表工具调度器：工具名 → ToolDef（O(1) 解析），dispatch 经 resolve 执行 handler。
 * Map-backed tool dispatcher: tool name → ToolDef (O(1) resolution);
 * dispatch executes the handler via resolve.
 */
import type { ToolCall } from "../provider/types.js";
import type { ReadonlyLoopContext } from "../loop/LoopContext.js";
import type { ToolDef } from "./ToolDef.js";
import type { ToolDispatcher } from "./ToolDispatcher.js";

/**
 * Map 工具调度器：注册/解析/列表 + 按名分发（未知工具抛错）。
 * Map tool dispatcher: register/resolve/list plus dispatch by name
 * (throws on unknown tools).
 */
export class MapToolDispatcher implements ToolDispatcher {
  /** 工具名 → 定义 */
  readonly #tools = new Map<string, ToolDef>();

  /**
   * 构造调度器（可选初始工具集）
   * @param defs 初始工具定义
   */
  constructor(defs?: Iterable<ToolDef>) {
    for (const def of defs ?? []) {
      this.register(def);
    }
  }

  /**
   * 注册工具（重名覆盖）
   * @param def 工具定义
   * @returns 调度器（链式）
   */
  register(def: ToolDef): this {
    this.#tools.set(def.name, def);
    return this;
  }

  /**
   * 按工具名解析工具定义
   * @param name 工具名
   * @returns 工具定义；未注册返回 undefined
   */
  resolve(name: string): ToolDef | undefined {
    return this.#tools.get(name);
  }

  /** 列出已注册工具定义（注册序） */
  list(): ToolDef[] {
    return [...this.#tools.values()];
  }

  /**
   * 分发执行一次工具调用
   * @param _ctx LoopContext 只读视图（Map 分发不消费，由 handler 自行接收）
   * @param call 工具调用
   * @returns 执行结果文本
   */
  async dispatch(_ctx: ReadonlyLoopContext, call: ToolCall): Promise<string> {
    const tool = this.resolve(call.name);
    if (tool === undefined) throw new Error(`未知工具: ${call.name}`);
    return tool.handler.execute(call);
  }
}
