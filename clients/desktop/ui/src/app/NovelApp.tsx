/**
 * NovelApp
 *
 * 共享 React 应用入口（spec 4.0.1）：把 api / workspace controller / 域 store、
 * 路由、overlays 组装进 ApplicationShell，并用 NovelAppProvider 把 api/platform/
 * extensions/logger/commandSource/configurationClient 发布到 Context。
 *
 * platform/commandSource/configurationClient 保留在 props 表面（组合层契约）；
 * 桌面专属扩展槽（titlebar/commands）在壳加扩展点后接入（Phase B）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Logger, NovelApiClient, ServerAuthState } from "@novel/core";
import { noopLogger } from "@novel/core/client";
import type { ApplicationCommandSource } from "../command/index.js";
import { LoginPage } from "../auth/index.js";
import {
  completeOnboarding,
  hasCompletedOnboarding,
  OnboardingWizard,
} from "../onboarding/index.js";
import {
  ApplicationSettingsStore,
  ConfigurationStatusContext,
  isModelConfigured,
  SettingsDialog,
  type ApplicationConfigurationClient,
} from "../settings/index.js";
import {
  CharacterStore,
  ConversationCatalogStore,
  LibraryStore,
  LocationStore,
  ManuscriptStructureStore,
  NovelOverviewStore,
  NotificationStore,
  ProjectSelectionPage,
  LaunchOverlay,
  LaunchProgressStore,
  ScheduleStore,
  ScheduleTodoStore,
  StoryOutlineTreeStore,
  WorkspaceController,
  WorkspaceControllerAdapter,
  WorkspaceSelectionDialog,
  type WorkspaceControllerSnapshot,
} from "../domains/index.js";
import type { FrontendPlatform } from "../platform/index.js";
import type { NovelUiExtensions } from "../extensions/index.js";
import { ThemeProvider } from "../shared/theme/index.js";
import {
  InspectorRouter,
  MainViewRouter,
  ToastStore,
  useExternalStore,
} from "../shared/index.js";
import {
  ApplicationShell,
  type ApplicationShellDomainStores,
} from "../shell/ApplicationShell.js";
import type { WindowChromeProps } from "../shell/topbar/WindowControls.js";
import { NovelAppProvider } from "./NovelAppProvider.js";

/** 引导完成标记端口：localStorage 在多实例共享 userData 下互不可见，桌面宿主以
 * 主进程文件持久化实现（isCompleted 读判定 / markCompleted 写完成） */
export interface OnboardingStatusPort {
  isCompleted(): Promise<boolean>;
  markCompleted(): Promise<void>;
}

export interface NovelAppProps {
  readonly api: NovelApiClient;
  readonly platform: FrontendPlatform;
  readonly logger?: Logger;
  readonly commandSource?: ApplicationCommandSource;
  readonly configurationClient?: ApplicationConfigurationClient;
  readonly workspaceController?: WorkspaceController;
  /** 引导完成标记端口（桌面宿主经主进程文件持久化，跨实例一致可见）；缺省回退 localStorage */
  readonly onboardingPort?: OnboardingStatusPort;
  /** 第一方扩展点；不传时用 emptyNovelUiExtensions（spec 4.0.1） */
  readonly extensions?: NovelUiExtensions;
  /** 宿主追加的 overlay 节点（与默认 overlays 一并渲染进 OverlaysHost） */
  readonly overlays?: ReactNode;
  /** 窗口控制（PRD WC；桌面宿主经 preload 桥注入，透传到 TopBar） */
  readonly windowChrome?: WindowChromeProps;
  /**
   * 云项目通道（项目域上云 FR4；gui 宿主注入，缺省隐藏云端分区）：
   * list 拉 server 项目；create/openProject 返回打开引用（经 workspaceController.open）。
   */
  readonly cloudProjects?: CloudProjectsPort;
}

/** 云项目通道（renderer → main workspace-rpc；纯云端化 ⑥：项目列表唯一来源） */
export interface CloudProjectsPort {
  list(): Promise<
    Array<{ id: string; name: string; lastActivityAt: number | null; archived: boolean; referenceId?: string }>
  >;
  create(name: string): Promise<{ referenceId: string; label: string } | undefined>;
  openProject(projectId: string, name: string): Promise<{ referenceId: string; label: string }>;
  /** 删除云端项目（server 软删 + 本地缓存/注册表清理；在用时 main 侧拒绝） */
  remove(projectId: string): Promise<void>;
}

export function NovelApp(props: NovelAppProps) {
  if (props.workspaceController === undefined) {
    return (
      <ThemeProvider>
        <div className="novel-shell-unavailable">等待 Workspace 控制器…</div>
      </ThemeProvider>
    );
  }
  return (
    <ThemeProvider>
      <NovelAppReady {...props} workspaceController={props.workspaceController} />
    </ThemeProvider>
  );
}

interface NovelAppReadyProps extends NovelAppProps {
  readonly workspaceController: WorkspaceController;
}

function NovelAppReady({
  api,
  platform,
  logger = noopLogger,
  commandSource,
  configurationClient,
  workspaceController,
  onboardingPort,
  extensions,
  overlays,
  windowChrome,
  cloudProjects,
}: NovelAppReadyProps) {
  const toastStore = useMemo(() => new ToastStore(), []);
  const domainStores = useMemo(
    () =>
      createDomainStores(api, logger, {
        // 解析完成/失败 toast（通知中心已在 createDomainStores 内接线）
        onBookStatusChanged: (book) => {
          toastStore.push({
            kind: book.to === "已完成" ? "success" : "danger",
            text:
              book.to === "已完成"
                ? `《${book.title}》解析完成——大纲 / 人物 / 地点 / 风格 / 摘录已就绪`
                : `《${book.title}》解析失败——可在书库总览重试`,
          });
        },
      }),
    [api, logger, toastStore],
  );
  const mainViewRouter = useMemo(() => new MainViewRouter(), []);
  const inspectorRouter = useMemo(() => new InspectorRouter(), []);
  const settingsStore = useMemo(() => new ApplicationSettingsStore(), []);
  // 启动编排（demo bootIntoApp 真实进度版）：opening → 分步加载遮罩 → 工作台
  // boot-in；应用内切换项目（WorkspaceSelectionDialog）复用同一编排重放。
  const launchStore = useMemo(
    () => new LaunchProgressStore({ controller: workspaceController, domainStores }),
    [workspaceController, domainStores],
  );
  useEffect(() => launchStore.attach(), [launchStore]);
  const launchSnapshot = useExternalStore(launchStore);
  // NovelApp 自身需要 workspace 快照以驱动 WorkspaceSelectionDialog overlay；
  // ApplicationShell 内部还会再包一层 adapter 订阅同一个 controller（spec 4.1）。
  // 两个 adapter 都只是 subscribe + 转发快照，开销可忽略。
  const workspaceAdapter = useMemo(
    () => new WorkspaceControllerAdapter(workspaceController),
    [workspaceController],
  );
  const workspaceSnapshot: WorkspaceControllerSnapshot = useExternalStore(workspaceAdapter);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  // 登录门（纯云端化 ⑥：强制登录——server 为唯一数据源，未登录只能停在登录页）：
  // undecided 期用不透明底遮欢迎页防闪
  const [loginGate, setLoginGate] = useState<"undecided" | "open" | "closed">("undecided");
  const [serverAuthState, setServerAuthState] = useState<ServerAuthState | undefined>(undefined);
  // 云项目分区（登录后拉取；登录门关闭/状态变化时刷新）
  const [cloudList, setCloudList] = useState<Array<{ id: string; name: string; lastActivityAt: number | null; archived: boolean }>>([]);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState<string | undefined>(undefined);
  const refreshCloudProjects = useCallback(async () => {
    if (cloudProjects === undefined || serverAuthState?.username === undefined) {
      setCloudList([]);
      return;
    }
    try {
      setCloudList(await cloudProjects.list());
    } catch {
      setCloudList([]);
    }
  }, [cloudProjects, serverAuthState?.username]);
  useEffect(() => {
    void refreshCloudProjects();
  }, [refreshCloudProjects]);
  const createCloudProject = useCallback(async (name: string) => {
    if (cloudProjects === undefined || cloudBusy) return;
    setCloudBusy(true);
    setCloudError(undefined);
    try {
      const ref = await cloudProjects.create(name);
      if (ref !== undefined) await workspaceController.open(ref);
    } catch (cause) {
      setCloudError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCloudBusy(false);
    }
  }, [cloudProjects, cloudBusy, workspaceController]);
  const openCloudProject = useCallback(async (project: { id: string; name: string }) => {
    if (cloudProjects === undefined) return;
    try {
      const ref = await cloudProjects.openProject(project.id, project.name);
      await workspaceController.open(ref);
    } catch (cause) {
      setCloudError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [cloudProjects, workspaceController]);
  /** 删除云端项目（server 软删 + 本地缓存清理）：成功/失败 toast + 刷新列表 */
  const removeCloudProject = useCallback(async (projectId: string): Promise<boolean> => {
    if (cloudProjects === undefined) return false;
    try {
      await cloudProjects.remove(projectId);
      toastStore.push({ kind: "success", text: "云端项目已删除" });
      await refreshCloudProjects();
      return true;
    } catch (cause) {
      toastStore.push({
        kind: "danger",
        text: cause instanceof Error ? cause.message : String(cause),
      });
      return false;
    }
  }, [cloudProjects, refreshCloudProjects, toastStore]);
  /** 切换对话框「新窗口打开」：先确保本地登记（他端创建未打开的项目），再派发新实例 */
  const openCloudProjectInNewWindow = useCallback(async (project: { id: string; name: string }) => {
    if (cloudProjects === undefined) return;
    try {
      const ref = await cloudProjects.openProject(project.id, project.name);
      await workspaceController.openInNewWindow(ref);
    } catch (cause) {
      toastStore.push({
        kind: "danger",
        text: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }, [cloudProjects, workspaceController, toastStore]);
  const refreshServerAuth = useCallback(async () => {
    const pending = configurationClient?.serverAuth?.();
    if (pending === undefined) return;
    try {
      setServerAuthState(await pending);
    } catch {
      // 查询失败维持现状
    }
  }, [configurationClient]);
  useEffect(() => {
    void refreshServerAuth();
  }, [refreshServerAuth]);
  useEffect(() => {
    if (configurationClient === undefined) {
      setLoginGate("closed");
      return;
    }
    const fetchState = configurationClient.serverAuth;
    if (fetchState === undefined) {
      setLoginGate("closed");
      return;
    }
    let cancelled = false;
    const pending = fetchState();
    if (pending !== undefined) {
      void pending
        .then((state) => {
          if (cancelled) return;
          // 强制登录：已登录（username）→ 不拦；否则（含曾配置过 url 的离线/凭据失效）弹登录门
          if (state !== undefined && state.username !== undefined) {
            setLoginGate("closed");
          } else {
            setLoginGate("open");
          }
        })
        .catch(() => {
          if (!cancelled) setLoginGate("open");
        });
    } else {
      // 老 main 进程返回空（方法存在但调用未定义面）按未登录处理
      setLoginGate("open");
    }
    return () => {
      cancelled = true;
    };
  }, [configurationClient]);
  const closeLoginGate = useCallback(() => {
    setLoginGate("closed");
    void refreshServerAuth();
  }, [refreshServerAuth]);
  const openLoginGate = useCallback(() => {
    setLoginGate("open");
  }, []);
  // 从文件导入的编排已随本地模式退役（纯云端化 ⑥；云端导入后续单独立项）
  // 模型配置状态（回声模式判定）：无 configurationClient 的宿主恒视为已配置
  const [modelConfigured, setModelConfigured] = useState(true);
  // 书库视图（试验功能，NOVEL_LIBRARY=1 才开启）：向导按此决定是否介绍
  const libraryEnabled = platform.capabilities.library === true;
  // "新窗口打开"派生的启动上下文（他实例 spawn 本实例时注入）：自动打开该项目
  //（runExclusive 串行；无上下文静默跳过，取出即清防 StrictMode 双跑）
  useEffect(() => {
    void workspaceController.openStartupWorkspace();
  }, [workspaceController]);
  // 首启新手引导：有配置客户端（桌面宿主）且未完成时弹向导。完成标记优先主进程文件
  // （跨实例一致可见），localStorage 仅作回退与一次性迁移源。
  // 登录门打开期间暂缓（先登录/跳过，再引导——两层门不叠加）
  useEffect(() => {
    if (configurationClient === undefined) return;
    if (loginGate !== "closed") return;
    let cancelled = false;
    void (async () => {
      if (onboardingPort !== undefined) {
        try {
          if (await onboardingPort.isCompleted()) return;
          if (hasCompletedOnboarding()) {
            // 旧版 localStorage 标记迁移：补写主进程文件后不再弹
            await onboardingPort.markCompleted();
            return;
          }
        } catch {
          // 端口异常：回退 localStorage 判定（下方）
        }
      }
      if (!cancelled && !hasCompletedOnboarding()) setGuideOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [configurationClient, onboardingPort, loginGate]);
  const refreshModelConfigured = useCallback(async () => {
    if (configurationClient === undefined) return;
    try {
      setModelConfigured(isModelConfigured(await configurationClient.load()));
    } catch {
      // 读取失败：维持当前状态
    }
  }, [configurationClient]);
  useEffect(() => {
    void refreshModelConfigured();
  }, [refreshModelConfigured]);
  const openGuide = useCallback(() => setGuideOpen(true), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const configurationStatus = useMemo(
    () => ({ modelConfigured, openGuide, openSettings }),
    [modelConfigured, openGuide, openSettings],
  );
  const dismissSettings = useCallback(() => {
    setSettingsOpen(false);
    void refreshModelConfigured();
  }, [refreshModelConfigured]);
  // 向导关闭（完成 / 跳过 / ESC / X）统一写完成标记（localStorage + 主进程文件双写）
  // 并刷新配置状态
  const dismissGuide = useCallback(() => {
    setGuideOpen(false);
    completeOnboarding();
    onboardingPort?.markCompleted().catch(() => {
      // 标记落盘失败：localStorage 仍在（同实例不重弹；跨实例由下次迁移兜底）
    });
    void refreshModelConfigured();
  }, [onboardingPort, refreshModelConfigured]);

  return (
    <NovelAppProvider
      api={api}
      platform={platform}
      logger={logger}
      extensions={extensions}
      commandSource={commandSource}
      configurationClient={configurationClient}
    >
      <ConfigurationStatusContext.Provider value={configurationStatus}>
        {workspaceSnapshot.current === undefined ? (
          <>
            <ProjectSelectionPage
              snapshot={workspaceSnapshot}
              serverAuthState={serverAuthState}
              onOpenLogin={openLoginGate}
              onOpenSettings={openSettings}
              onOpenGuide={openGuide}
              cloudSection={
                cloudProjects !== undefined
                  ? {
                      projects: cloudList,
                      busy: cloudBusy,
                      error: cloudError,
                      onCreate: (name: string) => void createCloudProject(name),
                      onOpen: (project: { id: string; name: string }) => void openCloudProject(project),
                      onDelete: (projectId: string) => removeCloudProject(projectId),
                    }
                  : undefined
              }
            />
            <OnboardingWizard
              open={guideOpen}
              configuration={configurationClient}
              libraryEnabled={libraryEnabled}
              onDismiss={dismissGuide}
            />
            {/* 登录门：不透明全屏，盖在欢迎页/引导之上（LaunchOverlay 之下由 z 刻度保证）；
                undecided 期遮底防欢迎页闪现（仅可能开门时才遮） */}
            {loginGate === "open" ? (
              <LoginPage
                configuration={configurationClient!}
                onEnterWorkspace={closeLoginGate}
              />
            ) : loginGate === "undecided" && configurationClient?.serverAuth !== undefined ? (
              <div
                aria-hidden="true"
                style={
                  {
                    position: "fixed",
                    inset: 0,
                    background: "var(--color-bg)",
                    zIndex: "var(--z-launch)",
                  } as CSSProperties
                }
              />
            ) : null}
          </>
        ) : (
          <ApplicationShell
            api={api}
            logger={logger}
            platform={platform}
            mainViewRouter={mainViewRouter}
            inspectorRouter={inspectorRouter}
            workspaceController={workspaceController}
            domainStores={domainStores}
            toastStore={toastStore}
            settingsStore={settingsStore}
            configurationClient={configurationClient}
            commandSource={commandSource}
            extensions={extensions}
            windowChrome={windowChrome}
            launchPhase={launchSnapshot.phase}
            onOpenWorkspace={() => setWorkspaceOpen(true)}
            onOpenSettings={openSettings}
            onOpenGuide={openGuide}
            overlays={
              <>
                <WorkspaceSelectionDialog
                  open={workspaceOpen}
                  snapshot={workspaceSnapshot}
                  cloudProjects={
                    cloudProjects !== undefined
                      ? {
                          projects: cloudList,
                          onOpen: (project) => void openCloudProject(project),
                          onOpenInNewWindow: (project) => void openCloudProjectInNewWindow(project),
                          onDelete: (projectId) => removeCloudProject(projectId),
                        }
                      : undefined
                  }
                  onCloseWorkspace={() => {
                    void workspaceController.closeCurrent();
                    setWorkspaceOpen(false);
                  }}
                  onDismiss={() => setWorkspaceOpen(false)}
                />
                <SettingsDialog
                  open={settingsOpen}
                  store={settingsStore}
                  sections={extensions?.settingsSections}
                  configuration={configurationClient}
                  onDismiss={dismissSettings}
                />
                <OnboardingWizard
                  open={guideOpen}
                  configuration={configurationClient}
                  libraryEnabled={libraryEnabled}
                  onDismiss={dismissGuide}
                />
                {overlays}
              </>
            }
          />
        )}
        {launchSnapshot.phase !== "idle" ? (
          <LaunchOverlay snapshot={launchSnapshot} />
        ) : null}
      </ConfigurationStatusContext.Provider>
    </NovelAppProvider>
  );
}

export function createDomainStores(
  api: NovelApiClient,
  logger?: Logger,
  options?: {
    /** 书本状态翻转外部钩子（解析完成/失败 toast；通知中心已在内部接线） */
    readonly onBookStatusChanged?: (book: {
      bookId: string;
      title: string;
      from: "未解析" | "解析中" | "已完成" | "解析失败";
      to: "未解析" | "解析中" | "已完成" | "解析失败";
    }) => void;
  },
): ApplicationShellDomainStores {
  const conversationCatalog = new ConversationCatalogStore({ api, logger });
  const novelOverview = new NovelOverviewStore({ api, logger });
  const storyOutlineTree = new StoryOutlineTreeStore({ api, logger });
  const manuscriptStructure = new ManuscriptStructureStore({ api, logger });
  const character = new CharacterStore({ api, logger });
  const location = new LocationStore({ api, logger });
  const notifications = new NotificationStore();
  const library = new LibraryStore({
    api,
    logger,
    // 解析完成/失败：通知中心入列（done 类型 + goto 跳书库）+ 转发外部钩子（toast）
    onBookStatusChanged: (book) => {
      const done = book.to === "已完成";
      notifications.upsert({
        id: `library-parse-${book.bookId}-${book.to}`,
        type: "done",
        title: done ? "书籍解析完成" : "书籍解析失败",
        desc: `《${book.title}》${done ? "幕级大纲 / 人物 / 地点 / 风格 / 摘录已就绪" : book.bookId}`,
        createdAt: Date.now(),
        read: false,
        goto: { view: "library" },
      });
      options?.onBookStatusChanged?.(book);
    },
  });
  const schedule = new ScheduleStore({
    novelOverview,
    outlineTree: storyOutlineTree,
    conversationCatalog,
    logger,
  });
  return {
    conversationCatalog,
    novelOverview,
    storyOutlineTree,
    manuscriptStructure,
    character,
    location,
    schedule,
    scheduleTodo: new ScheduleTodoStore(),
    notifications,
    library,
  };
}
