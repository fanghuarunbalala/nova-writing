/**
 * 连接测试（ConfigApi.test 实现）：向 provider 的 /models 端点发一次带鉴权的
 * 轻量 GET，验证 baseUrl 可达 + API 密钥有效。任意 2xx 即成功（不解析 body——
 * OpenAI / Anthropic / DeepSeek 等 OpenAI 兼容端点均支持该路径）。
 * 失败按 ProviderError 分类语义化为中文提示，不携带密钥等敏感内容。
 */

import type { ProviderType } from "../runtime/provider/types.js"
import { toProviderError } from "../runtime/provider/errors.js"
import type { ConfigStore } from "./store.js"
import type { ConnectionTestInput, ConnectionTestResult } from "./contract.js"

/** 各 provider 缺省 baseUrl（与官方 SDK 默认一致） */
const DEFAULT_BASE_URLS: Readonly<Record<ProviderType, string>> = {
	openai: "https://api.openai.com/v1",
	anthropic: "https://api.anthropic.com/v1",
}

/** 连接超时（ms） */
const TIMEOUT_MS = 8_000

/** HTTP 状态 → 中文失败原因（对齐 ProviderError 分类语义） */
function messageForStatus(status: number): string {
	if (status === 401 || status === 403) return `密钥无效或无访问权限（HTTP ${status}）`
	if (status === 402) return "账户费用不足（HTTP 402）"
	if (status === 404) return "端点不存在（HTTP 404）——请检查 Base URL"
	if (status === 429) return "触发限流（HTTP 429），请稍后重试"
	if (status >= 500) return `服务商服务端错误（HTTP ${status}）`
	return `请求被拒绝（HTTP ${status}）`
}

/** 直连测试输入（密钥已知；timeoutMs 供测试注入缩短等待） */
interface DirectTestInput {
	readonly provider: ProviderType
	readonly baseUrl?: string
	readonly apiKey: string
	readonly timeoutMs?: number
}

/**
 * 直连测试：GET {base}/models + AbortController 超时。
 * @param input provider / baseUrl / apiKey（明文）/ timeoutMs（缺省 8s）
 * @param fetchImpl fetch 实现（测试注入 mock）
 * @returns 测试结果（失败附中文原因）
 */
export async function testProviderConnection(
	input: DirectTestInput,
	fetchImpl: typeof fetch = fetch,
): Promise<ConnectionTestResult> {
	const timeoutMs = input.timeoutMs ?? TIMEOUT_MS
	const base = (input.baseUrl?.trim() || DEFAULT_BASE_URLS[input.provider]).replace(/\/+$/, "")
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)
	try {
		const response = await fetchImpl(`${base}/models`, {
			method: "GET",
			signal: controller.signal,
			headers:
				input.provider === "anthropic"
					? { "x-api-key": input.apiKey, "anthropic-version": "2023-06-01" }
					: { Authorization: `Bearer ${input.apiKey}` },
		})
		if (response.ok) return { ok: true }
		return { ok: false, error: messageForStatus(response.status) }
	} catch (raw) {
		// 超时触发的 abort 语义化为超时提示；其余按 ProviderError 分类取文案
		if (raw instanceof Error && raw.name === "AbortError") {
			return {
				ok: false,
				error: `连接超时（${Math.round(timeoutMs / 1000)} 秒无响应）——请检查网络或 Base URL`,
			}
		}
		const error = toProviderError(raw, input.provider)
		return { ok: false, error: error.message }
	} finally {
		clearTimeout(timer)
	}
}

/**
 * ConfigApi.test 服务端实现：apiKey 直传优先，缺省经 store.resolveSecret
 * 解密已存凭据（明文只在 server 进程内停留，不经 RPC 回传）。
 * @param store config 存储（凭据解析）
 * @param input 测试输入
 * @param fetchImpl fetch 实现（测试注入 mock）
 * @returns 测试结果（失败附中文原因）
 */
export async function testConnection(
	store: ConfigStore,
	input: ConnectionTestInput,
	fetchImpl: typeof fetch = fetch,
): Promise<ConnectionTestResult> {
	let apiKey = input.apiKey?.trim()
	if (apiKey === undefined || apiKey === "") {
		if (input.credentialRef === undefined) {
			return { ok: false, error: "缺少 API 密钥——请填写密钥或提供凭据引用" }
		}
		const stored = await store.resolveSecret(input.credentialRef)
		if (stored === undefined) {
			return { ok: false, error: "该凭据引用尚未保存密钥" }
		}
		apiKey = stored
	}
	return testProviderConnection(
		{ provider: input.provider, baseUrl: input.baseUrl, apiKey },
		fetchImpl,
	)
}
