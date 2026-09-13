/**
 * 设置「Server」分类端到端（组件级，FR1）：连接状态指示、登录表单（固定 server：
 * 地址输入已退役，登录目标 = 已保存地址 > DefaultServerUrlContext 注入 > fallback）、
 * 当前 server 只读展示、设备列表与踢出、登出回退。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ConfigSnapshot, ServerAuthState, ServerDeviceInfo } from "@novel/core";
import { SettingsDialog } from "../../src/settings/SettingsDialog.js";
import { ApplicationSettingsStore } from "../../src/settings/ApplicationSettingsStore.js";
import { DefaultServerUrlContext } from "../../src/shared/DefaultServerUrlContext.js";
import type { ApplicationConfigurationClient } from "../../src/settings/ApplicationConfigurationClient.js";

function makeClient(options?: {
	authState?: ServerAuthState;
	devices?: ServerDeviceInfo[];
	loginError?: string;
}): ApplicationConfigurationClient & {
	serverLogin: ReturnType<typeof vi.fn>;
	serverLogout: ReturnType<typeof vi.fn>;
	serverKickDevice: ReturnType<typeof vi.fn>;
} {
	const snapshot = { profiles: [], credentials: {}, diagnostics: { logLevel: "info" } } as unknown as ConfigSnapshot;
	let authState: ServerAuthState = options?.authState ?? { status: "unconfigured" };
	const loggedIn: ServerAuthState = { status: "online", url: "http://127.0.0.1:8787", username: "alice", deviceId: "dev_pc" };
	return {
		load: vi.fn(async () => snapshot),
		mutate: vi.fn(async () => {}),
		serverAuth: vi.fn(async () => authState),
		serverLogin: vi.fn(async () => {
			if (options?.loginError !== undefined) throw new Error(options.loginError);
			authState = loggedIn;
			return authState;
		}),
		serverLogout: vi.fn(async () => {
			authState = { status: "unconfigured" };
			return authState;
		}),
		serverDevices: vi.fn(async () => options?.devices ?? []),
		serverKickDevice: vi.fn(async () => {}),
	};
}

function openPanel(client: ApplicationConfigurationClient, defaultServerUrl?: string): void {
	render(
		<DefaultServerUrlContext.Provider value={defaultServerUrl}>
			<SettingsDialog
				open
				store={new ApplicationSettingsStore()}
				configuration={client}
				onDismiss={() => {}}
			/>
		</DefaultServerUrlContext.Provider>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Server" }));
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("设置「Server」面板", () => {
	it("未配置：显示未配置状态 + 登录表单（无地址输入，server 只读展示 fallback）", async () => {
		openPanel(makeClient());
		expect(await screen.findByText(/未配置（登录后使用云端项目）/)).toBeTruthy();
		// 固定 server：地址输入已退役；当前 server 只读展示（无注入 → fallback）
		expect(screen.queryByLabelText(/server 地址/)).toBeNull();
		expect(screen.getByText((_, el) => el?.textContent === "server：http://127.0.0.1:8787（固定，随构建分发）" && el.tagName === "P")).toBeTruthy();
		expect(screen.getByLabelText(/^用户名$/)).toBeTruthy();
		expect(screen.getByRole("button", { name: /登录/ })).toBeTruthy();
	});

	it("注入地址：serverLogin 打到注入值 + 只读展示注入值", async () => {
		const client = makeClient();
		openPanel(client, "http://121.43.61.81:8080");
		await screen.findByText(/未配置/);
		expect(screen.getByText((_, el) => el?.textContent === "server：http://121.43.61.81:8080（固定，随构建分发）" && el.tagName === "P")).toBeTruthy();
		fireEvent.change(screen.getByLabelText(/^用户名$/), { target: { value: "alice" } });
		fireEvent.change(screen.getByLabelText(/^密码$/), { target: { value: "pw12345678" } });
		fireEvent.click(screen.getByRole("button", { name: /登录/ }));
		await waitFor(() => expect(client.serverLogin).toHaveBeenCalledWith("http://121.43.61.81:8080", "alice", "pw12345678"));
	});

	it("登录：无注入 → serverLogin 收到 fallback 地址（凭据修剪）", async () => {
		const client = makeClient();
		openPanel(client);
		await screen.findByText(/未配置/);
		fireEvent.change(screen.getByLabelText(/^用户名$/), { target: { value: " alice " } });
		fireEvent.change(screen.getByLabelText(/^密码$/), { target: { value: "pw12345678" } });
		fireEvent.click(screen.getByRole("button", { name: /登录/ }));
		await waitFor(() => expect(client.serverLogin).toHaveBeenCalledWith("http://127.0.0.1:8787", "alice", "pw12345678"));
		// 登录成功后切到在线视图（状态行被 <strong> 拆分，按段落整体匹配）
		expect(
			await screen.findByText((_, el) => el?.textContent === "状态：在线（alice）" && el.tagName === "P"),
		).toBeTruthy();
		// 密码不回显
		expect((screen.queryByLabelText(/^密码$/) as HTMLInputElement | null)?.value ?? "").toBe("");
	});

	it("登录失败：错误信息可见", async () => {
		const client = makeClient();
		client.serverLogin = vi.fn(async () => {
			throw new Error("用户名或密码错误");
		});
		openPanel(client);
		await screen.findByText(/未配置/);
		fireEvent.change(screen.getByLabelText(/^用户名$/), { target: { value: "alice" } });
		fireEvent.change(screen.getByLabelText(/^密码$/), { target: { value: "pw12345678" } });
		fireEvent.click(screen.getByRole("button", { name: /登录/ }));
		expect(await screen.findByText(/登录失败：用户名或密码错误/)).toBeTruthy();
	});

	it("在线态：用户名 + 设备列表 + 踢出（本机无踢出按钮）", async () => {
		const client = makeClient({
			authState: { status: "online", url: "http://127.0.0.1:8787", username: "alice", deviceId: "dev_pc" },
			devices: [
				{ id: "dev_pc", name: "桌面端", created_at: 1, last_seen_at: 2, active_sessions: 1 },
				{ id: "dev_phone", name: "手机", created_at: 1, last_seen_at: 2, active_sessions: 0 },
			],
		});
		openPanel(client);
		// 状态行被 <strong> 拆分：按段落整体文本匹配
		expect(
			await screen.findByText((_, el) => el?.textContent === "状态：在线（alice）" && el.tagName === "P"),
		).toBeTruthy();
		expect(await screen.findByText("手机 · 离线")).toBeTruthy();
		expect(screen.getByText("桌面端（本机） · 在线")).toBeTruthy();
		// 本机无踢出按钮，手机有
		expect(screen.queryByRole("button", { name: /踢出.*桌面端/ })).toBeNull();
		fireEvent.click(screen.getAllByRole("button", { name: /踢出/ })[0]!);
		await waitFor(() => expect(client.serverKickDevice).toHaveBeenCalledWith("dev_phone"));
	});

	it("需重登（复用检测）：状态提示", async () => {
		openPanel(makeClient({ authState: { status: "online", url: "http://x", needRelogin: true } }));
		expect(await screen.findByText(/登录已失效，请重新登录/)).toBeTruthy();
	});

	it("登出：serverLogout 调用 + 回到未登录视图", async () => {
		const client = makeClient({
			authState: { status: "online", url: "http://127.0.0.1:8787", username: "alice", deviceId: "dev_pc" },
		});
		openPanel(client);
		expect(
			await screen.findByText((_, el) => el?.textContent === "状态：在线（alice）" && el.tagName === "P"),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /登出/ }));
		await waitFor(() => expect(client.serverLogout).toHaveBeenCalledTimes(1));
	});
});
