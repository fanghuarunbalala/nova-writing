import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeWorkspaceStoreLocator } from "../workspace/NodeWorkspaceStoreLocator.js";
import { NodeApplicationConfigStore } from "../config/NodeApplicationConfigStore.js";
import type { CredentialCipher } from "../../config/CredentialCipher.js";

describe("node 宿主", () => {
	it("NodeWorkspaceStoreLocator.resolve 派生 id + storeDir", async () => {
		const locator = new NodeWorkspaceStoreLocator({ storageRoot: "/root/storage" });
		const loc = await locator.resolve("/projects/novel");
		expect(loc.workspaceId).toBeTruthy();
		expect(loc.storeDir).toContain("storage");
		expect(loc.storeDir).toContain(loc.workspaceId);
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
