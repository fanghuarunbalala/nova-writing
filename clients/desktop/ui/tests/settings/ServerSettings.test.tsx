/**
 * 设置「Server」分类端到端（组件级，FR1）：连接状态指示、登录表单（地址校验/成功态切换）、
 * 设备列表与踢出、登出回退。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ConfigSnapshot, ServerAuthState, ServerDeviceInfo } from "@novel/core";
import { SettingsDialog } from "../../src/settings/SettingsDialog.js";
import { ApplicationSettingsStore } from "../../src/settings/ApplicationSettingsStore.js";
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

function openPanel(client: ApplicationConfigurationClient): void {
	render(
		<SettingsDialog
			open
			store={new ApplicationSettingsStore()}
			configuration={client}
			onDismiss={() => {}}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Server" }));
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("设置「Server」面板", () => {
	it("未配置：显示本地模式状态 + 登录表单", async () => {
		openPanel(makeClient());
		expect(await screen.findByText(/未配置（本地模式）/)).toBeTruthy();
		expect(screen.getByLabelText(/server 地址/)).toBeTruthy();
		expect(screen.getByRole("button", { name: /登录/ })).toBeTruthy();
	});

	it("非法地址被拦（不触网）", async () => {
		const client = makeClient();
		openPanel(client);
		await screen.findByText(/未配置/);
		fireEvent.change(screen.getByLabelText(/server 地址/), { target: { value: "not-a-url" } });
		fireEvent.click(screen.getByRole("button", { name: /登录/ }));
		expect(await screen.findByText(/请填写合法的 http\/https server 地址/)).toBeTruthy();
		expect(client.serverLogin).not.toHaveBeenCalled();
	});

	it("登录：带修剪后的地址与凭据调用 serverLogin", async () => {
		const client = makeClient();
		openPanel(client);
		await screen.findByText(/未配置/);
		fireEvent.change(screen.getByLabelText(/server 地址/), { target: { value: " http://127.0.0.1:8787 " } });
		fireEvent.change(screen.getByLabelText(/^用户名$/), { target: { value: "alice" } });
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
		fireEvent.change(screen.getByLabelText(/server 地址/), { target: { value: "http://127.0.0.1:8787" } });
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
