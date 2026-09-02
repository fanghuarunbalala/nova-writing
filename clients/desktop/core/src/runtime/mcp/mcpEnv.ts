/**
 * MCP 服务器 env 描述符（main → conversation 子进程下发）。
 * main 在启动/配置变更时把 enabled 服务器序列化为 NOVEL_MCP_SERVERS（JSON 数组）；
 * 子进程 spawn 时解析并交 McpConnectionManager 连接。缺省/非法返回 undefined
 * （不装 MCP 工具）。风格对齐 runtime/skill/skillsEnv.ts。
 */
import type { McpServerConfig } from "../../config/contract.js";

/** MCP 服务器 env 名 */
export const MCP_SERVERS_ENV = "NOVEL_MCP_SERVERS" as const;

/** 序列化为 env 值（仅 enabled 项；禁用项不下发） */
export function serializeMcpEnv(servers: readonly McpServerConfig[]): string {
  return JSON.stringify(servers.filter((s) => s.enabled));
}

/** 条目宽松校验（env 侧只保结构完整；详细校验在 config 域） */
function isMcpServerEntry(value: unknown): value is McpServerConfig {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.name !== "string") return false;
  const transport = record.transport;
  if (typeof transport !== "object" || transport === null) return false;
  const t = transport as Record<string, unknown>;
  if (t.type === "stdio") {
    return typeof t.command === "string" && Array.isArray(t.args);
  }
  if (t.type === "http") {
    return typeof t.url === "string";
  }
  return false;
}

/**
 * 解析 env 值（缺省/非法返回 undefined；单条非法过滤）。
 * @param raw env 原文
 * @returns enabled 服务器配置列表
 */
export function parseMcpEnv(raw: string | undefined): readonly McpServerConfig[] | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const servers = parsed.filter(isMcpServerEntry);
  return servers.length > 0 ? servers : undefined;
}
