/**
 * NovelApp 启动路由：无 Workspace 时渲染选择页；打开后切到工作台壳。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
    await user.click(await screen.findByRole("button", { name: /白昼计划/ }));
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
