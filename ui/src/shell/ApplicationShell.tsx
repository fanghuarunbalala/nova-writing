/**
 * ApplicationShell
 *
 * Phase 3 组合根：把 5 个域拼成 topbar/sidebar/main/inspector/overlays，
 * 并承担唯一允许的跨域副作用协调（workspace 切换触发各域 load）。
 *
 * 契约见 spec 4.1。宿主注入 workspaceController（Port 接口），shell 内部用
 * WorkspaceControllerAdapter 包成 ExternalStore 订阅快照。extensions 走默认
 * emptyNovelUiExtensions，桌面端由 Phase B 注入 createDesktopUiExtensions。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Logger, NovelApiClient } from "@novel/core";
import { useExternalStore } from "../shared/state/useExternalStore.js";
import type { ToastStore } from "../shared/state/ToastStore.js";
import type { MainViewRouter } from "../shared/routing/MainViewRouter.js";
import type { InspectorRouter } from "../shared/routing/InspectorRouter.js";
import { useMainView } from "../shared/routing/hooks.js";
import type { ConversationCatalogStore } from "../domains/conversation/store/ConversationCatalogStore.js";
import type { CharacterStore } from "../domains/novel/character/store/CharacterStore.js";
import type { LocationStore } from "../domains/novel/location/store/LocationStore.js";
import type { ManuscriptStructureStore } from "../domains/novel/manuscript/store/ManuscriptStructureStore.js";
import type { NovelOverviewStore } from "../domains/novel/overview/NovelOverviewStore.js";
import type { StoryOutlineTreeStore } from "../domains/novel/outline/store/StoryOutlineTreeStore.js";
import type { ScheduleStore } from "../domains/schedule/store/ScheduleStore.js";
import type { ScheduleTodoStore } from "../domains/schedule/store/ScheduleTodoStore.js";
import type { WorkspaceControllerPort } from "../domains/workspace/store/WorkspaceControllerAdapter.js";
import { WorkspaceControllerAdapter } from "../domains/workspace/store/WorkspaceControllerAdapter.js";
import type { ApplicationConfigurationClient } from "../settings/ApplicationConfigurationClient.js";
import type { ApplicationSettingsStore } from "../settings/ApplicationSettingsStore.js";
import type { ApplicationCommandSource } from "../command/ApplicationCommandSource.js";
import type { NovelUiExtensions } from "../extensions/NovelUiExtensions.js";
import type { ConversationCardRendererRegistry } from "../domains/conversation/cards/ConversationCardRendererRegistry.js";
import type { ConversationCardProjectorRegistry } from "../domains/conversation/cards/projection/ConversationCardProjectorRegistry.js";
import type { InspectorRendererRegistry } from "./inspector/InspectorRendererRegistry.js";
import { InspectorHost } from "./inspector/InspectorHost.js";
import { MainArea } from "./main/MainArea.js";
import type { ContentTab } from "./main/ContentTabs.js";
import { OverlaysHost } from "./overlays/OverlaysHost.js";
import { Sidebar } from "./sidebar/Sidebar.js";
import { TopBar } from "./topbar/TopBar.js";
import styles from "./ApplicationShell.module.css";

/**
 * 域 store 集合。approval 域三个 store 与 workspaceMetadata 在 Phase 2 轨道 C 延后
 * （见 spec 3.3 状态说明与 11 后续工作）；当前接口不含这些字段，Phase 2 轨道 C
 * 落地后追加为可选，再后续转必填。
 */
export interface ApplicationShellDomainStores {
  readonly conversationCatalog: ConversationCatalogStore;
  readonly novelOverview: NovelOverviewStore;
  readonly storyOutlineTree: StoryOutlineTreeStore;
  readonly manuscriptStructure: ManuscriptStructureStore;
  readonly character: CharacterStore;
  readonly location: LocationStore;
  readonly schedule: ScheduleStore;
  readonly scheduleTodo: ScheduleTodoStore;
}

export interface ApplicationShellProps {
  readonly api: NovelApiClient;
  readonly logger?: Logger;
  readonly mainViewRouter: MainViewRouter;
  readonly inspectorRouter: InspectorRouter;
  /**
   * Workspace 控制器（宿主注入）。ApplicationShell 内部用 WorkspaceControllerAdapter
   * 包成 ExternalStore 订阅快照；不要求调用方预先包装。
   */
  readonly workspaceController: WorkspaceControllerPort;
  readonly domainStores: ApplicationShellDomainStores;
  readonly toastStore: ToastStore;
  readonly settingsStore?: ApplicationSettingsStore;
  readonly configurationClient?: ApplicationConfigurationClient;
  readonly commandSource?: ApplicationCommandSource;
  /** 第一方扩展点；不传时用 emptyNovelUiExtensions（spec 4.0.1） */
  readonly extensions?: NovelUiExtensions;
  /** Inspector panel 注册表（Phase 3 引入；当前 InspectorHost 用硬编码 switch） */
  readonly inspectorRenderers?: InspectorRendererRegistry;
  readonly conversationCardRenderers?: ConversationCardRendererRegistry;
  readonly conversationCardProjectors?: ConversationCardProjectorRegistry;
  readonly onOpenWorkspace?: () => void;
  readonly onOpenSettings?: () => void;
  readonly overlays?: ReactNode;
}

export function ApplicationShell({
  api,
  logger,
  mainViewRouter,
  inspectorRouter,
  workspaceController,
  domainStores,
  toastStore,
  extensions,
  onOpenWorkspace,
  onOpenSettings,
  overlays,
}: ApplicationShellProps) {
  // 内部把 controller port 包成 ExternalStore；卸载时解除订阅（spec 4.1）
  const workspaceAdapter = useMemo(
    () => new WorkspaceControllerAdapter(workspaceController),
    [workspaceController],
  );
  useEffect(() => () => workspaceAdapter.dispose(), [workspaceAdapter]);

  const workspace = useExternalStore(workspaceAdapter);
  const mainView = useMainView(mainViewRouter);
  const [sidebarMode, setSidebarMode] = useState<"expanded" | "collapsed">("expanded");
  const [contentTab, setContentTab] = useState<ContentTab>("outline");
  const workspaceId = workspace.current?.id;
  // extensions 当前由 NovelApp 在 NovelAppProvider 内提供；shell 内 TopBar/Sidebar
  // 的扩展 slot（TopBarMenuSlot / sidebarPanels）在 Phase B 落地后从此处取用。

  // 跨域副作用协调：workspace 变化时并行触发各域 load（spec 1.5.1）
  useEffect(() => {
    if (workspaceId === undefined) return;
    const {
      conversationCatalog,
      novelOverview,
      storyOutlineTree,
      manuscriptStructure,
      character,
      location,
    } = domainStores;
    void conversationCatalog.loadWorkspace(workspaceId);
    void novelOverview.loadWorkspace(workspaceId);
    void storyOutlineTree.loadWorkspace(workspaceId);
    void manuscriptStructure.loadWorkspace(workspaceId);
    void character.loadWorkspace(workspaceId);
    void location.loadWorkspace(workspaceId);
  }, [domainStores, workspaceId]);

  const handleCreateConversation = useCallback(() => {
    void domainStores.conversationCatalog.createConversation();
  }, [domainStores]);

  const handleSelectOutlineUnit = useCallback(
    (unitId: string) => {
      domainStores.storyOutlineTree.selectUnit(unitId);
      inspectorRouter.transition({ kind: "outlineUnit", unitId });
    },
    [domainStores, inspectorRouter],
  );

  const handleSelectCharacter = useCallback(
    (characterId: string) => {
      domainStores.character.selectCharacter(characterId);
      inspectorRouter.transition({ kind: "entity", entityType: "character", entityId: characterId });
    },
    [domainStores, inspectorRouter],
  );

  const handleSelectLocation = useCallback(
    (locationId: string) => {
      domainStores.location.selectLocation(locationId);
      inspectorRouter.transition({ kind: "entity", entityType: "location", entityId: locationId });
    },
    [domainStores, inspectorRouter],
  );

  const handleTodoAction = useCallback(
    (_id: string, action: string) => {
      if (action === "open-character") {
        mainViewRouter.transition("content");
      } else if (action === "open-location") {
        mainViewRouter.transition("content");
      }
    },
    [mainViewRouter],
  );

  const handleSelectContentPane = useCallback(
    (pane: ContentTab) => {
      setContentTab(pane);
      mainViewRouter.transition("content");
    },
    [mainViewRouter],
  );

  return (
    <div className={styles.shell}>
      <TopBar
        mainViewState={mainView.state}
        onMainViewChange={(state) => mainViewRouter.transition(state)}
        workspaceName={workspace.current?.label}
        sidebarMode={sidebarMode}
        onToggleSidebar={() =>
          setSidebarMode((mode) => (mode === "expanded" ? "collapsed" : "expanded"))
        }
        onOpenWorkspace={() => onOpenWorkspace?.()}
        onOpenSettings={() => onOpenSettings?.()}
        extensions={extensions}
      />
      <div className={styles.body} data-sidebar-mode={sidebarMode}>
        <Sidebar
          mode={sidebarMode}
          conversationCatalog={domainStores.conversationCatalog}
          novelOverview={domainStores.novelOverview}
          onCreateConversation={handleCreateConversation}
          schedule={domainStores.schedule}
          scheduleTodo={domainStores.scheduleTodo}
          contentTab={contentTab}
          onSelectContentPane={handleSelectContentPane}
          workspaceId={workspaceId}
          workspaceLabel={workspace.current?.label}
          onOpenWorkspace={onOpenWorkspace}
          onTodoAction={handleTodoAction}
        />
        <MainArea
          api={api}
          logger={logger}
          mainViewRouter={mainViewRouter}
          conversationCatalog={domainStores.conversationCatalog}
          outlineTree={domainStores.storyOutlineTree}
          manuscript={domainStores.manuscriptStructure}
          characters={domainStores.character}
          locations={domainStores.location}
          schedule={domainStores.schedule}
          scheduleTodo={domainStores.scheduleTodo}
          contentTab={contentTab}
          onContentTabChange={setContentTab}
          onCreateConversation={handleCreateConversation}
          onSelectOutlineUnit={handleSelectOutlineUnit}
          onSelectCharacter={handleSelectCharacter}
          onSelectLocation={handleSelectLocation}
          onTodoAction={handleTodoAction}
        />
        <InspectorHost
          inspectorRouter={inspectorRouter}
          conversationCatalog={domainStores.conversationCatalog}
          outlineTree={domainStores.storyOutlineTree}
          characters={domainStores.character}
          locations={domainStores.location}
        />
      </div>
      <OverlaysHost toastStore={toastStore}>{overlays}</OverlaysHost>
    </div>
  );
}
