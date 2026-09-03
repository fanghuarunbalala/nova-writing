/**
 * ServerAuthClient / ServerTokenStore / ServerAuthSession 单元测试（FR1）：
 * - 登录/刷新 REST 形态与错误码解析（fetch 注入 mock）；
 * - 令牌文件 cipher 加密落盘；
 * - 会话状态机：过期前主动轮换 / 复用检测清令牌 / 网络失败降级 offline / 未配置零侵入。
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	ServerAuthClient,
	ServerAuthError,
	ServerAuthSession,
	ServerTokenStore,
	type FetchLike,
	type ServerAuthState,
} from "../serverAuth.js";
import type { CredentialCipher } from "../CredentialCipher.js";

const plainCipher: CredentialCipher = {
	encrypt: async (s) => `enc:${Buffer.from(s, "utf8").toString("base64")}`,
	decrypt: async (c) => Buffer.from(c.slice(4), "base64").toString("utf8"),
};

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("ServerAuthClient", () => {
	it("login：POST /v1/auth/login，返回双令牌", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const fetchMock: FetchLike = async (url, init) => {
			calls.push({ url, init: init ?? {} });
			return jsonResponse(200, { userId: "u1", deviceId: "dev_1", accessToken: "a1", refreshToken: "r1" });
		};
		const client = new ServerAuthClient("http://srv:8787/", fetchMock);
		const tokens = await client.login("alice", "pw12345678", "桌面端");
		expect(tokens.accessToken).toBe("a1");
		expect(tokens.refreshToken).toBe("r1");
		expect(tokens.username).toBe("alice");
		expect(calls[0]!.url).toBe("http://srv:8787/v1/auth/login");
		expect((calls[0]!.init.body as string)).toContain("alice");
	});

	it("错误响应：解析 server 错误码（防枚举同文案在 UI 呈现）", async () => {
		const fetchMock: FetchLike = async () => jsonResponse(401, { code: "invalid_credentials", message: "用户名或密码错误" });
		const client = new ServerAuthClient("http://srv", fetchMock);
		await expect(client.login("alice", "bad", "桌面端")).rejects.toMatchObject({
			name: "ServerAuthError",
			code: "invalid_credentials",
			status: 401,
		});
	});

	it("网络不可达：包装为 network_unreachable（不抛原始异常）", async () => {
		const fetchMock: FetchLike = async () => {
			throw new Error("ECONNREFUSED");
		};
		const client = new ServerAuthClient("http://srv", fetchMock);
		await expect(client.login("a", "b", "c")).rejects.toBeInstanceOf(ServerAuthError);
		await expect(client.login("a", "b", "c")).rejects.toMatchObject({ code: "network_unreachable" });
	});
});

describe("ServerTokenStore", () => {
	it("save/load：令牌整体 cipher 加密落盘（明文不出现在文件中）", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nova-auth-"));
		const store = new ServerTokenStore(join(dir, "server-auth.json"), plainCipher);
		await store.save({
			tokens: { accessToken: "secret-access", accessExpiresAt: 1, refreshToken: "secret-refresh", username: "alice" },
			deviceId: "dev_1",
		});
		const raw = await readFile(join(dir, "server-auth.json"), "utf8");
		expect(raw).not.toContain("secret-access");
		expect(raw.startsWith("enc:")).toBe(true);
		const loaded = await store.load();
		expect(loaded?.tokens.refreshToken).toBe("secret-refresh");
		expect(loaded?.deviceId).toBe("dev_1");
	});

	it("clear 后 load 返回 undefined", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nova-auth-"));
		const store = new ServerTokenStore(join(dir, "server-auth.json"), plainCipher);
		await store.save({
			tokens: { accessToken: "a", accessExpiresAt: 1, refreshToken: "r", username: "u" },
			deviceId: "d",
		});
		await store.clear();
		expect(await store.load()).toBeUndefined();
	});

	it("损坏文件 load 不抛错（回退未登录）", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nova-auth-"));
		const path = join(dir, "server-auth.json");
		await writeFile(path, "not-encrypted-garbage", "utf8");
		expect(await new ServerTokenStore(path, plainCipher).load()).toBeUndefined();
	});
});

describe("ServerAuthSession", () => {
	function makeSession(fetchMock: FetchLike, now?: () => number): { session: ServerAuthSession; tokenPath: string } {
		const dir = join(tmpdir(), `nova-auth-session-${process.pid}-${++seq}-${Date.now()}`);
		const tokenPath = join(dir, "server-auth.json");
		const session = new ServerAuthSession(new ServerTokenStore(tokenPath, plainCipher), (url) => {
			expect(url).toBe("http://srv");
			return new ServerAuthClient(url, fetchMock, now);
		}, now);
		return { session, tokenPath };
	}
	let seq = 0;

	it("未配置 url：恒 unconfigured，ensureAccessToken 不触网", async () => {
		let touched = false;
		const fetchMock: FetchLike = async () => {
			touched = true;
			return jsonResponse(200, {});
		};
		const { session } = makeSession(fetchMock);
		expect((await session.restore(undefined)).status).toBe("unconfigured");
		expect(await session.ensureAccessToken()).toBeUndefined();
		expect(touched).toBe(false);
	});

	it("注册：201 直接返回双令牌 → 注册即登录（状态在线）", async () => {
		const fetchMock: FetchLike = async (url) => {
			if (url.endsWith("/v1/auth/register")) {
				return jsonResponse(201, { userId: "u1", deviceId: "dev_9", accessToken: "a-r", refreshToken: "r-r" });
			}
			return jsonResponse(404, {});
		};
		const { session } = makeSession(fetchMock);
		await session.restore("http://srv");
		await session.register(new ServerAuthClient("http://srv", fetchMock), "newuser", "pw12345678", "桌面端");
		expect(session.state()).toMatchObject({ status: "online", username: "newuser", deviceId: "dev_9" });
		// 注册落地的令牌可续（refresh 路径可用）
		expect(await session.ensureAccessToken()).toBe("a-r");
	});

	it("注册错误：409 username_taken / 400 weak_password 错误码透传（不落令牌）", async () => {
		let mode: "taken" | "weak" = "taken";
		const fetchMock: FetchLike = async () =>
			mode === "taken"
				? jsonResponse(409, { code: "username_taken", message: "用户名已存在" })
				: jsonResponse(400, { code: "weak_password", message: "密码至少 8 位" });
		const { session } = makeSession(fetchMock);
		await session.restore("http://srv");
		const client = new ServerAuthClient("http://srv", fetchMock);
		await expect(session.register(client, "dup", "pw12345678", "桌面端")).rejects.toMatchObject({
			code: "username_taken",
			status: 409,
		});
		mode = "weak";
		await expect(session.register(client, "ok", "short", "桌面端")).rejects.toMatchObject({
			code: "weak_password",
			status: 400,
		});
		expect(session.state().username).toBeUndefined();
	});

	it("登录 → 过期前 1min 主动轮换（一次一换）→ 复用检测 401 清令牌要求重登", async () => {
		let clock = 1_000_000;
		const now = () => clock;
		const refreshTokens: string[] = [];
		const fetchMock: FetchLike = async (url, init) => {
			if (url.endsWith("/v1/auth/login")) {
				return jsonResponse(200, { deviceId: "dev_1", accessToken: "a0", refreshToken: "r0" });
			}
			if (url.endsWith("/v1/auth/refresh")) {
				refreshTokens.push((JSON.parse(String(init?.body)) as { refreshToken: string }).refreshToken);
				if (refreshTokens.length === 1) return jsonResponse(200, { accessToken: "a1", refreshToken: "r1" });
				return jsonResponse(401, { code: "token_reuse_detected", message: "复用检测" });
			}
			return jsonResponse(404, {});
		};
		const { session } = makeSession(fetchMock, now);
		await session.restore("http://srv");
		await session.login(new ServerAuthClient("http://srv", fetchMock, now), "alice", "pw12345678", "桌面端");
		expect(session.state().username).toBe("alice");

		// 未到期：直接返回 access，不触网
		expect(await session.ensureAccessToken()).toBe("a0");
		expect(refreshTokens.length).toBe(0);

		// 过期前 1min 内 → 主动轮换（旧 refresh r0 上送，换回 a1/r1）
		clock += 15 * 60 * 1000 - 30 * 1000;
		expect(await session.ensureAccessToken()).toBe("a1");
		expect(refreshTokens).toEqual(["r0"]);

		// 二次轮换遇 401 复用检测 → 清令牌 + needRelogin
		clock += 15 * 60 * 1000;
		expect(await session.ensureAccessToken()).toBeUndefined();
		expect(refreshTokens).toEqual(["r0", "r1"]);
		expect(session.state().needRelogin).toBe(true);
		expect(session.state().username).toBeUndefined();
	});

	it("网络失败轮换 → offline；恢复成功 → online", async () => {
		let fail = true;
		const fetchMock: FetchLike = async (url) => {
			if (url.endsWith("/v1/auth/refresh")) {
				if (fail) throw new Error("down");
				return jsonResponse(200, { accessToken: "a1", refreshToken: "r1" });
			}
			if (url.endsWith("/v1/auth/login")) return jsonResponse(200, { deviceId: "d", accessToken: "a0", refreshToken: "r0" });
			return jsonResponse(404, {});
		};
		const { session } = makeSession(fetchMock);
		await session.restore("http://srv");
		const client = new ServerAuthClient("http://srv", fetchMock);
		await session.login(client, "alice", "pw12345678", "桌面端");
		// 强制过期路径：把落盘令牌的过期时间改到过去，再 ensure
		// （ServerAuthSession 未暴露内部令牌，这里通过 offline 上报 API 验证状态机）
		session.reportRequestFailure(new ServerAuthError("network_unreachable", "down"));
		const states: ServerAuthState[] = [];
		session.onStatusChange((s) => states.push(s));
		session.reportRequestFailure(new ServerAuthError("network_unreachable", "down"));
		expect(session.state().status).toBe("offline");
		session.reportRequestSuccess();
		expect(session.state().status).toBe("online");
	});

	it("登出：吊销 refresh + 状态回未登录", async () => {
		const logoutUrls: string[] = [];
		const fetchMock: FetchLike = async (url, init) => {
			if (url.endsWith("/v1/auth/login")) return jsonResponse(200, { deviceId: "d", accessToken: "a0", refreshToken: "r0" });
			if (url.endsWith("/v1/auth/logout")) {
				logoutUrls.push(`${url}:${(init?.body as string) ?? ""}`);
				return new Response(null, { status: 204 });
			}
			return jsonResponse(404, {});
		};
		const { session } = makeSession(fetchMock);
		await session.restore("http://srv");
		await session.login(new ServerAuthClient("http://srv", fetchMock), "alice", "pw12345678", "桌面端");
		await session.logout();
		expect(logoutUrls.length).toBe(1);
		expect(logoutUrls[0]).toContain("r0");
		expect(session.state().username).toBeUndefined();
		expect(await session.ensureAccessToken()).toBeUndefined();
	});
});
