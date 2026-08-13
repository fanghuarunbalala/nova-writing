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
});
