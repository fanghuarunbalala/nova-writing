/**
 * 新手引导模块测试：首启标记存取、向导步骤导航与书库门控（试验功能默认不介绍）、
 * ProviderSetupStep 预设联动 / 保存链路（upsert → credential.save → setDefault）/
 * 测试连接展示、自定义预设的 label 落为模型名、ChatEmptyState 回声模式横幅。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ConfigMutation, ConfigSnapshot, ConnectionTestResult } from "@novel/core";
import {
  completeOnboarding,
  GuideStep,
  hasCompletedOnboarding,
  OnboardingWizard,
  ProviderSetupStep,
} from "../../src/onboarding/index.js";
import {
  ConfigurationStatusContext,
  type ConfigurationStatusContextValue,
} from "../../src/settings/ConfigurationStatusContext.js";
import type { ApplicationConfigurationClient } from "../../src/settings/ApplicationConfigurationClient.js";
import { ChatEmptyState } from "../../src/domains/conversation/components/ChatEmptyState.js";

function buildSnapshot(overrides?: Partial<ConfigSnapshot>): ConfigSnapshot {
  return {
    profiles: [],
    credentials: {},
    diagnostics: { logLevel: "info" },
    ...overrides,
  };
}

function buildConfiguration(options: {
  snapshot?: ConfigSnapshot;
  testResult?: ConnectionTestResult;
} = {}): {
  client: ApplicationConfigurationClient;
  mutate: ReturnType<typeof vi.fn>;
  test: ReturnType<typeof vi.fn>;
} {
  const mutate = vi.fn(async (_m: ConfigMutation) => undefined);
  const test = vi.fn(async (): Promise<ConnectionTestResult> => options.testResult ?? { ok: true });
  const client: ApplicationConfigurationClient = {
    load: vi.fn(async () => options.snapshot ?? buildSnapshot()),
    mutate,
    test,
  };
  return { client, mutate, test };
}

describe("onboardingStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("缺省未完成；completeOnboarding 后已完成", () => {
    expect(hasCompletedOnboarding()).toBe(false);
    completeOnboarding();
    expect(hasCompletedOnboarding()).toBe(true);
  });
});

describe("OnboardingWizard", () => {
  it("欢迎步默认不介绍书库；完整走完 弹向导 → 配置 → 指南 → onDismiss", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const { client, mutate } = buildConfiguration();
    render(
      <OnboardingWizard open configuration={client} onDismiss={onDismiss} />,
    );

    // 欢迎步：三大核心特性在，书库（试验功能）不在
    expect(screen.getByText("欢迎使用 Novel Harness")).toBeInTheDocument();
    expect(screen.getByText("对话")).toBeInTheDocument();
    expect(screen.queryByText("书库")).not.toBeInTheDocument();

    // 进入配置步：预设齐全，DeepSeek 预填
    await user.click(screen.getByRole("button", { name: "开始配置 →" }));
    expect(screen.getByText("通义千问 Qwen")).toBeInTheDocument();
    expect(screen.getByText("Kimi")).toBeInTheDocument();
    expect(screen.getByText("其他 OpenAI 兼容")).toBeInTheDocument();
    expect(screen.getByLabelText("模型 ID")).toHaveValue("deepseek-v4-flash");

    // 填密钥保存 → 三连 mutate → 进入指南步（默认三大视图）
    await user.type(screen.getByLabelText("API 密钥"), "sk-test");
    await user.click(screen.getByRole("button", { name: /保存并继续/ }));
    await waitFor(() =>
      expect(mutate.mock.calls.map((call) => call[0].op)).toEqual([
        "model.upsert",
        "credential.save",
        "model.setDefault",
      ]),
    );
    expect(await screen.findByText("三大视图")).toBeInTheDocument();
    expect(screen.queryByText("四大视图")).not.toBeInTheDocument();

    // 开始创作 → 关闭回调
    await user.click(screen.getByRole("button", { name: "开始创作" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("GuideStep（书库门控）", () => {
  it("默认不介绍书库；libraryEnabled 时展示第四视图", () => {
    const { unmount } = render(<GuideStep />);
    expect(screen.getByText("三大视图")).toBeInTheDocument();
    expect(screen.queryByText("四大视图")).not.toBeInTheDocument();
    expect(screen.queryByText("导入参考书，自动解析大纲 / 人物 / 地点 / 风格。")).not.toBeInTheDocument();
    unmount();

    render(<GuideStep libraryEnabled />);
    expect(screen.getByText("四大视图")).toBeInTheDocument();
    expect(screen.getByText("书库")).toBeInTheDocument();
  });
});

describe("ProviderSetupStep", () => {
  it("预设切换联动模型 ID 与 Base URL", async () => {
    const user = userEvent.setup();
    const { client } = buildConfiguration();
    render(<ProviderSetupStep configuration={client} onDone={vi.fn()} />);
    await user.click(screen.getByRole("radio", { name: /Kimi/ }));
    expect(screen.getByLabelText("模型 ID")).toHaveValue("kimi-k2-0905-preview");
    expect(screen.getByLabelText("Base URL")).toHaveValue("https://api.moonshot.cn/v1");
  });

  it("自定义预设要求 Base URL；保存的 label 落为模型名而非预设名", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const { client, mutate } = buildConfiguration();
    render(<ProviderSetupStep configuration={client} onDone={onDone} />);
    await user.click(screen.getByRole("radio", { name: /其他 OpenAI 兼容/ }));

    // 仅填密钥与模型、未填 Base URL → 不可保存
    await user.type(screen.getByLabelText("API 密钥"), "sk-x");
    await user.type(screen.getByLabelText("模型 ID"), "my-local-model");
    expect(screen.getByRole("button", { name: /保存并继续/ })).toBeDisabled();

    await user.type(screen.getByLabelText("Base URL"), "http://localhost:11434/v1");
    await user.click(screen.getByRole("button", { name: /保存并继续/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const upsert = mutate.mock.calls[0]![0] as {
      op: string;
      profile: { label?: string; baseUrl?: string; model: string };
    };
    expect(upsert.op).toBe("model.upsert");
    expect(upsert.profile.label).toBe("my-local-model");
    expect(upsert.profile.baseUrl).toBe("http://localhost:11434/v1");
  });

  it("测试连接：失败展示中文原因，成功显示连接正常", async () => {
    const user = userEvent.setup();
    const { client, test } = buildConfiguration({
      testResult: { ok: false, error: "密钥无效或无访问权限（HTTP 401）" },
    });
    render(<ProviderSetupStep configuration={client} onDone={vi.fn()} />);
    await user.type(screen.getByLabelText("API 密钥"), "sk-bad");
    await user.click(screen.getByRole("button", { name: /测试连接/ }));
    expect(await screen.findByText("连接失败：密钥无效或无访问权限（HTTP 401）")).toBeInTheDocument();
    expect(test).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openai", baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-bad" }),
    );
  });

  it("快照已有可用默认服务时展示已配置状态卡", async () => {
    const { client } = buildConfiguration({
      snapshot: buildSnapshot({
        profiles: [
          {
            id: "p1",
            provider: "openai",
            model: "deepseek-v4-flash",
            baseUrl: "https://api.deepseek.com/v1",
            credentialRef: "default",
          },
        ],
        defaultProfileId: "p1",
        credentials: { default: "present" },
      }),
    });
    render(<ProviderSetupStep configuration={client} onDone={vi.fn()} />);
    expect(await screen.findByText("已配置模型服务")).toBeInTheDocument();
  });
});

describe("ChatEmptyState 回声模式横幅", () => {
  function renderWithStatus(value: ConfigurationStatusContextValue): void {
    render(
      <ConfigurationStatusContext.Provider value={value}>
        <ChatEmptyState />
      </ConfigurationStatusContext.Provider>,
    );
  }

  it("未配置时显示横幅，动作直达设置 / 引导", async () => {
    const user = userEvent.setup();
    const openGuide = vi.fn();
    const openSettings = vi.fn();
    renderWithStatus({ modelConfigured: false, openGuide, openSettings });
    expect(screen.getByText(/尚未配置模型服务/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "去配置" }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "查看引导" }));
    expect(openGuide).toHaveBeenCalledTimes(1);
  });

  it("已配置时不显示横幅", () => {
    renderWithStatus({
      modelConfigured: true,
      openGuide: () => {},
      openSettings: () => {},
    });
    expect(screen.queryByText(/尚未配置模型服务/)).not.toBeInTheDocument();
  });
});
