import { describe, expect, it } from "vitest";
import type { ConfigSnapshot } from "../contract.js";
import {
	FAST_PROFILE_REF,
	parseRuntimeSettingsEnv,
	removeProfileReferences,
	resolveRuntimeAgents,
	validateRuntimeSettings,
} from "../runtimeSettings.js";

function snapshotOf(overrides: Partial<ConfigSnapshot> = {}): ConfigSnapshot {
	return {
		profiles: [
			{
				id: "p1",
				provider: "openai",
				model: "deepseek-v4-flash",
				baseUrl: "https://api.deepseek.com/v1",
				credentialRef: "deepseek",
				capabilities: { contextWindowTokens: 200_000 },
			},
			{ id: "p2", provider: "anthropic", model: "claude-opus-5", credentialRef: "anthropic" },
		],
		defaultProfileId: "p2",
		credentials: { deepseek: "present", anthropic: "present" },
		diagnostics: { logLevel: "info" },
		...overrides,
	};
}

const secrets: Record<string, string> = { deepseek: "sk-ds", anthropic: "sk-ant" };
const resolveSecret = async (ref: string): Promise<string | undefined> => secrets[ref];

describe("validateRuntimeSettings", () => {
	it("合法全量配置归一通过", () => {
		const out = validateRuntimeSettings(
			{
				fastProfileId: "p1",
				samplingDefaults: { temperature: 0.7, thinking: "medium", maxTokens: 4096 },
				agents: {
					novel: { profileId: "p2", thinking: "high" },
					Explore: { profileId: FAST_PROFILE_REF, maxTokens: 2048 },
				},
				compaction: { t1Ratio: 0.6, t2CapRatio: 0.9, summaryMaxTokens: 1024 },
			},
			["p1", "p2"],
		);
		expect(out.fastProfileId).toBe("p1");
		expect(out.samplingDefaults).toEqual({ temperature: 0.7, thinking: "medium", maxTokens: 4096 });
		expect(out.agents.Explore).toEqual({ profileId: "fast", maxTokens: 2048 });
		expect(out.compaction).toEqual({ t1Ratio: 0.6, t2CapRatio: 0.9, summaryMaxTokens: 1024 });
	});

	it("温度越界 / 非法思考档位 / 非正整数 抛错", () => {
		expect(() =>
			validateRuntimeSettings({ samplingDefaults: { temperature: 3 } }, []),
		).toThrow("temperature");
		expect(() =>
			validateRuntimeSettings({ agents: { novel: { thinking: "ultra" } } }, []),
		).toThrow("thinking");
		expect(() =>
			validateRuntimeSettings({ samplingDefaults: { maxTokens: -1 } }, []),
		).toThrow("maxTokens");
	});

	it("T1 ≥ T2 抛错", () => {
		expect(() =>
			validateRuntimeSettings({ compaction: { t1Ratio: 0.92, t2CapRatio: 0.9 } }, []),
		).toThrow("t1Ratio");
	});

	it("profileId 引用未知 profile 抛错（fast 保留值豁免）", () => {
		expect(() =>
			validateRuntimeSettings({ agents: { novel: { profileId: "ghost" } } }, ["p1"]),
		).toThrow("未知 profile");
		expect(() =>
			validateRuntimeSettings({ fastProfileId: "ghost" }, ["p1"]),
		).toThrow("fastProfileId");
		expect(() =>
			validateRuntimeSettings({ agents: { novel: { profileId: FAST_PROFILE_REF } } }, ["p1"]),
		).not.toThrow();
	});

	it("未知 agentType 静默丢弃（向前兼容）", () => {
		const out = validateRuntimeSettings(
			{ agents: { novel: { thinking: "low" }, Future: { thinking: "high" } } },
			[],
		);
		expect(Object.keys(out.agents)).toEqual(["novel"]);
	});
});

describe("removeProfileReferences", () => {
	it("摘除指向被删 profile 的 fastProfileId 与 agents 覆盖（其余字段保留）", () => {
		const cleaned = removeProfileReferences(
			{
				fastProfileId: "p1",
				samplingDefaults: {},
				agents: {
					Explore: { profileId: "p1", maxTokens: 2048 },
					novel: { profileId: "p2", thinking: "low" },
				},
				compaction: {},
			},
			"p1",
		);
		expect(cleaned?.fastProfileId).toBeUndefined();
		expect(cleaned?.agents.Explore).toEqual({ maxTokens: 2048 });
		expect(cleaned?.agents.novel).toEqual({ profileId: "p2", thinking: "low" });
	});

	it("仅剩 profileId 的空覆盖整项移除", () => {
		const cleaned = removeProfileReferences(
			{
				samplingDefaults: {},
				agents: { Explore: { profileId: "p1" } },
				compaction: {},
			},
			"p1",
		);
		expect(cleaned?.agents).toEqual({});
	});
});

describe("resolveRuntimeAgents", () => {
	it("无 runtime 配置：三 Agent 全走默认 profile + 默认采样（high/8192）", async () => {
		const out = await resolveRuntimeAgents(snapshotOf(), resolveSecret);
		for (const t of ["novel", "Explore", "Compose"]) {
			expect(out.agents[t]).toMatchObject({
				provider: "anthropic",
				model: "claude-opus-5",
				apiKey: "sk-ant",
				thinking: "high",
				maxTokens: 8192,
			});
		}
		expect(out.modelInfos).toEqual([
			{ model: "deepseek-v4-flash", capabilities: { contextWindowTokens: 200_000 } },
		]);
	});

	it("Explore 走 Fast 档：绑定 profile 连接 + 覆盖采样", async () => {
		const snapshot = snapshotOf({
			runtime: {
				fastProfileId: "p1",
				samplingDefaults: { temperature: 0.5 },
				agents: { Explore: { profileId: FAST_PROFILE_REF, maxTokens: 2048, thinking: "low" } },
				compaction: { t1Ratio: 0.6 },
			},
		});
		const out = await resolveRuntimeAgents(snapshot, resolveSecret);
		expect(out.agents.Explore).toMatchObject({
			provider: "openai",
			model: "deepseek-v4-flash",
			baseUrl: "https://api.deepseek.com/v1",
			apiKey: "sk-ds",
			thinking: "low",
			maxTokens: 2048,
		});
		// novel 未覆盖：默认 profile + 全局默认温度
		expect(out.agents.novel).toMatchObject({
			provider: "anthropic",
			model: "claude-opus-5",
			temperature: 0.5,
			thinking: "high",
		});
		expect(out.compaction).toEqual({ t1Ratio: 0.6 });
	});

	it("覆盖引用凭据缺失的 profile → 回落默认 profile", async () => {
		const snapshot = snapshotOf({
			runtime: {
				samplingDefaults: {},
				agents: { novel: { profileId: "p1" } },
				compaction: {},
			},
		});
		const out = await resolveRuntimeAgents(snapshot, async (ref) =>
			ref === "anthropic" ? "sk-ant" : undefined,
		);
		expect(out.agents.novel).toMatchObject({
			provider: "anthropic",
			model: "claude-opus-5",
			apiKey: "sk-ant",
		});
	});

	it("覆盖引用已不存在的 profile → 回落默认 profile", async () => {
		const snapshot = snapshotOf({
			runtime: {
				samplingDefaults: {},
				agents: { Compose: { profileId: "ghost" } },
				compaction: {},
			},
		});
		const out = await resolveRuntimeAgents(snapshot, resolveSecret);
		expect(out.agents.Compose).toMatchObject({ provider: "anthropic", model: "claude-opus-5" });
	});

	it("无任何 profile：agents 为空（子进程回落 env 默认）", async () => {
		const snapshot = snapshotOf({
			profiles: [],
			credentials: {},
			runtime: undefined,
		});
		const out = await resolveRuntimeAgents(snapshot, resolveSecret);
		expect(out.agents).toEqual({});
		expect(out.modelInfos).toEqual([]);
	});
});

describe("parseRuntimeSettingsEnv（子进程侧）", () => {
	it("resolveRuntimeAgents 产物 JSON 往返", async () => {
		const snapshot = snapshotOf({
			runtime: {
				fastProfileId: "p1",
				samplingDefaults: { temperature: 1.2 },
				agents: { Explore: { profileId: FAST_PROFILE_REF } },
				compaction: { t1Ratio: 0.7, t2CapRatio: 0.92, summaryMaxTokens: 2048 },
			},
		});
		const resolved = await resolveRuntimeAgents(snapshot, resolveSecret);
		const parsed = parseRuntimeSettingsEnv(JSON.stringify(resolved));
		expect(parsed?.agents.Explore).toEqual(resolved.agents.Explore);
		expect(parsed?.agents.novel).toEqual(resolved.agents.novel);
		expect(parsed?.compaction).toEqual(resolved.compaction);
		expect(parsed?.modelInfos).toEqual(resolved.modelInfos);
	});

	it("缺省/空白/非法 JSON/非对象 返回 undefined", () => {
		expect(parseRuntimeSettingsEnv(undefined)).toBeUndefined();
		expect(parseRuntimeSettingsEnv("")).toBeUndefined();
		expect(parseRuntimeSettingsEnv("  ")).toBeUndefined();
		expect(parseRuntimeSettingsEnv("{broken")).toBeUndefined();
		expect(parseRuntimeSettingsEnv("[]")).toBeUndefined();
	});

	it("单条目非法字段静默收敛（缺 thinking/maxTokens 回落省略，非法 capabilities 跳过）", () => {
		const parsed = parseRuntimeSettingsEnv(
			JSON.stringify({
				agents: {
					novel: { model: 123 },
					Explore: {
						model: "deepseek-v4-flash",
						provider: "anthropic",
						thinking: "ultra",
						maxTokens: "2048",
					},
				},
				modelInfos: [{ model: "m", capabilities: { maxOutputTokens: -1 } }],
			}),
		);
		// novel 条目缺 model 字符串 → 整条丢弃
		expect(parsed?.agents.novel).toBeUndefined();
		// Explore：thinking/maxTokens 类型不符 → 省略字段
		expect(parsed?.agents.Explore).toEqual({ model: "deepseek-v4-flash", provider: "anthropic" });
		// 非法能力条目跳过
		expect(parsed?.modelInfos).toEqual([]);
	});
});
