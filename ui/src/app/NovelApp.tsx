/**
 * NovelApp
 *
 * 共享 React 应用入口：把 api / workspace controller / 5 个域 store、
 * 路由、overlays 组装进 ApplicationShell（桌面与 Web 共用）。
 *
 * platform/commandSource 保留在 props 表面（组合层契约）；
 * 桌面专属扩展槽（titlebar/commands）在壳加扩展点后接入。
 */
import { useMemo, useState, type ReactNode } from "react";
import type { Logger, NovelApiClient } from "@novel/core";
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
  ScheduleStore,
  ScheduleTodoStore,
  StoryOutlineTreeStore,
  WorkspaceController,
  WorkspaceControllerAdapter,
  WorkspaceSelectionDialog,
  type WorkspaceControllerSnapshot,
} from "../domains/index.js";
import type { FrontendPlatform } from "../platform/index.js";
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

export interface NovelAppProps {
  readonly api: NovelApiClient;
  readonly platform: FrontendPlatform;
  readonly logger?: Logger;
  readonly commandSource?: ApplicationCommandSource;
  readonly configurationClient?: ApplicationConfigurationClient;
  readonly workspaceController?: WorkspaceController;
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
  logger,
  configurationClient,
  workspaceController,
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
  const workspaceAdapter = useMemo(
    () => new WorkspaceControllerAdapter(workspaceController),
    [workspaceController],
  );
  const workspaceSnapshot: WorkspaceControllerSnapshot = useExternalStore(workspaceAdapter);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <ApplicationShell
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
          {overlays}
        </>
      }
    />
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
