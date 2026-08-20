import { describe, expect, it } from "vitest";
import { createMemoryTransportPair } from "../../rpc/transport.js";
import { InMemoryConfigStore } from "../InMemoryConfigStore.js";
import { ConfigServer } from "../server/ConfigServer.js";
import { ConfigHandle } from "../client/ConfigHandle.js";

describe("config 域", () => {
	it("ConfigServer ↔ ConfigHandle 往返（upsert/get/setDefault/凭据存取）", async () => {
		const store = new InMemoryConfigStore();
		const [clientT, serverT] = createMemoryTransportPair();
		const server = new ConfigServer(store);
		await server.start(serverT);
		const handle = new ConfigHandle(clientT);

		await handle.mutate({
			op: "model.upsert",
			profileId: "p1",
			profile: {
				provider: "openai",
				model: "deepseek-v4-flash",
				baseUrl: "https://api.deepseek.com/v1",
				credentialRef: "deepseek",
			},
		});
		await handle.mutate({ op: "credential.save", ref: "deepseek", secret: "sk-xxx" });

		const snapshot = await handle.get();
		expect(snapshot.profiles).toHaveLength(1);
		expect(snapshot.profiles[0].model).toBe("deepseek-v4-flash");
		expect(snapshot.defaultProfileId).toBe("p1");
		expect(snapshot.credentials.deepseek).toBe("present");

		await handle.mutate({ op: "credential.delete", ref: "deepseek" });
		const after = await handle.get();
		expect(after.credentials.deepseek).toBeUndefined();

		// test 往返（无密钥分支：不触网，验证 RPC expose 接线）
		expect(await handle.test({ provider: "openai" })).toEqual({
			ok: false,
			error: "缺少 API 密钥——请填写密钥或提供凭据引用",
		});

		handle.dispose();
		await server.close();
	});

	it("resolveSecret 宿主侧解析凭据明文（存储层专用，不经 ConfigApi）", async () => {
		const store = new InMemoryConfigStore();
		await store.mutate({
			op: "model.upsert",
			profileId: "p1",
			profile: { provider: "openai", model: "m", credentialRef: "deepseek" },
		});
		await store.mutate({ op: "credential.save", ref: "deepseek", secret: "sk-xxx" });

		expect(await store.resolveSecret("deepseek")).toBe("sk-xxx");
		expect(await store.resolveSecret("missing")).toBeUndefined();
		await store.mutate({ op: "credential.delete", ref: "deepseek" });
		expect(await store.resolveSecret("deepseek")).toBeUndefined();
	});

	it("runtime.set 往返 + model.remove 引用清理", async () => {
		const store = new InMemoryConfigStore();
		await store.mutate({
			op: "model.upsert",
			profileId: "p1",
			profile: { provider: "openai", model: "m1", credentialRef: "a" },
		});
		await store.mutate({
			op: "model.upsert",
			profileId: "p2",
			profile: { provider: "anthropic", model: "m2", credentialRef: "b" },
		});

		await store.mutate({
			op: "runtime.set",
			runtime: {
				fastProfileId: "p1",
				samplingDefaults: { temperature: 0.8, thinking: "high", maxTokens: 8192 },
				agents: { Explore: { profileId: "fast", maxTokens: 2048 }, novel: { profileId: "p1" } },
				compaction: { t1Ratio: 0.7, t2CapRatio: 0.92, summaryMaxTokens: 2048 },
			},
		});
		let snapshot = await store.get();
		expect(snapshot.runtime).toEqual({
			fastProfileId: "p1",
			samplingDefaults: { temperature: 0.8, thinking: "high", maxTokens: 8192 },
			agents: { Explore: { profileId: "fast", maxTokens: 2048 }, novel: { profileId: "p1" } },
			compaction: { t1Ratio: 0.7, t2CapRatio: 0.92, summaryMaxTokens: 2048 },
		});

		// 非法 runtime.set 抛错且不落（原值保持）
		await expect(
			store.mutate({ op: "runtime.set", runtime: { samplingDefaults: { temperature: 9 } } } as never),
		).rejects.toThrow("temperature");
		expect((await store.get()).runtime?.samplingDefaults.temperature).toBe(0.8);

		// 删除被 fast/agent 引用的 profile：引用清理，其余覆盖保留
		await store.mutate({ op: "model.remove", profileId: "p1" });
		snapshot = await store.get();
		expect(snapshot.runtime?.fastProfileId).toBeUndefined();
		expect(snapshot.runtime?.agents).toEqual({ Explore: { profileId: "fast", maxTokens: 2048 } });
	});

	it("model.upsert 能力覆盖校验与往返", async () => {
		const store = new InMemoryConfigStore();
		await store.mutate({
			op: "model.upsert",
			profileId: "p1",
			profile: {
				provider: "openai",
				model: "m1",
				credentialRef: "a",
				capabilities: {
					maxOutputTokens: 16384,
					contextWindowTokens: 1_000_000,
					thinkingMode: "none",
					supportsTemperature: true,
				},
			},
		});
		const snapshot = await store.get();
		expect(snapshot.profiles[0].capabilities).toEqual({
			maxOutputTokens: 16384,
			contextWindowTokens: 1_000_000,
			thinkingMode: "none",
			supportsTemperature: true,
		});

		await expect(
			store.mutate({
				op: "model.upsert",
				profileId: "p2",
				profile: {
					provider: "openai",
					model: "m2",
					credentialRef: "a",
					capabilities: { maxOutputTokens: -5 },
				},
			}),
		).rejects.toThrow("maxOutputTokens");
	});
});
