/**
 * McpConnectionManager：会话子进程内的 MCP 客户端生命周期（connect + listTools +
 * 包装 + close）。单台失败记录跳过不阻断会话；会话退出统一 close 防 stdio 孤儿。
 * 会话启动时 connectAll 一次，会话期内工具面不变（对齐装配期确定语义）。
 */
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { McpServerConfig } from "../../config/contract.js";
import type { ToolDef } from "../tool/ToolDef.js";
import { wrapMcpTool } from "./wrapMcpTool.js";
import type { Logger } from "../../log/Logger.js";

/** 单台连接超时（并行连接：总耗时 ≈ 单台上限，不得吃穿子进程 15s 报到预算） */
const CONNECT_TIMEOUT_MS = 8_000;

/** 客户端身份（对端日志可见） */
const CLIENT_INFO = { name: "nova-writing", version: "1.0.0" } as const;

/** 连接失败记录（诊断 + 会话内告知） */
export interface McpConnectFailure {
  /** 服务器配置（enabled 项） */
  readonly server: McpServerConfig;
  /** 中文原因 */
  readonly error: string;
}

/** connectAll 结果：全部可用工具 + 失败清单 */
export interface McpConnectResult {
  readonly tools: readonly ToolDef[];
  readonly failures: readonly McpConnectFailure[];
}

/** 超时竞速（connect 不接受 AbortSignal，用 race + 兜底 close） */
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

/** 按配置构造传输 */
function createTransport(server: McpServerConfig) {
  if (server.transport.type === "stdio") {
    return new StdioClientTransport({
      command: server.transport.command,
      args: [...server.transport.args],
      ...(server.transport.env !== undefined ? { env: server.transport.env } : {}),
    });
  }
  return new StreamableHTTPClientTransport(new URL(server.transport.url), {
    ...(server.transport.headers !== undefined
      ? { requestInit: { headers: server.transport.headers } }
      : {}),
  });
}

/** MCP 连接管理器：一台服务器一个 Client，会话结束统一关闭 */
export class McpConnectionManager {
  private readonly clients: Client[] = [];
  private readonly logger?: Logger;
  private closed = false;

  constructor(options?: { logger?: Logger }) {
    this.logger = options?.logger;
  }

  /**
   * 连接全部服务器并包装工具（并行 connect + listTools；失败记录跳过，顺序保持配置序）。
   * @param servers enabled 服务器配置（env 注入）
   * @returns 可用工具 + 失败清单
   */
  async connectAll(servers: readonly McpServerConfig[]): Promise<McpConnectResult> {
    const perServer: readonly ({ client: Client; tools: ToolDef[] } | { failure: McpConnectFailure })[] =
      await Promise.all(
        servers.map(async (server): Promise<{ client: Client; tools: ToolDef[] } | { failure: McpConnectFailure }> => {
        const client = new Client(CLIENT_INFO);
        try {
          await withTimeout(client.connect(createTransport(server)), CONNECT_TIMEOUT_MS);
          const listed = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS);
          const tools = listed.tools.map((tool) =>
            wrapMcpTool(
              { serverName: server.name, trusted: server.trusted, caller: client },
              {
                name: tool.name,
                ...(tool.description !== undefined ? { description: tool.description } : {}),
                ...(tool.inputSchema !== undefined
                  ? { inputSchema: tool.inputSchema as Record<string, unknown> }
                  : {}),
              },
            ),
          );
          return { client, tools };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          // 失败客户端兜底关闭（防 stdio 孤儿）；已成功的保持连接
          await client.close().catch(() => {});
          this.logger?.warn("mcp.connect_failed", { server: server.name, error });
          return { failure: { server, error } as McpConnectFailure };
        }
      }),
    );
    const tools: ToolDef[] = [];
    const failures: McpConnectFailure[] = [];
    for (const result of perServer) {
      if ("failure" in result) {
        failures.push(result.failure);
      } else {
        this.clients.push(result.client);
        tools.push(...result.tools);
      }
    }
    return { tools, failures };
  }

  /** 关闭全部连接（幂等；会话退出路径调用） */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.all(this.clients.map((c) => c.close().catch(() => {})));
    this.clients.length = 0;
  }
}
