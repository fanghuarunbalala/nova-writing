/**
 * DesktopNovelApp
 *
 * 桌面组合根：把 Electron api / workspace controller 与 5 个域 store、
 * 路由、overlays 组装进 Phase 3+ 的 NovelApplicationShell。
 *
 * 说明：platform/commandSource 暂时保留在 props 表面（旧 smoke 契约），
 * 新壳的桌面扩展槽（titlebar/commands/settings sections）在后续接入。
 */
import { useMemo, useState } from "react";
import type { Logger, NovelApiClient } from "@novel/core";
import {
  ApplicationSettingsStore,
  SettingsDialog,
  WorkspaceSelectionDialog,
  domains,
  shared,
  shell,
  type ApplicationCommandSource,
  type ApplicationConfigurationClient,
  type FrontendPlatform,
  type WorkspaceController,
} from "@novel/ui";

const {
  CharacterStore,
  ConversationCatalogStore,
  LocationStore,
  ManuscriptStructureStore,
  NovelOverviewStore,
  ScheduleStore,
  ScheduleTodoStore,
  StoryOutlineTreeStore,
  WorkspaceControllerAdapter,
} = domains;
const {
  InspectorRouter,
  MainViewRouter,
  ToastStore,
  useExternalStore,
} = shared;
const { NovelApplicationShell } = shell;
type NovelApplicationShellDomainStores = shell.NovelApplicationShellDomainStores;

export interface DesktopNovelAppProps {
  readonly api: NovelApiClient;
  readonly platform: FrontendPlatform;
  readonly logger?: Logger;
  readonly commandSource?: ApplicationCommandSource;
  readonly configurationClient?: ApplicationConfigurationClient;
  readonly workspaceController?: WorkspaceController;
}

export function DesktopNovelApp(props: DesktopNovelAppProps) {
  if (props.workspaceController === undefined) {
    return <div className="novel-desktop-unavailable">等待 Workspace 控制器…</div>;
  }
  return (
    <DesktopNovelAppReady
      {...props}
      workspaceController={props.workspaceController}
    />
  );
}

interface DesktopNovelAppReadyProps extends DesktopNovelAppProps {
  readonly workspaceController: WorkspaceController;
}

function DesktopNovelAppReady({
  api,
  logger,
  configurationClient,
  workspaceController,
}: DesktopNovelAppReadyProps) {
  const domainStores = useMemo(
    () => createDesktopDomainStores(api, logger),
    [api, logger],
  );
  const mainViewRouter = useMemo(() => new MainViewRouter(), []);
  const inspectorRouter = useMemo(() => new InspectorRouter(), []);
  const toastStore = useMemo(() => new ToastStore(), []);
  const settingsStore = useMemo(() => new ApplicationSettingsStore(), []);
  const workspaceAdapter = useMemo(
    () => new WorkspaceControllerAdapter(workspaceController),
    [workspaceController],
  );
  const workspaceSnapshot = useExternalStore(workspaceAdapter);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <NovelApplicationShell
      api={api}
      logger={logger}
      mainViewRouter={mainViewRouter}
      inspectorRouter={inspectorRouter}
      workspaceAdapter={workspaceAdapter}
      domainStores={domainStores}
      toastStore={toastStore}
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
            configuration={configurationClient}
            onDismiss={() => setSettingsOpen(false)}
          />
        </>
      }
    />
  );
}

function createDesktopDomainStores(
  api: NovelApiClient,
  logger?: Logger,
): NovelApplicationShellDomainStores {
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
