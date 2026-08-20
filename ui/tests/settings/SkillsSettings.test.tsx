/**
 * 设置「技能」分类端到端（组件级）：打开设置 → 切到技能 → 生效/禁用分组展示 →
 * 点击禁用落 skills.setDisabled → 空态提示目录与安装方式。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SkillsListResult } from "@novel/core";
import { SettingsDialog } from "../../src/settings/SettingsDialog.js";
import { ApplicationSettingsStore } from "../../src/settings/ApplicationSettingsStore.js";
import type { ApplicationConfigurationClient } from "../../src/settings/ApplicationConfigurationClient.js";

function makeResult(overrides?: Partial<SkillsListResult>): SkillsListResult {
  return {
    appRoot: "/app/skills",
    projectRoot: "/ws/skills",
    skills: [
      {
        name: "suspense",
        description: "悬疑伏笔写作技法",
        source: "project",
        dir: "/ws/skills/suspense",
        disabled: false,
      },
      {
        name: "wuxia",
        description: "武侠招式描写规范",
        source: "app",
        dir: "/app/skills/wuxia",
        disabled: true,
      },
    ],
    errors: [],
    ...overrides,
  };
}

function makeClient(result: SkillsListResult): ApplicationConfigurationClient {
  return {
    load: async () =>
      ({
        profiles: [],
        credentials: {},
        diagnostics: { logLevel: "info" },
        skillsDisabled: result.skills.filter((s) => s.disabled).map((s) => s.name),
      }) as never,
    mutate: vi.fn(async () => {}),
    skillsList: vi.fn(async () => result),
  };
}

describe("SkillsSettings", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists effective and disabled skills grouped, toggling disables via skills.setDisabled", async () => {
    const result = makeResult();
    const client = makeClient(result);
    render(
      <SettingsDialog
        open
        store={new ApplicationSettingsStore()}
        configuration={client}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Skill" }));

    // 分组展示：生效中 + 已禁用（「已禁用」同时出现在分组标题与卡片标签，取多处匹配）
    expect(await screen.findByText("生效中")).toBeDefined();
    expect(screen.getAllByText("已禁用").length).toBeGreaterThan(0);
    expect(screen.getByText("suspense")).toBeDefined();
    expect(screen.getByText("悬疑伏笔写作技法")).toBeDefined();
    expect(screen.getByText("武侠招式描写规范")).toBeDefined();
    expect(screen.getByText(/共 2 项技能/)).toBeDefined();

    // 点击「禁用 suspense」→ 落库（合并名单：wuxia 保持 + suspense 新增）
    fireEvent.click(screen.getByRole("button", { name: "禁用 suspense" }));
    await waitFor(() => {
      expect(client.mutate).toHaveBeenCalledWith({
        op: "skills.setDisabled",
        names: ["wuxia", "suspense"],
      });
    });
    expect(await screen.findByText(/已禁用「suspense」，对新会话生效/)).toBeDefined();
  });

  it("shows empty state with directory paths and npx hint when no skills installed", async () => {
    const client = makeClient(makeResult({ skills: [] }));
    render(
      <SettingsDialog
        open
        store={new ApplicationSettingsStore()}
        configuration={client}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Skill" }));

    expect((await screen.findAllByText("未发现技能包")).length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("/app/skills")).toBeDefined();
    expect(screen.getByDisplayValue("/ws/skills")).toBeDefined();
    expect(screen.getByText(/npx skills add/)).toBeDefined();
  });

  it("falls back to 未装配 when skillsList is not wired", async () => {
    const client = {
      load: async () =>
        ({ profiles: [], credentials: {}, diagnostics: { logLevel: "info" } }) as never,
      mutate: async () => {},
    } as ApplicationConfigurationClient;
    render(
      <SettingsDialog
        open
        store={new ApplicationSettingsStore()}
        configuration={client}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Skill" }));
    expect(await screen.findByText(/技能系统未装配/)).toBeDefined();
  });
});
