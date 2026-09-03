/**
 * NovelApp 启动路由：无 Workspace 时渲染选择页；打开后切到工作台壳。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NovelApp } from "../../src/app/NovelApp.js";
import { WorkspaceController } from "../../src/domains/workspace/controller/WorkspaceController.js";
import type { FrontendPlatform } from "../../src/platform/index.js";

const platform: FrontendPlatform = {
  capabilities: {
    fileSelection: false,
    clipboardRead: false,
    clipboardWrite: false,
    notifications: false,
  },
  files: { selectFiles: async () => [] },
  clipboard: {
    readText: async () => "",
    writeText: async () => undefined,
  },
  notifications: { show: async () => undefined },
};

function buildApi() {
  return {
    conversations: {
      list: vi.fn(async () => ({ conversations: [] })),
      listApprovals: vi.fn(async () => []),
      enqueueInput: vi.fn(async () => ({
        status: "accepted",
        conversationId: "conversation_x",
        inputEventId: "input_x",
        sequence: 1,
        acceptedAt: "2026-08-05T09:00:00.000Z",
      })),
      create: vi.fn(async () => ({
        getSnapshot: async () => ({
          metadata: {
            id: "conversation_new",
            workspaceId: "ws-1",
            rootConversationId: "conversation_new",
            status: "active",
            createdAt: "2026-08-05T09:00:00.000Z",
            updatedAt: "2026-08-05T09:00:00.000Z",
            lastJournalSequence: 0,
          },
          activeAgentBinding: {
            id: "b1",
            conversationId: "conversation_new",
            revision: 1,
            status: "active",
            createdAt: "2026-08-05T09:00:00.000Z",
            agentType: "novel",
            definitionVersion: "1.0.0",
          },
        }),
        close: async () => undefined,
      })),
      open: vi.fn(),
    },
    novel: {
      overview: {
        get: vi.fn(async () => ({
          schemaVersion: 1,
          scope: { kind: "canonical" },
          workspaceId: "ws-1",
          novelId: "novel_1",
          novelSchemaVersion: 1,
          sourceRevision: "r041",
          counts: {
            storyUnitCount: 0,
            characterCount: 0,
            locationCount: 0,
            volumeCount: 0,
            chapterCount: 0,
            manuscriptBlockCount: 0,
          },
          roots: {},
        })),
      },
      outline: {
        get: vi.fn(async () => ({
          schemaVersion: 1,
          scope: { kind: "canonical" },
          tree: { outline: { id: "o1", novelId: "novel_1" }, units: [] },
          progress: [],
        })),
        getStoryUnit: vi.fn(),
      },
      characters: {
        list: vi.fn(async () => ({
          schemaVersion: 1,
          scope: { kind: "canonical" },
          characters: [],
        })),
        get: vi.fn(),
      },
      locations: {
        list: vi.fn(async () => ({
          schemaVersion: 1,
          scope: { kind: "canonical" },
          locations: [],
        })),
        get: vi.fn(),
      },
      paragraphs: {
        getCatalog: vi.fn(async () => ({
          schemaVersion: 1,
          scope: { kind: "canonical" },
          paragraphs: [],
        })),
        get: vi.fn(),
      },
      publication: {
        getCatalog: vi.fn(async () => ({
          schemaVersion: 1,
          scope: { kind: "canonical" },
          volumes: [],
          chapters: [],
        })),
      },
    },
  } as never;
}

function buildController() {
  const picker = {
    pickWorkspace: vi.fn(async () => ({
      referenceId: "ref-1",
      label: "白昼计划",
    })),
  };
  const sessions = {
    listRecent: vi.fn(async () => [{ id: "ws-1", label: "白昼计划" }]),
    open: vi.fn(async () => ({ id: "ws-1", label: "白昼计划" })),
    close: vi.fn(async () => undefined),
  };
  const controller = new WorkspaceController({ picker, sessions });
  return { controller, picker, sessions };
}

describe("NovelApp launch routing", () => {
  it("renders the welcome page when no workspace is open", async () => {
    const { controller, sessions } = buildController();
    render(<NovelApp api={buildApi()} platform={platform} workspaceController={controller} />);
    // 欢迎页（demo 启动·项目选择页）：品牌区 + 最近项目 + 双入口
    expect(await screen.findByText("把一桩旧事，写成一本新书。")).toBeInTheDocument();
    expect(screen.getByText("最近的项目")).toBeInTheDocument();
    expect(screen.getByText("白昼计划")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建项目" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开其他项目…" })).toBeInTheDocument();
    expect(sessions.listRecent).toHaveBeenCalledTimes(1);
  });

  it("opens a recent workspace through the launch overlay and lands on the shell", async () => {
    const user = userEvent.setup();
    const { controller, sessions } = buildController();
    render(<NovelApp api={buildApi()} platform={platform} workspaceController={controller} />);
    // 卡片主体按钮名以书名开头（右上角删除钮 aria-label 为「删除项目 白昼计划」，^ 区分）
    await user.click(await screen.findByRole("button", { name: /^白昼计划/ }));
    expect(sessions.open).toHaveBeenCalledWith({
      referenceId: "ws-1",
      label: "白昼计划",
    });
    // 启动编排：分步加载遮罩出现（标题 + 步骤清单），完成后撤下并落在工作台
    expect(await screen.findByLabelText(/正在打开/)).toBeInTheDocument();
    expect(screen.getByText("载入大纲树")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "新建项目" }),
    ).not.toBeInTheDocument();
    await waitFor(
      () => expect(screen.queryByLabelText(/正在打开/)).not.toBeInTheDocument(),
      { timeout: 8000 },
    );
    expect(screen.getByText("Novel")).toBeInTheDocument();
  });
});

describe("NovelApp 首启引导门控（跨实例标记端口）", () => {
  const WIZARD_TITLE = "欢迎使用 Novel Harness";
  const ONBOARDING_KEY = "novel.onboarding.v1";

  function buildConfigurationClient() {
    return {
      load: vi.fn(async () => ({ profiles: [], credentials: {}, defaults: {} })),
      mutate: vi.fn(async () => undefined),
      runtimeStatus: vi.fn(async () => ({ providerLive: false })),
    } as never;
  }

  function renderApp(onboardingPort?: {
    isCompleted(): Promise<boolean>;
    markCompleted(): Promise<void>;
  }) {
    const { controller } = buildController();
    return render(
      <NovelApp
        api={buildApi()}
        platform={platform}
        workspaceController={controller}
        configurationClient={buildConfigurationClient()}
        {...(onboardingPort !== undefined ? { onboardingPort } : {})}
      />,
    );
  }

  it("端口报告已完成 → 不弹引导（多实例下第二实例不再重复弹）", async () => {
    localStorage.removeItem(ONBOARDING_KEY);
    renderApp({ isCompleted: async () => true, markCompleted: async () => undefined });
    await screen.findByText("把一桩旧事，写成一本新书。");
    expect(screen.queryByText(WIZARD_TITLE)).not.toBeInTheDocument();
  });

  it("端口未完成但 localStorage 已完成 → 迁移补写主进程标记，不弹", async () => {
    localStorage.setItem(ONBOARDING_KEY, "done");
    const markCompleted = vi.fn(async () => undefined);
    renderApp({ isCompleted: async () => false, markCompleted });
    await screen.findByText("把一桩旧事，写成一本新书。");
    await waitFor(() => expect(markCompleted).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(WIZARD_TITLE)).not.toBeInTheDocument();
    localStorage.removeItem(ONBOARDING_KEY);
  });

  it("端口未完成且无任何标记 → 弹引导", async () => {
    localStorage.removeItem(ONBOARDING_KEY);
    renderApp({ isCompleted: async () => false, markCompleted: async () => undefined });
    expect(await screen.findByText(WIZARD_TITLE)).toBeInTheDocument();
    localStorage.removeItem(ONBOARDING_KEY);
  });
});

describe("NovelApp 登录门（启动引导 · opt-in）", () => {
  const LOGIN_TITLE = "登录同步服务";
  const SKIP_KEY = "novel.login.skip.v1";
  const WELCOME_TAG = "把一桩旧事，写成一本新书。";

  function buildAuthClient(state: unknown) {
    return {
      load: vi.fn(async () => ({ profiles: [], credentials: {}, defaults: {} })),
      mutate: vi.fn(async () => undefined),
      serverAuth: vi.fn(async () => state),
      serverLogin: vi.fn(async () => state),
    } as never;
  }

  function renderApp(client: unknown) {
    const { controller } = buildController();
    return render(
      <NovelApp
        api={buildApi()}
        platform={platform}
        workspaceController={controller}
        configurationClient={client}
        onboardingPort={{ isCompleted: async () => true, markCompleted: async () => undefined }}
      />,
    );
  }

  afterEach(() => {
    localStorage.removeItem(SKIP_KEY);
  });

  it("未登录且未跳过 → 先见登录门（盖欢迎页）", async () => {
    renderApp(buildAuthClient({ status: "unconfigured" }));
    expect(await screen.findByRole("heading", { name: LOGIN_TITLE })).toBeInTheDocument();
    expect(screen.getByText("推荐 · 本机默认")).toBeInTheDocument();
  });

  it("跳过 → 记住标记 + 回到欢迎页；二次启动不再弹", async () => {
    renderApp(buildAuthClient({ status: "unconfigured" }));
    fireEvent.click(await screen.findByRole("button", { name: "暂不登录，本地模式使用" }));
    expect(await screen.findByText(WELCOME_TAG)).toBeInTheDocument();
    expect(localStorage.getItem(SKIP_KEY)).toBe("skipped");
    // 二次「启动」：已记住跳过 → 直接欢迎页
    cleanup();
    renderApp(buildAuthClient({ status: "unconfigured" }));
    expect(await screen.findByText(WELCOME_TAG)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: LOGIN_TITLE })).not.toBeInTheDocument();
  });

  it("已登录（online + username）→ 不弹门，欢迎页入口卡显示在线态", async () => {
    renderApp(buildAuthClient({ status: "online", url: "http://127.0.0.1:8787", username: "alice", deviceId: "d1" }));
    expect(await screen.findByText(WELCOME_TAG)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: LOGIN_TITLE })).not.toBeInTheDocument();
    expect(screen.getByText("已连接同步 · alice")).toBeInTheDocument();
  });

  it("曾配置过 server.url（登出态）→ 不拦（用户已知该功能）", async () => {
    renderApp(buildAuthClient({ status: "online", url: "http://127.0.0.1:8787" }));
    expect(await screen.findByText(WELCOME_TAG)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: LOGIN_TITLE })).not.toBeInTheDocument();
    // 未登录入口卡仍在（点击可重开登录门）
    expect(screen.getByRole("button", { name: /登录同步服务/ })).toBeInTheDocument();
  });

  it("欢迎页入口卡点击 → 重开登录门", async () => {
    localStorage.setItem(SKIP_KEY, "skipped");
    renderApp(buildAuthClient({ status: "unconfigured" }));
    expect(await screen.findByText(WELCOME_TAG)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /登录同步服务/ }));
    expect(await screen.findByRole("heading", { name: LOGIN_TITLE })).toBeInTheDocument();
    expect(localStorage.getItem(SKIP_KEY)).toBeNull();
  });
});
