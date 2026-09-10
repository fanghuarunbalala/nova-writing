import { describe, it, expect } from "vitest";
import { MapToolDispatcher } from "../MapToolDispatcher.js";
import type { ToolDef } from "../ToolDef.js";

function makeTool(name: string, result = `result:${name}`): ToolDef {
  return { name, version: "1", handler: { execute: async () => result } };
}

describe("MapToolDispatcher", () => {
  it("构造注册 + resolve 查表 + list 注册序", () => {
    const dispatcher = new MapToolDispatcher([makeTool("Read"), makeTool("Write")]);
    expect(dispatcher.resolve("Read")?.name).toBe("Read");
    expect(dispatcher.resolve("missing")).toBeUndefined();
    expect(dispatcher.list().map((t) => t.name)).toEqual(["Read", "Write"]);
  });

  it("register 链式 + 重名覆盖", () => {
    const dispatcher = new MapToolDispatcher();
    dispatcher.register(makeTool("Read")).register(makeTool("Write", "overridden"));
    expect(dispatcher.list()).toHaveLength(2);
    dispatcher.register(makeTool("Write", "v2"));
    expect(dispatcher.resolve("Write")?.handler).toBeDefined();
    expect(dispatcher.list()).toHaveLength(2);
  });

  it("dispatch 按名执行 handler；未知工具抛错", async () => {
    const dispatcher = new MapToolDispatcher([makeTool("Read", "读到了")]);
    const call = { id: "c1", name: "Read", args: "{}" };
    expect(await dispatcher.dispatch({} as never, call as never)).toBe("读到了");
    await expect(
      dispatcher.dispatch({} as never, { id: "c2", name: "Nope", args: "{}" } as never),
    ).rejects.toThrow(/未知工具/);
  });
});
