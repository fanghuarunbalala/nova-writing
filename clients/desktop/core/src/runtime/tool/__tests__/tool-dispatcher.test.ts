import { describe, it, expect } from "vitest";
import { InMemoryToolRegistry } from "../InMemoryToolRegistry.js";
import { createToolDispatcher } from "../createToolDispatcher.js";
import { ToolError } from "../errors.js";
import type { ReadonlyLoopContext } from "../../loop/LoopContext.js";
import type { ToolCall } from "../../provider/types.js";

const ctx = {} as ReadonlyLoopContext;

function call(name: string): ToolCall {
  return { id: "tc-1", name, args: "{}" };
}

describe("createToolDispatcher", () => {
  it("正常分发：按 name 映射 handler 并返回结果", async () => {
    const r = new InMemoryToolRegistry();
    r.register({
      name: "Read",
      version: "1.0.0",
      handler: { execute: async (c) => `结果:${c.name}` },
    });
    const d = createToolDispatcher(r);
    await expect(d.dispatch(ctx, call("Read"))).resolves.toBe("结果:Read");
  });

  it("未知工具抛 TOOL_NOT_AVAILABLE", async () => {
    const d = createToolDispatcher(new InMemoryToolRegistry());
    try {
      await d.dispatch(ctx, call("Write"));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).code).toBe("TOOL_NOT_AVAILABLE");
      expect((err as ToolError).toolName).toBe("Write");
      expect((err as Error).message).toContain("未知工具: Write");
    }
  });

  it("handler 抛普通 Error → wrap TOOL_HANDLER_FAILED（cause 保留、message 含原消息）", async () => {
    const r = new InMemoryToolRegistry();
    const boom = new Error("磁盘已满");
    r.register({
      name: "Write",
      version: "1.0.0",
      handler: {
        execute: async () => {
          throw boom;
        },
      },
    });
    const d = createToolDispatcher(r);
    try {
      await d.dispatch(ctx, call("Write"));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      const toolErr = err as ToolError;
      expect(toolErr.code).toBe("TOOL_HANDLER_FAILED");
      expect(toolErr.cause).toBe(boom);
      expect(toolErr.toolName).toBe("Write");
      expect(toolErr.toolCallId).toBe("tc-1");
      expect(toolErr.message).toContain("磁盘已满");
    }
  });

  it("handler 抛 ToolError → 原样透传（code 不变）", async () => {
    const r = new InMemoryToolRegistry();
    r.register({
      name: "Write",
      version: "1.0.0",
      handler: {
        execute: async () => {
          throw new ToolError({ code: "TOOL_ARGUMENTS_INVALID", toolName: "Write" }, "参数非法");
        },
      },
    });
    const d = createToolDispatcher(r);
    try {
      await d.dispatch(ctx, call("Write"));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).code).toBe("TOOL_ARGUMENTS_INVALID");
      expect((err as Error).message).toBe("参数非法");
    }
  });

  it("handler 抛非 Error 值 → wrap TOOL_HANDLER_FAILED", async () => {
    const r = new InMemoryToolRegistry();
    r.register({
      name: "Write",
      version: "1.0.0",
      handler: {
        execute: async () => {
          // eslint-disable-next-line no-throw-literal
          throw "字符串错误";
        },
      },
    });
    const d = createToolDispatcher(r);
    try {
      await d.dispatch(ctx, call("Write"));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).code).toBe("TOOL_HANDLER_FAILED");
      expect((err as Error).message).toContain("字符串错误");
    }
  });
});
