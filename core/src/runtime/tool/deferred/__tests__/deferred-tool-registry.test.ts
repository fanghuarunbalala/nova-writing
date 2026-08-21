import { describe, it, expect } from "vitest";
import { DeferredToolRegistry } from "../DeferredToolRegistry.js";
import type { ToolDef } from "../../ToolDef.js";

function makeTool(name: string, description?: string, parameters?: Record<string, unknown>): ToolDef {
  return {
    name,
    version: "1.0.0",
    ...(description === undefined ? {} : { description }),
    ...(parameters === undefined ? {} : { parameters }),
    handler: { execute: async () => `result:${name}` },
  };
}

const TOOLS = [
  makeTool(
    "mcp__slack__send_message",
    "[MCP:slack] 发送消息到 Slack 频道",
    { type: "object", properties: { channel: { type: "string" }, text: { type: "string" } } },
  ),
  makeTool("mcp__slack__list_channels", "[MCP:slack] 列出频道"),
  makeTool("mcp__slack__broadcast", "[MCP:slack] send 消息广播到所有频道"),
  makeTool("mcp__notion__query", "[MCP:notion] 查询 Notion 数据库"),
];

describe("DeferredToolRegistry", () => {
  it("get / list / size：注册序保存", () => {
    const registry = new DeferredToolRegistry(TOOLS);
    expect(registry.size).toBe(4);
    expect(registry.get("mcp__slack__send_message")?.description).toContain("Slack");
    expect(registry.get("nope")).toBeUndefined();
    expect(registry.list().map((t) => t.name)).toEqual([
      "mcp__slack__send_message",
      "mcp__slack__list_channels",
      "mcp__slack__broadcast",
      "mcp__notion__query",
    ]);
  });

  it("空注册表：kind=empty，提示无延迟工具", () => {
    const registry = new DeferredToolRegistry();
    expect(registry.search("anything").kind).toBe("empty");
    expect(registry.search("anything").text).toContain("当前没有延迟工具可用");
  });

  it("select: 单名精确选择，含 ExecuteExtraTool 引导", () => {
    const result = new DeferredToolRegistry(TOOLS).search("select:mcp__slack__send_message");
    expect(result.kind).toBe("selected");
    expect(result.items.map((i) => i.name)).toEqual(["mcp__slack__send_message"]);
    expect(result.text).toContain("找到 1 个延迟工具");
    expect(result.text).toContain('{"tool_name": "mcp__slack__send_message"');
  });

  it("select: 逗号多选 + 未命中点名", () => {
    const result = new DeferredToolRegistry(TOOLS).search(
      "select:mcp__slack__send_message,mcp__notion__query,mcp__missing__x",
    );
    expect(result.kind).toBe("selected");
    expect(result.items.map((i) => i.name)).toEqual([
      "mcp__slack__send_message",
      "mcp__notion__query",
    ]);
    expect(result.text).toContain("找到 2 个延迟工具");
    expect(result.text).toContain("未找到: mcp__missing__x");
  });

  it("select: 全部未命中 → kind=none", () => {
    const result = new DeferredToolRegistry(TOOLS).search("select:a,b");
    expect(result.kind).toBe("none");
    expect(result.text).toContain("未找到延迟工具: a, b");
  });

  it("discover: 返回 name + description + 完整参数 schema", () => {
    const result = new DeferredToolRegistry(TOOLS).search("discover:slack send");
    expect(result.kind).toBe("discovered");
    const item = result.items.find((i) => i.name === "mcp__slack__send_message");
    expect(item?.description).toContain("发送消息");
    expect(item?.parameters).toEqual({
      type: "object",
      properties: { channel: { type: "string" }, text: { type: "string" } },
    });
    expect(result.text).toContain("参数 schema:");
    expect(result.text).toContain("discover 仅查看，不执行");
  });

  it("discover: 无匹配 → kind=none", () => {
    const result = new DeferredToolRegistry(TOOLS).search("discover:zzz不存在");
    expect(result.kind).toBe("none");
    expect(result.text).toContain("不要断言能力不存在");
  });

  it("关键词：名称包含 > 描述包含排序（多词分词累加）", () => {
    const result = new DeferredToolRegistry(TOOLS).search("send");
    expect(result.kind).toBe("matched");
    // send：send_message 名称包含（2 分）置顶，broadcast 描述包含（1 分）次之
    expect(result.items.map((i) => i.name)).toEqual([
      "mcp__slack__send_message",
      "mcp__slack__broadcast",
    ]);
    expect(result.text).toContain("找到 2 个匹配的延迟工具");
  });

  it("关键词：名称精确命中置顶（Notion 名精确）", () => {
    const result = new DeferredToolRegistry(TOOLS).search("mcp__notion__query");
    expect(result.items[0]?.name).toBe("mcp__notion__query");
  });

  it("关键词：max_results 截断（下限 1）", () => {
    const result = new DeferredToolRegistry(TOOLS).search("slack", 1);
    expect(result.items).toHaveLength(1);
    const clamped = new DeferredToolRegistry(TOOLS).search("slack", 0);
    expect(clamped.items.length).toBeGreaterThanOrEqual(1);
  });

  it("空关键词 → kind=none；大小写不敏感", () => {
    const registry = new DeferredToolRegistry(TOOLS);
    expect(registry.search("   ").kind).toBe("none");
    const upper = registry.search("SLACK SEND");
    expect(upper.items.map((i) => i.name)).toContain("mcp__slack__send_message");
  });
});
