/**
 * LoginPage 组件测试（登录门形态定稿）：表单三字段/推荐默认值、地址校验、
 * 登录与注册参数透传、错误横幅（防枚举/username_taken 文案原样）、成功态 用户名@server、
 * 跳过回调、老 main 进程降级（无 serverRegister 隐藏注册入口）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ServerAuthState } from "@novel/core";
import { LoginPage } from "../../src/auth/LoginPage.js";
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

function fillAndSubmit(url = "http://127.0.0.1:8787", username = "alice", password = "pw12345678"): void {
	fireEvent.change(screen.getByLabelText(/服务器地址/), { target: { value: url } });
	fireEvent.change(screen.getByLabelText(/用户名/), { target: { value: username } });
	fireEvent.change(screen.getByLabelText(/密码/), { target: { value: password } });
	fireEvent.click(screen.getByRole("button", { name: /登 录/ }));
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	localStorage.clear();
});

describe("LoginPage", () => {
	it("初始渲染：三字段 + 推荐默认地址 + 本地模式/注册次级入口 + 信任脚注", () => {
		render(<LoginPage configuration={makeClient()} onSkip={() => {}} onEnterWorkspace={() => {}} />);
		expect((screen.getByLabelText(/服务器地址/) as HTMLInputElement).value).toBe("http://127.0.0.1:8787");
		expect(screen.getByText("推荐 · 本机默认")).toBeTruthy();
		expect(screen.getByRole("button", { name: "暂不登录，本地模式使用" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "注册账号" })).toBeTruthy();
		expect(screen.getByText(/safeStorage/)).toBeTruthy();
	});

	it("地址非法被拦（不触网）；用户名/密码空拦", async () => {
		const client = makeClient();
		render(<LoginPage configuration={client} onSkip={() => {}} onEnterWorkspace={() => {}} />);
		fillAndSubmit("not-a-url");
		expect(await screen.findByRole("alert")).toHaveTextContent("服务器地址需为 http/https URL");
		fillAndSubmit("http://127.0.0.1:8787", "ab", "pw12345678");
		expect(await screen.findByRole("alert")).toHaveTextContent("请填写用户名");
		expect(client.serverLogin).not.toHaveBeenCalled();
	});

	it("登录：参数（修剪后）透传 serverLogin；成功 → 成功态 用户名@server + 进入工作台", async () => {
		const client = makeClient();
		const enter = vi.fn();
		render(<LoginPage configuration={client} onSkip={() => {}} onEnterWorkspace={enter} />);
		fillAndSubmit(" http://127.0.0.1:8787 ", " alice ", "pw12345678");
		await waitFor(() => expect(client.serverLogin).toHaveBeenCalledWith("http://127.0.0.1:8787", "alice", "pw12345678"));
		expect(await screen.findByText("已连接同步服务")).toBeTruthy();
		expect(screen.getByText("alice")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /进入工作台/ }));
		expect(enter).toHaveBeenCalledTimes(1);
	});

	it("登录失败：server 防枚举文案原样呈现（横幅 + 不进成功态）", async () => {
		const client = makeClient({ loginError: "用户名或密码错误" });
		render(<LoginPage configuration={client} onSkip={() => {}} onEnterWorkspace={() => {}} />);
		fillAndSubmit();
		expect(await screen.findByRole("alert")).toHaveTextContent("用户名或密码错误");
		expect(screen.queryByText("已连接同步服务")).toBeNull();
	});

	it("注册模式：切换后标题/文案/按钮变化，注册成功（newbie）进成功态", async () => {
		const client = makeClient();
		render(<LoginPage configuration={client} onSkip={() => {}} onEnterWorkspace={() => {}} />);
		fireEvent.click(screen.getByRole("button", { name: "注册账号" }));
		expect(screen.getByText("创建账号")).toBeTruthy();
		expect(screen.getByText("至少 8 位；建议混合字母与数字")).toBeTruthy();
		expect(screen.getByRole("button", { name: /注 册 并 登 录/ })).toBeTruthy();
		// 短密码被本地校验拦
		fillAndSubmit("http://127.0.0.1:8787", "newbie", "short");
		expect(await screen.findByRole("alert")).toHaveTextContent("密码至少 8 位");
		// 合法注册 → serverRegister 透传 + 成功态
		fillAndSubmit("http://127.0.0.1:8787", "newbie", "pw12345678");
		await waitFor(() => expect(client.serverRegister).toHaveBeenCalledWith("http://127.0.0.1:8787", "newbie", "pw12345678"));
		expect(await screen.findByText("newbie")).toBeTruthy();
		// 返回登录链接仍在注册模式时可见；成功态后消失
		expect(screen.queryByRole("button", { name: /返回登录/ })).toBeNull();
	});

	it("注册失败：username_taken 文案原样", async () => {
		const client = makeClient({ registerError: "用户名已存在" });
		render(<LoginPage configuration={client} onSkip={() => {}} onEnterWorkspace={() => {}} />);
		fireEvent.click(screen.getByRole("button", { name: "注册账号" }));
		fillAndSubmit("http://127.0.0.1:8787", "dup", "pw12345678");
		expect(await screen.findByRole("alert")).toHaveTextContent("用户名已存在");
	});

	it("注册后返回登录：模式回切 + 错误清除", async () => {
		const client = makeClient();
		render(<LoginPage configuration={client} onSkip={() => {}} onEnterWorkspace={() => {}} />);
		fireEvent.click(screen.getByRole("button", { name: "注册账号" }));
		fillAndSubmit("http://127.0.0.1:8787", "x", "short");
		expect(await screen.findByRole("alert")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /返回登录/ }));
		expect(screen.getByText("登录同步服务")).toBeTruthy();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("跳过：onSkip 调用（记忆由宿主处理）", () => {
		const skip = vi.fn();
		render(<LoginPage configuration={makeClient()} onSkip={skip} onEnterWorkspace={() => {}} />);
		fireEvent.click(screen.getByRole("button", { name: "暂不登录，本地模式使用" }));
		expect(skip).toHaveBeenCalledTimes(1);
	});

	it("老 main 进程降级：无 serverRegister → 注册入口隐藏；无 serverLogin → 按钮禁用", () => {
		const client = makeClient({ supportRegister: false }) as ApplicationConfigurationClient & { serverLogin: ReturnType<typeof vi.fn> };
		const noLogin = { ...client, serverLogin: undefined } as unknown as ApplicationConfigurationClient;
		render(<LoginPage configuration={client} onSkip={() => {}} onEnterWorkspace={() => {}} />);
		expect(screen.queryByRole("button", { name: "注册账号" })).toBeNull();
		cleanup();
		render(<LoginPage configuration={noLogin} onSkip={() => {}} onEnterWorkspace={() => {}} />);
		expect(screen.getByRole("button", { name: /登 录/ })).toBeDisabled();
	});

	it("已在线重开（欢迎页入口）：直接呈现成功态", async () => {
		render(
			<LoginPage
				configuration={makeClient({ authState: { status: "online", url: "http://192.168.1.5:8787", username: "alice" } })}
				onSkip={() => {}}
				onEnterWorkspace={() => {}}
			/>,
		);
		expect(await screen.findByText("已连接同步服务")).toBeTruthy();
		expect(screen.getByText(/192\.168\.1\.5/)).toBeTruthy();
	});
});
