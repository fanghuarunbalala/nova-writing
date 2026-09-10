import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeApplicationConfigStore } from "../NodeApplicationConfigStore.js";

const plaintextCipher = {
	encrypt: async (secret: string) => secret,
	decrypt: async (ciphertext: string) => ciphertext,
};

const tempDirs: string[] = [];

async function tempStore(
	options: Partial<{ onMutated: () => void }> = {},
): Promise<{ store: NodeApplicationConfigStore; filePath: string }> {
	const dir = await mkdtemp(join(tmpdir(), "novel-config-test-"));
	tempDirs.push(dir);
	const filePath = join(dir, "config.json");
	const store = new NodeApplicationConfigStore({ filePath, cipher: plaintextCipher, ...options });
	await store.load();
	return { store, filePath };
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("NodeApplicationConfigStore", () => {
	it("runtime 设置持久化往返（新实例 load 回读）", async () => {
		const { store, filePath } = await tempStore();
		await store.mutate({
			op: "model.upsert",
			profileId: "p1",
			profile: { provider: "openai", model: "m1", credentialRef: "a" },
		});
		await store.mutate({
			op: "runtime.set",
			runtime: {
				fastProfileId: "p1",
				samplingDefaults: { temperature: 1.2, thinking: "high", maxTokens: 8192 },
				agents: { Explore: { profileId: "fast", thinking: "low" } },
				compaction: { t1Ratio: 0.65, t2CapRatio: 0.9, summaryMaxTokens: 1024 },
			},
		});

		const reloaded = new NodeApplicationConfigStore({ filePath, cipher: plaintextCipher });
		await reloaded.load();
		const snapshot = await reloaded.get();
		expect(snapshot.runtime).toEqual({
			fastProfileId: "p1",
			samplingDefaults: { temperature: 1.2, thinking: "high", maxTokens: 8192 },
			agents: { Explore: { profileId: "fast", thinking: "low" } },
			compaction: { t1Ratio: 0.65, t2CapRatio: 0.9, summaryMaxTokens: 1024 },
		});
	});

	it("旧版配置文件（无 runtime 字段）兼容加载", async () => {
		const { store, filePath } = await tempStore();
		await store.mutate({
			op: "model.upsert",
			profileId: "p1",
			profile: { provider: "openai", model: "m1", credentialRef: "a" },
		});
		// 手工去掉 runtime 字段模拟旧版落盘
		const raw = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
		delete raw.runtime;
		const { writeFile } = await import("node:fs/promises");
		await writeFile(filePath, JSON.stringify(raw), "utf8");

		const reloaded = new NodeApplicationConfigStore({ filePath, cipher: plaintextCipher });
		await reloaded.load();
		expect((await reloaded.get()).runtime).toBeUndefined();
	});

	it("落盘 runtime 非法时丢弃回退（profiles 不受影响）", async () => {
		const { store, filePath } = await tempStore();
		await store.mutate({
			op: "model.upsert",
			profileId: "p1",
			profile: { provider: "openai", model: "m1", credentialRef: "a" },
		});
		const { writeFile } = await import("node:fs/promises");
		const raw = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
		raw.runtime = { samplingDefaults: { temperature: 99 } };
		await writeFile(filePath, JSON.stringify(raw), "utf8");

		const reloaded = new NodeApplicationConfigStore({ filePath, cipher: plaintextCipher });
		await reloaded.load();
		const snapshot = await reloaded.get();
		expect(snapshot.runtime).toBeUndefined();
		expect(snapshot.profiles).toHaveLength(1);
	});

	it("onMutated 在成功变更后回调（回调异常不影响变更）", async () => {
		const onMutated = vi.fn(async () => {
			throw new Error("host callback boom");
		});
		const { store } = await tempStore({ onMutated });
		await store.mutate({
			op: "model.upsert",
			profileId: "p1",
			profile: { provider: "openai", model: "m1", credentialRef: "a" },
		});
		await store.mutate({ op: "runtime.set", runtime: { samplingDefaults: {}, agents: {}, compaction: {} } });
		expect(onMutated).toHaveBeenCalledTimes(2);
		// 回调抛错不阻断：变更已生效
		expect((await store.get()).runtime).toEqual({ samplingDefaults: {}, agents: {}, compaction: {} });
	});

	it("model.remove 清理 runtime 引用并落盘", async () => {
		const { store, filePath } = await tempStore();
		await store.mutate({
			op: "model.upsert",
			profileId: "p1",
			profile: { provider: "openai", model: "m1", credentialRef: "a" },
		});
		await store.mutate({
			op: "model.upsert",
			profileId: "p2",
			profile: { provider: "openai", model: "m2", credentialRef: "b" },
		});
		await store.mutate({
			op: "runtime.set",
			runtime: {
				fastProfileId: "p1",
				samplingDefaults: {},
				agents: { Explore: { profileId: "p1" } },
				compaction: {},
			},
		});
		await store.mutate({ op: "model.remove", profileId: "p1" });

		const reloaded = new NodeApplicationConfigStore({ filePath, cipher: plaintextCipher });
		await reloaded.load();
		expect((await reloaded.get()).runtime).toEqual({
			samplingDefaults: {},
			agents: {},
			compaction: {},
		});
	});
});
