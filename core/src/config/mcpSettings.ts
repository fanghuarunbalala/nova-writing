/**
 * MCP 服务器配置校验（config 域 mcpServers；store 双实现共用）。
 */
import type { McpServerInput } from "./contract.js";

/** 服务器名长度上限（sanitize 前的展示名） */
export const MCP_SERVER_NAME_MAX_LENGTH = 64;

/** URL 合法性校验（http/https） */
function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

/**
 * 校验 MCP 服务器 upsert 输入（名称/传输字段）。
 * @param server 待校验配置
 * @throws 非法时抛错（中文消息，对齐 validateRuntimeSettings 风格）
 */
export function validateMcpServerInput(server: McpServerInput): void {
	if (
		typeof server.name !== "string" ||
		server.name.trim().length === 0 ||
		server.name.length > MCP_SERVER_NAME_MAX_LENGTH
	) {
		throw new Error("MCP 服务器名称需为 1 – 64 字符");
	}
	if (typeof server.enabled !== "boolean" || typeof server.trusted !== "boolean") {
		throw new Error("MCP 服务器 enabled/trusted 需为布尔值");
	}
	if (server.transport.type === "stdio") {
		if (typeof server.transport.command !== "string" || server.transport.command.trim().length === 0) {
			throw new Error("stdio 传输的 command 不能为空");
		}
		if (
			!Array.isArray(server.transport.args) ||
			server.transport.args.some((a) => typeof a !== "string")
		) {
			throw new Error("stdio 传输的 args 需为字符串数组");
		}
	} else if (server.transport.type === "http") {
		if (!isHttpUrl(server.transport.url)) {
			throw new Error("http 传输的 url 需为合法的 http/https 地址");
		}
	} else {
		throw new Error("MCP 传输类型需为 stdio 或 http");
	}
}
