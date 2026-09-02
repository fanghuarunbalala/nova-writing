/**
 * connectionTest：/models 轻量探活——2xx 成功 / 状态码中文归因 / 超时 /
 * 网络异常分类；testConnection 的凭据解析（apiKey 优先 → credentialRef 解密）。
 */
import { describe, expect, it } from "vitest";
import { InMemoryConfigStore } from "../InMemoryConfigStore.js";
import { testConnection, testProviderConnection } from "../connectionTest.js";

type FetchMock = (url: string | URL | RequestInfo, init?: RequestInit) => Promise<Response>;

interface RecordedCall {
	url: string
	headers: Record<string, string>
}

function recordCalls(mock: (response: () => Response) => Promise<Response>): {
	calls: RecordedCall[]
	fetch: FetchMock
} {
	const calls: RecordedCall[] = []
	const fetch: FetchMock = async (url, init) => {
		calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> })
		return mock(() => new Response(null, { status: 200 }))
	}
	return { calls, fetch }
}

function statusMock(status: number): FetchMock {
	return async () => new Response(null, { status })
}

describe("testProviderConnection", () => {
	it("2xx 视为成功；openai 兼容走 Bearer 头 + baseUrl 尾斜杠归一", async () => {
		const { calls, fetch } = recordCalls(async (make) => make())
		const result = await testProviderConnection(
			{ provider: "openai", baseUrl: "https://api.deepseek.com/v1/", apiKey: "sk-x" },
			fetch as unknown as typeof fetch,
		)
		expect(result).toEqual({ ok: true })
		expect(calls[0]?.url).toBe("https://api.deepseek.com/v1/models")
		expect(calls[0]?.headers.Authorization).toBe("Bearer sk-x")
	})

	it("anthropic 走 x-api-key + version 头；baseUrl 缺省兜底官方地址", async () => {
		const { calls, fetch } = recordCalls(async (make) => make())
		const result = await testProviderConnection(
			{ provider: "anthropic", apiKey: "sk-ant" },
			fetch as unknown as typeof fetch,
		)
		expect(result).toEqual({ ok: true })
		expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/models")
		expect(calls[0]?.headers["x-api-key"]).toBe("sk-ant")
		expect(calls[0]?.headers["anthropic-version"]).toBe("2023-06-01")
	})

	it("401 → 密钥无效；404 → Base URL 提示；429 → 限流提示", async () => {
		const unauthorized = await testProviderConnection(
			{ provider: "openai", apiKey: "bad" },
			statusMock(401),
		)
		expect(unauthorized).toEqual({ ok: false, error: "密钥无效或无访问权限（HTTP 401）" })

		const notFound = await testProviderConnection(
			{ provider: "openai", baseUrl: "https://wrong.example/v1", apiKey: "sk" },
			statusMock(404),
		)
		expect(notFound).toEqual({ ok: false, error: "端点不存在（HTTP 404）——请检查 Base URL" })

		const limited = await testProviderConnection({ provider: "openai", apiKey: "sk" }, statusMock(429))
		expect(limited).toEqual({ ok: false, error: "触发限流（HTTP 429），请稍后重试" })
	})

	it("网络层异常 → ProviderError 网络分类中文文案", async () => {
		const failing: FetchMock = async () => {
			throw new TypeError("fetch failed")
		}
		const result = await testProviderConnection(
			{ provider: "openai", apiKey: "sk" },
			failing as unknown as typeof fetch,
		)
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.error).toContain("网络错误")
	})

	it("超时（abort）→ 中文超时提示", async () => {
		const hanging: FetchMock = (_url, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => {
					const error = new Error("The operation was aborted")
					error.name = "AbortError"
					reject(error)
				})
			})
		const result = await testProviderConnection(
			{ provider: "openai", apiKey: "sk", timeoutMs: 20 },
			hanging as unknown as typeof fetch,
		)
		expect(result).toEqual({
			ok: false,
			error: "连接超时（0 秒无响应）——请检查网络或 Base URL",
		})
	})
})

describe("testConnection（ConfigApi.test 服务端实现）", () => {
	it("credentialRef 经 store.resolveSecret 解密后探活", async () => {
		const store = new InMemoryConfigStore()
		await store.mutate({ op: "credential.save", ref: "default", secret: "sk-stored" })
		const { calls, fetch } = recordCalls(async (make) => make())
		const result = await testConnection(
			store,
			{ provider: "openai", credentialRef: "default" },
			fetch as unknown as typeof fetch,
		)
		expect(result).toEqual({ ok: true })
		expect(calls[0]?.headers.Authorization).toBe("Bearer sk-stored")
	})

	it("apiKey 直传优先于 credentialRef", async () => {
		const store = new InMemoryConfigStore()
		await store.mutate({ op: "credential.save", ref: "default", secret: "sk-stored" })
		const { calls, fetch } = recordCalls(async (make) => make())
		await testConnection(
			store,
			{ provider: "openai", apiKey: "sk-direct", credentialRef: "default" },
			fetch as unknown as typeof fetch,
		)
		expect(calls[0]?.headers.Authorization).toBe("Bearer sk-direct")
	})

	it("无密钥且无凭据引用 → 明确中文提示；凭据引用无密钥同理", async () => {
		const store = new InMemoryConfigStore()
		const missing = await testConnection(store, { provider: "openai" }, statusMock(200))
		expect(missing).toEqual({ ok: false, error: "缺少 API 密钥——请填写密钥或提供凭据引用" })

		await store.mutate({
			op: "model.upsert",
			profileId: "p1",
			profile: { provider: "openai", model: "m", credentialRef: "empty" },
		})
		const empty = await testConnection(store, { provider: "openai", credentialRef: "empty" }, statusMock(200))
		expect(empty).toEqual({ ok: false, error: "该凭据引用尚未保存密钥" })
	})
})
