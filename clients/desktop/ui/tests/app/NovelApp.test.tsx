/**
 * NovelApp 启动路由（纯云端化 ⑥ 云-only）：无 Workspace 时渲染欢迎页（云端项目列表）；
 * 打开后切到工作台壳；登录门强制（未登录必拦，无本地模式跳过）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NovelApp } from "../../src/app/NovelApp.js";
import { WorkspaceController } from "../../src/domains/workspace/controller/WorkspaceController.js";
import { emitServerAuthStateChanged } from "../../src/settings/serverAuthChangeBus.js";
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
  const sessions = {
    open: vi.fn(async () => ({ id: "ws-1", label: "云端测试书" })),
    close: vi.fn(async () => undefined),
  };
  const controller = new WorkspaceController({ sessions });
  return { controller, sessions };
}

function buildCloudProjects(projects: ReadonlyArray<{ id: string; name: string }> = []) {
  const live = [...projects];
  return {
    list: vi.fn(async () =>
      live.map((p, i) => ({
        id: p.id,
        name: p.name,
        lastActivityAt: i,
        archived: false,
        referenceId: `ws-${p.id}`,
      })),
    ),
    create: vi.fn(async (name: string) => ({ referenceId: `ws-${name}`, label: name })),
    openProject: vi.fn(async (id: string, name: string) => ({ referenceId: `ws-${id}`, label: name })),
    remove: vi.fn(async (id: string) => {
      const index = live.findIndex((p) => p.id === id);
      if (index !== -1) live.splice(index, 1);
    }),
  };
}

/** 已登录的配置客户端（欢迎页云分区可见） */
function buildOnlineClient() {
  return {
    load: vi.fn(async () => ({ profiles: [], credentials: {}, defaults: {} })),
    mutate: vi.fn(async () => undefined),
    serverAuth: vi.fn(async () => ({
      status: "online",
      url: "http://127.0.0.1:8787",
      username: "alice",
      deviceId: "d1",
    })),
  } as never;
}

describe("NovelApp launch routing（云端项目）", () => {
  it("欢迎页只呈现云端项目分区：无本地新建/打开/导入按钮", async () => {
    const { controller } = buildController();
    render(
      <NovelApp
        api={buildApi()}
        platform={platform}
        workspaceController={controller}
        configurationClient={buildOnlineClient()}
        onboardingPort={{ isCompleted: async () => true, markCompleted: async () => undefined }}
        cloudProjects={buildCloudProjects([{ id: "prj_1", name: "云端测试书" }])}
      />,
    );
    expect(await screen.findByText("把一桩旧事，写成一本新书。")).toBeInTheDocument();
    expect(screen.getByText("云端项目")).toBeInTheDocument();
    // 云列表在 serverAuth 解析后异步拉取（登录态 → refreshCloudProjects）
    expect(await screen.findByText("云端测试书")).toBeInTheDocument();
    // 本地入口已退役
    expect(screen.queryByRole("button", { name: "新建项目" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开其他项目…" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "从文件导入…" })).not.toBeInTheDocument();
    expect(screen.queryByText("最近的项目")).not.toBeInTheDocument();
    expect(screen.queryByText("本地项目")).not.toBeInTheDocument();
  });

  it("点开云项目 → openProject + open 编排 → 落到工作台", async () => {
    const user = userEvent.setup();
    const { controller, sessions } = buildController();
    const cloud = buildCloudProjects([{ id: "prj_1", name: "云端测试书" }]);
    render(
      <NovelApp
        api={buildApi()}
        platform={platform}
        workspaceController={controller}
        configurationClient={buildOnlineClient()}
        onboardingPort={{ isCompleted: async () => true, markCompleted: async () => undefined }}
        cloudProjects={cloud}
      />,
    );
    await user.click(await screen.findByRole("button", { name: /^云端测试书/ }));
    expect(cloud.openProject).toHaveBeenCalledWith("prj_1", "云端测试书");
    expect(sessions.open).toHaveBeenCalledWith({ referenceId: "ws-prj_1", label: "云端测试书" });
    await waitFor(
      () => expect(screen.queryByLabelText(/正在打开/)).not.toBeInTheDocument(),
      { timeout: 8000 },
    );
    expect(screen.getByText("Novel")).toBeInTheDocument();
  });

  it("删除云项目：确认 → cloudProjects.remove + 列表刷新", async () => {
    const user = userEvent.setup();
    const { controller } = buildController();
    const cloud = buildCloudProjects([{ id: "prj_1", name: "云端测试书" }]);
    render(
      <NovelApp
        api={buildApi()}
        platform={platform}
        workspaceController={controller}
        configurationClient={buildOnlineClient()}
        onboardingPort={{ isCompleted: async () => true, markCompleted: async () => undefined }}
        cloudProjects={cloud}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "删除云端项目 云端测试书" }));
    expect(screen.getByText(/确定删除云端项目「云端测试书」/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "删除", exact: true }));
    await waitFor(() => expect(cloud.remove).toHaveBeenCalledWith("prj_1"));
    // 列表刷新后为空态（toast 归属工作台壳，欢迎页态不渲染——只断言列表行为）
    expect(await screen.findByText(/还没有云端项目/)).toBeInTheDocument();
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

describe("NovelApp 登录门（纯云端化 ⑥：强制登录）", () => {
  const LOGIN_TITLE = "登录同步服务";
  const WELCOME_TAG = "把一桩旧事，写成一本新书。";

  /** 有状态 auth client：模拟「启动乐观快照 → main 探活失败降级」的两段返回 */
  function buildAuthClient(initialState: unknown) {
    let state = initialState;
    return {
      load: vi.fn(async () => ({ profiles: [], credentials: {}, defaults: {} })),
      mutate: vi.fn(async () => undefined),
      serverAuth: vi.fn(async () => state),
      serverLogin: vi.fn(async () => state),
      __setAuthState: (next: unknown) => {
        state = next;
      },
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

  it("僵尸登录态（推送 offline/needRelogin 仍带 username）→ 登录门自动弹开（v0.1 修正）", async () => {
    const client = buildAuthClient({ status: "online", url: "http://127.0.0.1:8787", username: "alice" });
    // 初始乐观快照 online+username：不拦，欢迎页可见
    renderApp(client);
    expect(await screen.findByText(WELCOME_TAG)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: LOGIN_TITLE })).not.toBeInTheDocument();
    // main 探活失败（server-auth-changed → serverAuthChangeBus）：main 侧状态同步降级
    const degraded = { status: "offline", url: "http://127.0.0.1:8787", username: "alice" };
    (client as { __setAuthState: (s: unknown) => void }).__setAuthState(degraded);
    act(() => {
      emitServerAuthStateChanged(degraded);
    });
    expect(await screen.findByRole("heading", { name: LOGIN_TITLE })).toBeInTheDocument();
  });

  it("needRelogin 推送（401 清令牌）→ 登录门弹开", async () => {
    const client = buildAuthClient({ status: "online", url: "http://127.0.0.1:8787", username: "alice" });
    renderApp(client);
    expect(await screen.findByText(WELCOME_TAG)).toBeInTheDocument();
    const degraded = { status: "online", url: "http://x", needRelogin: true };
    (client as { __setAuthState: (s: unknown) => void }).__setAuthState(degraded);
    act(() => {
      emitServerAuthStateChanged(degraded);
    });
    expect(await screen.findByRole("heading", { name: LOGIN_TITLE })).toBeInTheDocument();
  });

  afterEach(() => {
    cleanup();
  });

  it("未登录 → 先见登录门（盖欢迎页），且无本地模式跳过入口", async () => {
    renderApp(buildAuthClient({ status: "unconfigured" }));
    expect(await screen.findByRole("heading", { name: LOGIN_TITLE })).toBeInTheDocument();
    // 固定 server：地址输入已退役，表单仅账号密码
    expect(screen.queryByLabelText(/服务器地址/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/用户名/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "暂不登录，本地模式使用" })).not.toBeInTheDocument();
  });

  it("已登录（online + username）→ 不弹门，欢迎页入口卡显示在线态", async () => {
    renderApp(buildAuthClient({ status: "online", url: "http://127.0.0.1:8787", username: "alice", deviceId: "d1" }));
    expect(await screen.findByText(WELCOME_TAG)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: LOGIN_TITLE })).not.toBeInTheDocument();
    expect(screen.getByText("已连接同步 · alice")).toBeInTheDocument();
  });

  it("曾配置过 server.url 但未登录（登出/凭据失效）→ 强制登录（纯云端化语义反转）", async () => {
    renderApp(buildAuthClient({ status: "online", url: "http://127.0.0.1:8787" }));
    expect(await screen.findByRole("heading", { name: LOGIN_TITLE })).toBeInTheDocument();
  });
});
