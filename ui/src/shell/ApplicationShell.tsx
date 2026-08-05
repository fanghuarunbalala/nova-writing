/**
 * ApplicationShell
 *
 * Phase 3 组合根：把 5 个域拼成 topbar/sidebar/main/inspector/overlays，
 * 并承担唯一允许的跨域副作用协调（workspace 切换触发各域 load）。
 *
 * 说明：组合根按 spec 命名为 shell/ApplicationShell.tsx；桌面/Web 由
 * app/NovelApp.tsx 统一组装注入。
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
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
import type { WorkspaceControllerAdapter } from "../domains/workspace/store/WorkspaceControllerAdapter.js";
import { InspectorHost } from "./inspector/InspectorHost.js";
import { MainArea } from "./main/MainArea.js";
import { OverlaysHost } from "./overlays/OverlaysHost.js";
import { Sidebar } from "./sidebar/Sidebar.js";
import { TopBar } from "./topbar/TopBar.js";
import styles from "./ApplicationShell.module.css";

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
  readonly workspaceAdapter: WorkspaceControllerAdapter;
  readonly domainStores: ApplicationShellDomainStores;
  readonly toastStore: ToastStore;
  readonly onOpenWorkspace?: () => void;
  readonly onOpenSettings?: () => void;
  readonly overlays?: ReactNode;
}

export function ApplicationShell({
  api,
  logger,
  mainViewRouter,
  inspectorRouter,
  workspaceAdapter,
  domainStores,
  toastStore,
  onOpenWorkspace,
  onOpenSettings,
  overlays,
}: ApplicationShellProps) {
  const workspace = useExternalStore(workspaceAdapter);
  const mainView = useMainView(mainViewRouter);
  const [sidebarMode, setSidebarMode] = useState<"expanded" | "collapsed">("expanded");
  const workspaceId = workspace.current?.id;

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

  return (
    <div className={styles.shell}>
      <TopBar
        mainViewState={mainView.state}
        onMainViewChange={(state) => mainViewRouter.transition(state)}
        workspaceLabel={workspace.current?.label}
        sidebarMode={sidebarMode}
        onToggleSidebar={() =>
          setSidebarMode((mode) => (mode === "expanded" ? "collapsed" : "expanded"))
        }
        onOpenWorkspace={() => onOpenWorkspace?.()}
        onOpenSettings={() => onOpenSettings?.()}
      />
      <div className={styles.body} data-sidebar-mode={sidebarMode}>
        <Sidebar
          mode={sidebarMode}
          onToggle={() =>
            setSidebarMode((mode) => (mode === "expanded" ? "collapsed" : "expanded"))
          }
          conversationCatalog={domainStores.conversationCatalog}
          onCreateConversation={handleCreateConversation}
          schedule={domainStores.schedule}
          scheduleTodo={domainStores.scheduleTodo}
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
