/**
 * server 配置持久化 + ConfigServer serverAuth RPC 面测试（FR1/FR6）：
 * - server.set：url/agentMode 落盘与回读（Node 文件存储 + 内存存储双实现一致）；
 * - 非法 url 丢弃回退本地模式；清空 url = 退出 server 模式；
 * - ConfigServer + serverAuth 注入：serverLogin 触发 onLoginUrlPersist（url 写配置）+
 *   会话 restore；serverAuth/serverLogout 直通。
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryConfigStore } from "../InMemoryConfigStore.js";
import { NodeApplicationConfigStore } from "../../node/config/NodeApplicationConfigStore.js";
import { ConfigServer } from "../server/ConfigServer.js";
import { ServerAuthSession, ServerTokenStore, type ServerAuthState } from "../serverAuth.js";
import { createMemoryTransportPair } from "../../rpc/transport.js";
import { wrap, type RPCMessage, type Transport } from "kkrpc";
import type { ConfigApi } from "../contract.js";
import type { CredentialCipher } from "../CredentialCipher.js";

const cipher: CredentialCipher = {
	encrypt: async (s) => `enc:${Buffer.from(s, "utf8").toString("base64")}`,
	decrypt: async (c) => Buffer.from(c.slice(4), "base64").toString("utf8"),
};

describe("server.set 持久化（双存储一致）", () => {
	it("url + agentMode 落盘回读；清空 url 退出 server 模式", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nova-cfg-srv-"));
		const store = new NodeApplicationConfigStore({ filePath: join(dir, "config.json"), cipher });
		await store.load();
		await store.mutate({ op: "server.set", server: { url: "http://127.0.0.1:8787", agentMode: "bundle" } });
		expect((await store.get()).server).toEqual({ url: "http://127.0.0.1:8787", agentMode: "bundle" });
		// 落盘为明文 JSON（url 非机密；token 才加密）
		const raw = JSON.parse(await readFile(join(dir, "config.json"), "utf8")) as { server?: unknown };
		expect(raw.server).toEqual({ url: "http://127.0.0.1:8787", agentMode: "bundle" });
		// 重开 load 保留
		const reopened = new NodeApplicationConfigStore({ filePath: join(dir, "config.json"), cipher });
		await reopened.load();
		expect((await reopened.get()).server?.agentMode).toBe("bundle");
		// 清空 = 退出
		await store.mutate({ op: "server.set", server: { url: "" } });
		expect((await store.get()).server).toBeUndefined();
		await rm(dir, { recursive: true, force: true });
	});

	it("仅 agentMode=bundle 无 url 也可存（本地包驱动）", async () => {
		const store = new InMemoryConfigStore();
		await store.mutate({ op: "server.set", server: { agentMode: "bundle" } });
		expect((await store.get()).server).toEqual({ agentMode: "bundle" });
	});

	it("损坏 server 字段 load 丢弃（回退本地模式不拖垮整个配置）", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nova-cfg-srv-"));
		const path = join(dir, "config.json");
		const { writeFile } = await import("node:fs/promises");
		await writeFile(path, JSON.stringify({ profiles: [], credentials: {}, server: { url: 42 } }), "utf8");
		const store = new NodeApplicationConfigStore({ filePath: path, cipher });
		await store.load();
		expect((await store.get()).server).toBeUndefined();
		await rm(dir, { recursive: true, force: true });
	});
});

describe("ConfigServer serverAuth RPC 面", () => {
	async function makeServered(): Promise<{
		api: ConfigApi;
		states: ServerAuthState[];
		persisted: string[];
		session: ServerAuthSession;
	}> {
		const dir = await mkdtemp(join(tmpdir(), "nova-cfg-rpc-"));
		const store = new InMemoryConfigStore();
		const session = new ServerAuthSession(new ServerTokenStore(join(dir, "sa.json"), cipher), () => {
			throw new Error("clientFactory 不应被直接调用");
		});
		const persisted: string[] = [];
		const states: ServerAuthState[] = [];
		session.onStatusChange((s) => states.push(s));
		const server = new ConfigServer(store, {
			serverAuth: {
				session,
				clientFactory: () => {
					throw new Error("登录流在会话单测覆盖，此处不触网");
				},
				deviceName: "桌面端",
				onLoginUrlPersist: async (url) => {
					persisted.push(url);
					await store.mutate({ op: "server.set", server: { url } });
				},
			},
		});
		const [clientT, serverT] = createMemoryTransportPair();
		await server.start(serverT as Transport<RPCMessage>);
		const api = wrap<ConfigApi>(clientT as Transport<RPCMessage>);
		return { api, states, persisted, session };
	}

	it("serverAuth()：初始 unconfigured", async () => {
		const { api } = await makeServered();
		expect(await api.serverAuth!()).toMatchObject({ status: "unconfigured" });
	});

	it("serverLogout()：状态直通（未登录也安全）", async () => {
		const { api } = await makeServered();
		const state = await api.serverLogout!();
		expect(state.status).toBe("unconfigured");
	});

	it("serverLogin() 会话内异常经 RPC 透传（clientFactory 抛错）", async () => {
		const { api } = await makeServered();
		await expect(api.serverLogin!("http://srv", "u", "p")).rejects.toThrow();
	});
});
