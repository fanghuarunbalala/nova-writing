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
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Logger, NovelApiClient } from "@novel/core";
import { noopLogger } from "@novel/core/client";
import type { ApplicationCommandSource } from "../command/index.js";
import {
  ApplicationSettingsStore,
  SettingsDialog,
  type ApplicationConfigurationClient,
} from "../settings/index.js";
import {
  CharacterStore,
  ConversationCatalogStore,
  LocationStore,
  ManuscriptStructureStore,
  NovelOverviewStore,
  ProjectSelectionPage,
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
import { NovelAppProvider } from "./NovelAppProvider.js";

export interface NovelAppProps {
  readonly api: NovelApiClient;
  readonly platform: FrontendPlatform;
  readonly logger?: Logger;
  readonly commandSource?: ApplicationCommandSource;
  readonly configurationClient?: ApplicationConfigurationClient;
  readonly workspaceController?: WorkspaceController;
  /** 第一方扩展点；不传时用 emptyNovelUiExtensions（spec 4.0.1） */
  readonly extensions?: NovelUiExtensions;
  /** 宿主追加的 overlay 节点（与默认 overlays 一并渲染进 OverlaysHost） */
  readonly overlays?: ReactNode;
}

export function NovelApp(props: NovelAppProps) {
  if (props.workspaceController === undefined) {
    return <div className="novel-shell-unavailable">等待 Workspace 控制器…</div>;
  }
  return <NovelAppReady {...props} workspaceController={props.workspaceController} />;
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
  extensions,
  overlays,
}: NovelAppReadyProps) {
  const domainStores = useMemo(
    () => createDomainStores(api, logger),
    [api, logger],
  );
  const mainViewRouter = useMemo(() => new MainViewRouter(), []);
  const inspectorRouter = useMemo(() => new InspectorRouter(), []);
  const toastStore = useMemo(() => new ToastStore(), []);
  const settingsStore = useMemo(() => new ApplicationSettingsStore(), []);
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
  // 启动时刷新最近项目（持久化来源），供选择页展示；不自动打开任何 Workspace。
  useEffect(() => {
    void workspaceController.refresh();
  }, [workspaceController]);

  return (
    <NovelAppProvider
      api={api}
      platform={platform}
      logger={logger}
      extensions={extensions}
      commandSource={commandSource}
      configurationClient={configurationClient}
    >
      {workspaceSnapshot.current === undefined ? (
        <ProjectSelectionPage
          snapshot={workspaceSnapshot}
          onChoose={() => {
            void workspaceController.chooseAndOpen();
          }}
          onOpenRecent={(workspaceId) => {
            void workspaceController.openRecent(workspaceId);
          }}
        />
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
          onOpenWorkspace={() => setWorkspaceOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          overlays={
            <>
              <WorkspaceSelectionDialog
                open={workspaceOpen}
                snapshot={workspaceSnapshot}
                onChoose={() => {
                  void workspaceController.chooseAndOpen();
                  setWorkspaceOpen(false);
                }}
                onOpenRecent={(workspaceId) => {
                  void workspaceController.openRecent(workspaceId);
                  setWorkspaceOpen(false);
                }}
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
                onDismiss={() => setSettingsOpen(false)}
              />
              {overlays}
            </>
          }
        />
      )}
    </NovelAppProvider>
  );
}

export function createDomainStores(
  api: NovelApiClient,
  logger?: Logger,
): ApplicationShellDomainStores {
  const conversationCatalog = new ConversationCatalogStore({ api, logger });
  const novelOverview = new NovelOverviewStore({ api, logger });
  const storyOutlineTree = new StoryOutlineTreeStore({ api, logger });
  const manuscriptStructure = new ManuscriptStructureStore({ api, logger });
  const character = new CharacterStore({ api, logger });
  const location = new LocationStore({ api, logger });
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
  };
}
