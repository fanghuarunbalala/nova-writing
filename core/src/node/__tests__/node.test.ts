import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { NodeWorkspaceStoreLocator } from "../workspace/NodeWorkspaceStoreLocator.js";
import { NodeApplicationConfigStore } from "../config/NodeApplicationConfigStore.js";
import type { CredentialCipher } from "../../config/CredentialCipher.js";

describe("node 宿主", () => {
	it("NodeWorkspaceStoreLocator.resolve 派生 id + 可读 storeDir 名", async () => {
		const locator = new NodeWorkspaceStoreLocator({ storageRoot: "/root/storage" });
		const loc = await locator.resolve("/projects/novel");
		expect(loc.workspaceId).toHaveLength(12);
		// 目录名 = <父目录小写>-<项目名>--<hash8>（hash8 = workspaceId 前 8 位）
		expect(loc.storeDir).toBe(join("/root/storage", `projects-novel--${loc.workspaceId.slice(0, 8)}`));
	});

	it("NodeWorkspaceStoreLocator.resolve 中文路径 + Windows 非法字符清洗", async () => {
		const locator = new NodeWorkspaceStoreLocator({ storageRoot: "/root/storage" });
		const loc = await locator.resolve("C:\\Users\\u\\Downloads\\小说-debug-2");
		expect(basename(loc.storeDir)).toBe(`downloads-小说-debug-2--${loc.workspaceId.slice(0, 8)}`);
		// 盘符冒号等非法字符 → "-"，目录段不含 Windows 保留字符
		const unsafe = await locator.resolve("D:\\workplace\\我的:项目");
		expect(basename(unsafe.storeDir)).toBe(`workplace-我的-项目--${unsafe.workspaceId.slice(0, 8)}`);
		expect(basename(unsafe.storeDir)).not.toMatch(/[<>:"/\\|?*]/);
	});

	it("NodeApplicationConfigStore 落盘 + 重载（凭据经 cipher 加密）", async () => {
		const dir = await mkdtemp(join(tmpdir(), "novel-config-"));
		const filePath = join(dir, "config.json");
		const cipher: CredentialCipher = {
			encrypt: async (s: string) => `enc:${s}`,
			decrypt: async (s: string) => s.replace(/^enc:/, ""),
		};
		const store = new NodeApplicationConfigStore({ filePath, cipher });
		await store.load();
		await store.mutate({
			op: "model.upsert",
			profileId: "p1",
			profile: { provider: "openai", model: "m", credentialRef: "c1" },
		});
		await store.mutate({ op: "credential.save", ref: "c1", secret: "sk" });

		const store2 = new NodeApplicationConfigStore({ filePath, cipher });
		await store2.load();
		const snapshot = await store2.get();
		expect(snapshot.profiles).toHaveLength(1);
		expect(snapshot.credentials.c1).toBe("present");
	});
});
