import { describe, it, expect } from "vitest";
import { InMemoryToolRegistry } from "../InMemoryToolRegistry.js";
import { ToolError } from "../errors.js";
import type { ToolDef } from "../ToolDef.js";

function tool(name: string): ToolDef {
  return { name, version: "1.0.0", handler: { execute: async () => "" } };
}

describe("InMemoryToolRegistry", () => {
  it("register/get/require 往返", () => {
    const r = new InMemoryToolRegistry();
    const read = tool("Read");
    r.register(read);
    expect(r.get("Read")).toBe(read);
    expect(r.require("Read")).toBe(read);
    expect(r.get("Write")).toBeUndefined();
  });

  it("require 未知工具抛 TOOL_NOT_AVAILABLE", () => {
    const r = new InMemoryToolRegistry();
    try {
      r.require("Write");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).code).toBe("TOOL_NOT_AVAILABLE");
      expect((err as ToolError).toolName).toBe("Write");
      expect((err as Error).message).toContain("未知工具: Write");
    }
  });

  it("重复注册抛 TOOL_DUPLICATE", () => {
    const r = new InMemoryToolRegistry();
    r.register(tool("Read"));
    try {
      r.register(tool("Read"));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).code).toBe("TOOL_DUPLICATE");
      expect((err as ToolError).toolName).toBe("Read");
      expect((err as Error).message).toContain("重复注册工具: Read");
    }
  });

  it("list() 按名字典序", () => {
    const r = new InMemoryToolRegistry();
    for (const name of ["Glob", "Read", "Agent"]) r.register(tool(name));
    expect(r.list().map((t) => t.name)).toEqual(["Agent", "Glob", "Read"]);
  });
});
