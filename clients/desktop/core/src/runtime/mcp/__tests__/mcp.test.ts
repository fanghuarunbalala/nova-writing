/**
 * runtime/mcp 测试：wrapMcpTool 命名/审批/序列化/错误归一、mcpEnv 往返、
 * InMemory 双端集成（listTools + callTool roundtrip）、连接失败跳过、测试连接失败映射。
 */
import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/server";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  buildMcpToolName,
  sanitizeSegment,
  serializeMcpContent,
  wrapMcpTool,
  type McpToolCaller,
} from "../wrapMcpTool.js";
import { McpConnectionManager } from "../McpConnectionManager.js";
import { serializeMcpEnv, parseMcpEnv } from "../mcpEnv.js";
import { testMcpConnection } from "../testMcpConnection.js";
import { ToolError } from "../../tool/errors.js";
import type { McpServerConfig } from "../../../config/contract.js";
import type { ToolCall } from "../../provider/types.js";

function callOf(name: string, args: unknown): ToolCall {
  return { id: `tc_${Math.random().toString(36).slice(2)}`, name, args: JSON.stringify(args) } as ToolCall;
}

function makeServerConfig(overrides?: Partial<McpServerConfig>): McpServerConfig {
  return {
    id: "srv_1",
    name: "Weather",
    transport: { type: "stdio", command: "x", args: [] },
    enabled: true,
    trusted: false,
    ...overrides,
  };
}

describe("命名与清洗", () => {
  it("sanitizeSegment：小写化 + 非法字符折叠 + 空回退", () => {
    expect(sanitizeSegment("My Server!", "srv")).toBe("my-server");
    expect(sanitizeSegment("资料·查询", "srv")).toBe("srv");
    expect(sanitizeSegment("---", "fallback")).toBe("fallback");
  });

  it("buildMcpToolName：mcp__server__tool；超 64 字符截断加 hash 后缀且保持唯一", () => {
    expect(buildMcpToolName("Weather", "get-alerts")).toBe("mcp__weather__get-alerts");
    const long = buildMcpToolName("a".repeat(40), "b".repeat(60));
    expect(long.length).toBe(64);
    expect(long.startsWith("mcp__")).toBe(true);
    const other = buildMcpToolName("a".repeat(40), "c".repeat(60));
    expect(other).not.toBe(long);
  });
});

describe("serializeMcpContent", () => {
  it("text 拼接、非文本 JSON 化、空回退占位", () => {
    expect(
      serializeMcpContent([{ type: "text", text: "a" }, { type: "text", text: "b" }]),
    ).toBe("a\nb");
    expect(serializeMcpContent([{ type: "image", data: "xx", mimeType: "image/png" }])).toContain(
      '"type":"image"',
    );
    expect(serializeMcpContent([])).toContain("未返回内容");
    expect(serializeMcpContent(undefined)).toContain("未返回内容");
  });
});

describe("wrapMcpTool", () => {
  it("非 trusted → requireApproval；trusted → 免审；description 带服务器前缀", () => {
    const caller: McpToolCaller = { callTool: async () => ({ content: [] }) };
    const citySchema = {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    } as const;
    const untrusted = wrapMcpTool(
      { serverName: "Weather", trusted: false, caller },
      { name: "lookup", description: "查天气", inputSchema: citySchema },
    );
    expect(untrusted.name).toBe("mcp__weather__lookup");
    expect(untrusted.requireApproval).toBe(true);
    expect(untrusted.description).toBe("[MCP:Weather] 查天气");
    expect(untrusted.parameters).toEqual(citySchema);
    const trusted = wrapMcpTool(
      { serverName: "Weather", trusted: true, caller },
      { name: "lookup", inputSchema: citySchema },
    );
    expect(trusted.requireApproval).toBeUndefined();
  });

  it("inputSchema 缺失/非 object 回退空 schema；description 超长截断", () => {
    const caller: McpToolCaller = { callTool: async () => ({ content: [] }) };
    const noSchema = wrapMcpTool({ serverName: "s", trusted: true, caller }, { name: "t" });
    expect(noSchema.parameters).toEqual({ type: "object", properties: {} });
    const longDesc = wrapMcpTool(
      { serverName: "s", trusted: true, caller },
      { name: "t", description: "x".repeat(2000) },
    );
    expect(longDesc.description.length).toBeLessThanOrEqual(1024);
  });

  it("执行：参数 JSON 非法 / callTool 抛错 / isError 归一 ToolError；正常返回文本", async () => {
    const caller: McpToolCaller = {
      callTool: async (params) => {
        if (params.name === "boom") throw new Error("network down");
        if (params.name === "isErr") return { content: [{ type: "text", text: "服务器错误原文" }], isError: true };
        return { content: [{ type: "text", text: `ok:${String(params.arguments?.city)}` }] };
      },
    };
    const ok = wrapMcpTool({ serverName: "s", trusted: true, caller }, { name: "query" });
    await expect(ok.handler.execute(callOf("mcp__s__query", { city: "北京" }))).resolves.toBe("ok:北京");

    await expect(
      ok.handler.execute({ id: "tc_bad", name: "mcp__s__query", args: "not-json" } as ToolCall),
    ).rejects.toThrowError(/无效的 MCP 工具参数/);

    const boom = wrapMcpTool({ serverName: "s", trusted: true, caller }, { name: "boom" });
    const boomErr = await boom.handler.execute(callOf("x", {})).catch((e: unknown) => e as ToolError);
    expect(boomErr).toBeInstanceOf(ToolError);
    expect(boomErr.message).toContain("MCP 调用失败");

    const isErr = wrapMcpTool({ serverName: "s", trusted: true, caller }, { name: "isErr" });
    const isErrOut = await isErr.handler.execute(callOf("x", {})).catch((e: unknown) => e as ToolError);
    expect(isErrOut).toBeInstanceOf(ToolError);
    expect(isErrOut.message).toContain("服务器错误原文");
  });
});

describe("mcpEnv", () => {
  it("serialize 仅含 enabled 项；parse 过滤非法条目、非法 JSON/非数组返回 undefined", () => {
    const raw = serializeMcpEnv([
      makeServerConfig(),
      makeServerConfig({ id: "srv_2", name: "Off", enabled: false }),
    ]);
    const parsed = parseMcpEnv(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]?.name).toBe("Weather");
    expect(parseMcpEnv(undefined)).toBeUndefined();
    expect(parseMcpEnv("bad-json")).toBeUndefined();
    expect(parseMcpEnv("{}")).toBeUndefined();
    expect(parseMcpEnv('[{"id":1}]')).toBeUndefined();
    expect(parseMcpEnv("[]")).toBeUndefined();
  });
});

describe("InMemory 集成（真实 Client ↔ Server）", () => {
  it("listTools 包装 + callTool roundtrip 经 ToolDef handler", async () => {
    const server = new McpServer({ name: "fixture", version: "1.0.0" });
    server.registerTool(
      "echo",
      { description: "回声" },
      async () => ({ content: [{ type: "text", text: "pong" }] }),
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "probe", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);
    const wrapped = wrapMcpTool(
      { serverName: "Fixture", trusted: false, caller: client },
      { name: tools[0]!.name, description: tools[0]!.description },
    );
    expect(wrapped.name).toBe("mcp__fixture__echo");
    expect(wrapped.requireApproval).toBe(true);
    await expect(wrapped.handler.execute(callOf("mcp__fixture__echo", {}))).resolves.toBe("pong");

    await client.close();
    await server.close();
  });

  it("McpConnectionManager：stdio 命令不存在 → 记失败不抛错", async () => {
    const manager = new McpConnectionManager();
    const result = await manager.connectAll([
      makeServerConfig({
        transport: { type: "stdio", command: "definitely-not-exist-cmd-xyz", args: [] },
      }),
    ]);
    expect(result.tools).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.server.name).toBe("Weather");
    await manager.close();
  });

  it("testMcpConnection：stdio 命令不存在 → ok:false 中文原因", async () => {
    const result = await testMcpConnection({
      name: "Bad",
      transport: { type: "stdio", command: "definitely-not-exist-cmd-xyz", args: [] },
      enabled: true,
      trusted: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });
});
