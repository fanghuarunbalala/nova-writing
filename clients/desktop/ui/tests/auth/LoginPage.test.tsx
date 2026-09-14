/**
 * LoginPage 组件测试（固定 server 形态）：表单去地址输入（用户名+密码）、
 * 登录目标优先级（已保存配置地址 > DefaultServerUrlContext 注入 > 本地 fallback）、
 * 登录与注册参数透传、错误横幅（防枚举/username_taken 文案原样）、成功态 用户名@host、
 * 老 main 进程降级（无 serverRegister 隐藏注册入口）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ServerAuthState } from "@novel/core";
import { LoginPage } from "../../src/auth/LoginPage.js";
import { DefaultServerUrlContext } from "../../src/shared/DefaultServerUrlContext.js";
import type { ApplicationConfigurationClient } from "../../src/settings/ApplicationConfigurationClient.js";

function makeClient(options?: {
	authState?: ServerAuthState;
	loginError?: string;
	registerError?: string;
	supportRegister?: boolean;
}): ApplicationConfigurationClient & {
	serverLogin: ReturnType<typeof vi.fn>;
	serverRegister?: ReturnType<typeof vi.fn>;
} {
	const authState: ServerAuthState = options?.authState ?? { status: "unconfigured" };
	const supportRegister = options?.supportRegister ?? true;
	return {
		load: vi.fn(async () => ({}) as never),
		mutate: vi.fn(async () => {}),
		serverAuth: vi.fn(async () => authState),
		serverLogin: vi.fn(async () => {
			if (options?.loginError !== undefined) throw new Error(options.loginError);
			return { status: "online" as const, url: "http://127.0.0.1:8787", username: "alice" };
		}),
		...(supportRegister
			? {
					serverRegister: vi.fn(async () => {
						if (options?.registerError !== undefined) throw new Error(options.registerError);
						return { status: "online" as const, url: "http://127.0.0.1:8787", username: "newbie" };
					}),
				}
			: {}),
	} as never;
}

function fillAndSubmit(username = "alice", password = "pw12345678"): void {
	fireEvent.change(screen.getByLabelText(/用户名/), { target: { value: username } });
	fireEvent.change(screen.getByLabelText(/密码/), { target: { value: password } });
	fireEvent.click(screen.getByRole("button", { name: /登 录/ }));
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	localStorage.clear();
});

describe("LoginPage（固定 server）", () => {
	it("初始渲染：无服务器地址输入，仅用户名+密码 + 注册次级入口 + 信任脚注", () => {
		render(<LoginPage configuration={makeClient()} onEnterWorkspace={() => {}} />);
		// 地址输入已退役（客户端固定server PRD FR3）
		expect(screen.queryByLabelText(/服务器地址/)).toBeNull();
		expect(screen.getByLabelText(/用户名/)).toBeTruthy();
		expect(screen.getByLabelText(/密码/)).toBeTruthy();
		// 纯云端化 ⑥：强制登录——本地模式跳过入口不存在
		expect(screen.queryByRole("button", { name: "暂不登录，本地模式使用" })).toBeNull();
		expect(screen.getByRole("button", { name: "注册账号" })).toBeTruthy();
		expect(screen.getByText(/safeStorage/)).toBeTruthy();
	});

	it("无注入时登录目标回退本地 fallback 常量；用户名/密码空拦（不触网）", async () => {
		const client = makeClient();
		render(<LoginPage configuration={client} onEnterWorkspace={() => {}} />);
		fillAndSubmit("ab", "pw12345678");
		expect(await screen.findByRole("alert")).toHaveTextContent("请填写用户名");
		fillAndSubmit("", "");
		expect(await screen.findByRole("alert")).toHaveTextContent("请填写用户名");
		expect(client.serverLogin).not.toHaveBeenCalled();
	});

	it("登录：无注入 → serverLogin 收到 fallback 地址；成功 → 成功态 用户名@host + 进入工作台", async () => {
		const client = makeClient();
		const enter = vi.fn();
		render(<LoginPage configuration={client} onEnterWorkspace={enter} />);
		fillAndSubmit(" alice ", "pw12345678");
		await waitFor(() => expect(client.serverLogin).toHaveBeenCalledWith("http://127.0.0.1:8787", "alice", "pw12345678"));
		expect(await screen.findByText("已连接同步服务")).toBeTruthy();
		expect(screen.getByText("alice")).toBeTruthy();
		expect(screen.getByText(/@127\.0\.0\.1:8787/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /进入工作台/ }));
		expect(enter).toHaveBeenCalledTimes(1);
	});

	it("注入优先：DefaultServerUrlContext 提供地址 → 登录/注册打到注入地址", async () => {
		const client = makeClient();
		render(
			<DefaultServerUrlContext.Provider value="http://121.43.61.81:8080">
				<LoginPage configuration={client} onEnterWorkspace={() => {}} />
			</DefaultServerUrlContext.Provider>,
		);
		fillAndSubmit("alice", "pw12345678");
		await waitFor(() =>
			expect(client.serverLogin).toHaveBeenCalledWith("http://121.43.61.81:8080", "alice", "pw12345678"),
		);
	});

	it("注入压过已保存：serverAuth 带旧 url + 注入存在 → 登录打到注入地址（僵尸配置可修）", async () => {
		const client = makeClient({ authState: { status: "unconfigured", url: "http://192.168.1.5:8787" } });
		render(
			<DefaultServerUrlContext.Provider value="http://121.43.61.81:8080">
				<LoginPage configuration={client} onEnterWorkspace={() => {}} />
			</DefaultServerUrlContext.Provider>,
		);
		await waitFor(() => expect(client.serverAuth).toHaveBeenCalledTimes(1));
		fillAndSubmit("alice", "pw12345678");
		await waitFor(() =>
			expect(client.serverLogin).toHaveBeenCalledWith("http://121.43.61.81:8080", "alice", "pw12345678"),
		);
	});

	it("无注入时已保存地址兜底：serverAuth 带 url → 登录打到已保存地址", async () => {
		const client = makeClient({ authState: { status: "unconfigured", url: "http://192.168.1.5:8787" } });
		render(<LoginPage configuration={client} onEnterWorkspace={() => {}} />);
		await waitFor(() => expect(client.serverAuth).toHaveBeenCalledTimes(1));
		fillAndSubmit("alice", "pw12345678");
		await waitFor(() =>
			expect(client.serverLogin).toHaveBeenCalledWith("http://192.168.1.5:8787", "alice", "pw12345678"),
		);
	});

	it("登录失败：server 防枚举文案原样呈现（横幅 + 不进成功态）", async () => {
		const client = makeClient({ loginError: "用户名或密码错误" });
		render(<LoginPage configuration={client} onEnterWorkspace={() => {}} />);
		fillAndSubmit();
		expect(await screen.findByRole("alert")).toHaveTextContent("用户名或密码错误");
		expect(screen.queryByText("已连接同步服务")).toBeNull();
	});

	it("注册模式：切换后标题/文案/按钮变化，注册成功（newbie）进成功态", async () => {
		const client = makeClient();
		render(<LoginPage configuration={client} onEnterWorkspace={() => {}} />);
		fireEvent.click(screen.getByRole("button", { name: "注册账号" }));
		expect(screen.getByText("创建账号")).toBeTruthy();
		expect(screen.getByText("至少 8 位；建议混合字母与数字")).toBeTruthy();
		expect(screen.getByRole("button", { name: /注 册 并 登 录/ })).toBeTruthy();
		// 短密码被本地校验拦
		fillAndSubmit("newbie", "short");
		expect(await screen.findByRole("alert")).toHaveTextContent("密码至少 8 位");
		// 合法注册 → serverRegister 透传 + 成功态
		fillAndSubmit("newbie", "pw12345678");
		await waitFor(() => expect(client.serverRegister).toHaveBeenCalledWith("http://127.0.0.1:8787", "newbie", "pw12345678"));
		expect(await screen.findByText("newbie")).toBeTruthy();
		// 返回登录链接仍在注册模式时可见；成功态后消失
		expect(screen.queryByRole("button", { name: /返回登录/ })).toBeNull();
	});

	it("注册失败：username_taken 文案原样", async () => {
		const client = makeClient({ registerError: "用户名已存在" });
		render(<LoginPage configuration={client} onEnterWorkspace={() => {}} />);
		fireEvent.click(screen.getByRole("button", { name: "注册账号" }));
		fillAndSubmit("dup", "pw12345678");
		expect(await screen.findByRole("alert")).toHaveTextContent("用户名已存在");
	});

	it("注册后返回登录：模式回切 + 错误清除", async () => {
		const client = makeClient();
		render(<LoginPage configuration={client} onEnterWorkspace={() => {}} />);
		fireEvent.click(screen.getByRole("button", { name: "注册账号" }));
		fillAndSubmit("x", "short");
		expect(await screen.findByRole("alert")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /返回登录/ }));
		expect(screen.getByText("登录同步服务")).toBeTruthy();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("老 main 进程降级：无 serverRegister → 注册入口隐藏；无 serverLogin → 按钮禁用", () => {
		const client = makeClient({ supportRegister: false }) as ApplicationConfigurationClient & { serverLogin: ReturnType<typeof vi.fn> };
		const noLogin = { ...client, serverLogin: undefined } as unknown as ApplicationConfigurationClient;
		render(<LoginPage configuration={client} onEnterWorkspace={() => {}} />);
		expect(screen.queryByRole("button", { name: "注册账号" })).toBeNull();
		cleanup();
		render(<LoginPage configuration={noLogin} onEnterWorkspace={() => {}} />);
		expect(screen.getByRole("button", { name: /登 录/ })).toBeDisabled();
	});

	it("已在线重开（欢迎页入口）：直接呈现成功态（host 展示）", async () => {
		render(
			<LoginPage
				configuration={makeClient({ authState: { status: "online", url: "http://192.168.1.5:8787", username: "alice" } })}
				onEnterWorkspace={() => {}}
			/>,
		);
		expect(await screen.findByText("已连接同步服务")).toBeTruthy();
		expect(screen.getByText(/192\.168\.1\.5:8787/)).toBeTruthy();
	});
});
