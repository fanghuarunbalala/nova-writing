/**
 * MCP 连接测试（设置页「测试连接」；main 进程执行）：
 * 临时连接 initialize + tools/list，8 秒超时，finally close（防孤儿）。
 * 返回工具清单预览 / 中文失败原因。风格对齐 config/connectionTest.ts。
 */
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { McpServerInput, McpTestResult } from "../../config/contract.js";

/** 测试超时 */
const TEST_TIMEOUT_MS = 8_000;

const CLIENT_INFO = { name: "nova-writing", version: "1.0.0" } as const;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`连接超时（${Math.round(ms / 1000)} 秒）`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** 错误 → 中文原因（超时 / 命令不存在 / 握手失败分 mapping） */
function messageForError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("超时") || message.toLowerCase().includes("timeout")) {
    return "连接超时：服务器在 8 秒内未完成握手，请检查命令/地址是否可启动";
  }
  if (message.includes("ENOENT") || message.toLowerCase().includes("spawn")) {
    return "命令不存在：请检查 command 是否在 PATH 上（Windows 下 npx 类命令可能需要 npx.cmd）";
  }
  return `握手失败：${message}`;
}

/**
 * 测试 MCP 服务器连通性（不落库、不保存配置）。
 * @param input 服务器配置（draft 表单直传）
 * @returns 成功附工具数与清单；失败附中文原因
 */
export async function testMcpConnection(input: McpServerInput): Promise<McpTestResult> {
  const client = new Client(CLIENT_INFO);
  try {
    const transport =
      input.transport.type === "stdio"
        ? new StdioClientTransport({
            command: input.transport.command,
            args: [...input.transport.args],
            ...(input.transport.env !== undefined ? { env: input.transport.env } : {}),
          })
        : new StreamableHTTPClientTransport(new URL(input.transport.url), {
            ...(input.transport.headers !== undefined
              ? { requestInit: { headers: input.transport.headers } }
              : {}),
          });
    await withTimeout(client.connect(transport), TEST_TIMEOUT_MS);
    const { tools } = await withTimeout(client.listTools(), TEST_TIMEOUT_MS);
    return {
      ok: true,
      toolCount: tools.length,
      tools: tools.map((t) => ({
        name: t.name,
        ...(t.description !== undefined ? { description: t.description } : {}),
      })),
    };
  } catch (err) {
    return { ok: false, error: messageForError(err) };
  } finally {
    await client.close().catch(() => {});
  }
}
